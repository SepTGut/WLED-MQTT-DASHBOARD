/* ═══════════════════════════════════════════════════════
   mqtt.js  —  MQTT connection manager (mqtt.js client)
   ─────────────────────────────────────────────────────
   Wraps the mqtt.js WebSocket library.

   Public API (unchanged):
     MQTTClient.connect(cfg)
     MQTTClient.disconnect()
     MQTTClient.publish(topic, payload, retained?)
     MQTTClient.subscribe(topic, callback)  → { unsubscribe }
     MQTTClient.connected  → boolean
   ═══════════════════════════════════════════════════════ */

window.MQTTClient = (function () {

  let _client      = null;
  let _connected   = false;
  let _cfg         = null;
  let _reconnTimer = null;
  let _retryAttempt = 0;
  const _maxRetries = 20;

  const _subs = {};           // pattern → [ { fn, subId } ]
  const _activeSubscriptions = new Set(); // patterns actually subscribed on broker
  const _lastPayload = {};    // topic → { str, ts }
  const _queue = [];          // { topic, payload, retained, qos }
  let _connectTimeoutTimer = null;
  const _connectTimeoutMs = 10000; // 10s watchdog

  function _log(msg, level = 'info') {
    window.AppLog && window.AppLog[level] && window.AppLog[level](msg);
    console.log(`[MQTT][${level}]`, msg);
  }

  function _uniqueClientId() {
    let id = localStorage.getItem('mqttctrl_client_id');
    if (!id) {
      id = 'mqttctrl_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('mqttctrl_client_id', id);
    }
    return id;
  }

  function _topicMatches(pattern, topic) {
    if (window.AppCoreUtils && window.AppCoreUtils.mqttTopicMatches) {
      return window.AppCoreUtils.mqttTopicMatches(pattern, topic);
    }
    // Basic fallback if core-utils not loaded
    if (pattern === topic) return true;
    if (pattern === '#') return true;
    return false;
  }

  function _isValidTopic(topic, allowWildcards = false) {
    if (!topic || typeof topic !== 'string') return false;
    if (topic.length > 255) return false;
    
    // Check for invalid characters
    if (/[+#]/.test(topic) && !allowWildcards) return false;
    
    // Basic MQTT topic rules
    const parts = topic.split('/');
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].includes('+') && parts[i].length > 1) return false;
        if (parts[i].includes('#') && (parts[i].length > 1 || i !== parts.length - 1)) return false;
    }
    return true;
  }

  function _nextReconnectMs() {
    var base = 1000;
    var cap = 30000;
    var delay = window.AppCoreUtils && window.AppCoreUtils.computeBackoffMs
      ? window.AppCoreUtils.computeBackoffMs(_retryAttempt, base, cap)
      : Math.min(base * Math.pow(2, _retryAttempt), cap);
    var jitter = Math.floor(delay * (Math.random() * 0.4 - 0.2));
    return Math.max(500, delay + jitter);
  }

  function _scheduleReconnect(reason) {
    if (!_cfg) return;
    if (_retryAttempt >= _maxRetries) {
      _log('Reconnect limit reached; please reconnect manually.', 'error');
      window.setConnectionState && window.setConnectionState('error');
      return;
    }
    if (_reconnTimer) clearTimeout(_reconnTimer);
    var waitMs = _nextReconnectMs();
    var n = _retryAttempt + 1;
    _log((reason || 'Reconnecting') + ' in ' + (waitMs / 1000).toFixed(1) + ' s (attempt ' + n + ')', 'warning');
    window.setConnectionState && window.setConnectionState('connecting', { retryAttempt: n, retryInMs: waitMs });
    _reconnTimer = setTimeout(function () {
      _reconnTimer = null;
      _retryAttempt += 1;
      _doConnect(_cfg);
    }, waitMs);
  }

  function _dispatch(topic, payloadStr) {
    Object.keys(_subs).forEach(pattern => {
      if (_topicMatches(pattern, topic)) {
        _subs[pattern].forEach(entry => {
          try { entry.fn(payloadStr, topic); }
          catch (e) { console.error('[MQTT] subscriber error', e); }
        });
      }
    });
  }

  function _resubscribeAll() {
    _activeSubscriptions.clear();
    Object.keys(_subs).forEach(pattern => {
      if (!_isValidTopic(pattern, true)) {
        _log(`Skipping invalid subscription pattern: ${pattern}`, 'error');
        return;
      }
      _client.subscribe(pattern, { qos: 0 }, (err) => {
        if (err) {
          _log(`Subscribe error: ${pattern} — ${err}`, 'error');
        } else {
          _activeSubscriptions.add(pattern);
          _log(`↩ Re-subscribed: ${pattern}`);
        }
      });
    });
  }

  /* ══════ CALLBACKS ══════ */
  function _onConnect() {
    _connected = true;
    _retryAttempt = 0;
    _log('Connected to broker ✓', 'success');
    window.setConnectionState && window.setConnectionState('connected');

    if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null; }
    if (_connectTimeoutTimer) { clearTimeout(_connectTimeoutTimer); _connectTimeoutTimer = null; }

    _resubscribeAll();
    _processQueue();

    const relayPrefix = _getRelayPrefix();
    if (relayPrefix) {
      pub(`${relayPrefix}/presence`, 'online', true); // Retained
      setTimeout(() => pub(`${relayPrefix}/ping`, '1', false), 300);
    }

    window.RelayModule && window.RelayModule.onConnected && window.RelayModule.onConnected();
    window.WLEDModule  && window.WLEDModule.onConnected  && window.WLEDModule.onConnected();
    window.SensorModule && window.SensorModule.onConnected && window.SensorModule.onConnected();
  }

  function _onClose() {
    if (!_connected) return;
    _connected = false;
    _activeSubscriptions.clear();
    _log('Disconnected', 'error');
    window.setConnectionState && window.setConnectionState('error');
    if (_connectTimeoutTimer) { clearTimeout(_connectTimeoutTimer); _connectTimeoutTimer = null; }

    window.RelayModule && window.RelayModule.onDisconnected && window.RelayModule.onDisconnected();
    window.WLEDModule  && window.WLEDModule.onDisconnected  && window.WLEDModule.onDisconnected();
    window.SensorModule && window.SensorModule.onDisconnected && window.SensorModule.onDisconnected();

    // Reconnect if not user-initiated
    if (_cfg) {
      _scheduleReconnect('Reconnecting');
    }
  }

  function _onMessage(topic, payload) {
    const payloadStr = payload.toString();
    const now = Date.now();
    
    // Throttling: Ignore identical payloads ONLY if they arrive within 100ms
    // This prevents tight loops but allows heartbeats/repeated status updates.
    if (_lastPayload[topic] && _lastPayload[topic].str === payloadStr) {
      if (now - _lastPayload[topic].ts < 100) return;
    }
    
    _lastPayload[topic] = { str: payloadStr, ts: now };
    _dispatch(topic, payloadStr);
  }

  function _onError(err) {
    let msg = err.message || err;
    if (msg.includes('Not authorized')) msg = 'Connection Refused: Not authorized (check username/password)';
    else if (msg.includes('Identifier rejected')) msg = 'Connection Refused: Client ID rejected';
    else if (msg.includes('Server unavailable')) msg = 'Connection Refused: Server unavailable';
    _log(`MQTT error: ${msg}`, 'error');
    if (_connectTimeoutTimer) { clearTimeout(_connectTimeoutTimer); _connectTimeoutTimer = null; }
  }

  /* ══════ CONNECT ══════ */
  function _doConnect(cfg) {
    if (_client) {
      _client.end(true);
      _client = null;
    }

    const useSSL   = !!cfg.useTLS;
    const protocol = useSSL ? 'wss' : 'ws';
    const url = `${protocol}://${cfg.host}:${cfg.port}/mqtt`;

    if (!_isValidTopic('test')) { // Just checking if our validator works
        // ...
    }

    _log(`Connecting to ${url}`);

    const opts = {
      clientId: _uniqueClientId(),
      keepalive: 30,
      clean: false,                // Persistent session
      reconnectPeriod: 0,          // manual reconnect
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      will: undefined
    };

    const relayPrefix = _getRelayPrefix();
    if (relayPrefix) {
      opts.will = {
        topic: `${relayPrefix}/presence`,
        payload: 'offline',
        qos: 1,
        retain: true
      };
    }

    try {
      _client = mqtt.connect(url, opts);
    } catch(e) {
      _log(`Create client error: ${e}`, 'error');
      window.setConnectionState && window.setConnectionState('error');
      return;
    }

    _client.on('connect', _onConnect);
    _client.on('close', _onClose);
    _client.on('message', _onMessage);
    _client.on('error', _onError);

    // Watchdog for connection hanging
    if (_connectTimeoutTimer) clearTimeout(_connectTimeoutTimer);
    _connectTimeoutTimer = setTimeout(() => {
        if (!_connected) {
            _log('Connection attempt timed out.', 'error');
            _onClose(); // Trigger retry logic
        }
    }, _connectTimeoutMs);
  }

  function pub(topic, payload, retained = false, qos = 0) {
    if (!_client || !_connected) {
      if (_queue.length < 50) {
        _queue.push({ topic, payload, retained, qos });
        _log(`Offline: queued ${topic}`, 'warning');
      } else {
        _log(`Offline: queue full, dropped ${topic}`, 'error');
      }
      return false;
    }
    if (!_isValidTopic(topic)) {
      _log(`Invalid publish topic: ${topic}`, 'error');
      return false;
    }
    _client.publish(topic, String(payload), { qos, retain: retained }, (err) => {
      if (err) _log(`Publish error on ${topic}: ${err}`, 'error');
    });
    return true;
  }

  function _processQueue() {
    if (!_queue.length) return;
    _log(`Processing ${_queue.length} queued messages...`, 'info');
    while (_queue.length > 0) {
      const msg = _queue.shift();
      pub(msg.topic, msg.payload, msg.retained, msg.qos);
    }
  }

  function _getRelayPrefix() {
    const el = document.getElementById('cfg-relay-prefix');
    return el ? (el.value.trim() || 'home/relay') : 'home/relay';
  }

  /* ══════ PUBLIC API ══════ */
  return {
    get connected() { return _connected; },

    connect(cfg) {
      _cfg = { ...cfg };
      _retryAttempt = 0;
      _doConnect(_cfg);
    },

    disconnect() {
      if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null; }
      _cfg = null;
      _retryAttempt = 0;

      if (_client) {
        const relayPrefix = _getRelayPrefix();
        if (relayPrefix && _connected) {
          try { pub(`${relayPrefix}/presence`, 'offline', false); } catch (_) {}
        }
        _client.end(true);
        _client = null;
      }

      _connected = false;
      Object.keys(_lastPayload).forEach(k => delete _lastPayload[k]);
    },

    publish(topic, payload, retained = false) {
      const str = (typeof payload === 'object')
        ? JSON.stringify(payload)
        : String(payload);
      // Default to QoS 1 for most user actions for better reliability
      return pub(topic, str, retained, 1);
    },

    subscribe(topic, callback) {
      if (!_subs[topic]) _subs[topic] = [];
      const entry = { fn: callback, subId: Math.random().toString(36).slice(2, 8) };
      _subs[topic].push(entry);

      if (!_isValidTopic(topic, true)) {
        _log(`Invalid subscription topic: ${topic}`, 'error');
        return { unsubscribe: () => {} };
      }

      if (_client && _connected && !_activeSubscriptions.has(topic)) {
        _client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) _log(`Subscribe error: ${topic} — ${err}`, 'error');
          else _activeSubscriptions.add(topic);
        });
      }

      return {
        unsubscribe: function() {
          if (!_subs[topic]) return;
          _subs[topic] = _subs[topic].filter(e => e.subId !== entry.subId);
          if (_subs[topic].length === 0) {
            delete _subs[topic];
            if (_client && _connected) {
              _client.unsubscribe(topic);
            }
          }
        }
      };
    },

    unsubscribe(topic) {
      delete _subs[topic];
      if (_client && _connected) {
        _client.unsubscribe(topic);
      }
    },

    publishJSON(topic, obj, retained = false) {
      return pub(topic, JSON.stringify(obj), retained);
    },

    isValidTopic(topic, allowWildcards = false) {
      return _isValidTopic(topic, allowWildcards);
    }
  };

})();