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
  const _maxRetries = Infinity;

  const _subs = {};           // pattern → [ { fn, subId } ]
  const _lastPayload = {};

  function _log(msg, level = 'info') {
    window.AppLog && window.AppLog[level] && window.AppLog[level](msg);
    console.log(`[MQTT][${level}]`, msg);
  }

  function _uniqueClientId() {
    return 'mqttctrl_' + Math.random().toString(36).slice(2, 10);
  }

  function _topicMatches(pattern, topic) {
    if (window.AppCoreUtils && window.AppCoreUtils.mqttTopicMatches) {
      return window.AppCoreUtils.mqttTopicMatches(pattern, topic);
    }
    return pattern === topic;
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
    Object.keys(_subs).forEach(pattern => {
      _client.subscribe(pattern, { qos: 0 }, (err) => {
        if (err) _log(`Subscribe error: ${pattern} — ${err}`, 'error');
        else _log(`↩ Re-subscribed: ${pattern}`);
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

    _resubscribeAll();

    const relayPrefix = _getRelayPrefix();
    if (relayPrefix) {
      pub(`${relayPrefix}/presence`, 'online', false);
      setTimeout(() => pub(`${relayPrefix}/ping`, '1', false), 300);
    }

    window.RelayModule && window.RelayModule.onConnected && window.RelayModule.onConnected();
    window.WLEDModule  && window.WLEDModule.onConnected  && window.WLEDModule.onConnected();
    window.SensorModule && window.SensorModule.onConnected && window.SensorModule.onConnected();
  }

  function _onClose() {
    if (!_connected) return;
    _connected = false;
    _log('Disconnected', 'error');
    window.setConnectionState && window.setConnectionState('error');

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
    if (_lastPayload[topic] === payloadStr) return;
    _lastPayload[topic] = payloadStr;
    _dispatch(topic, payloadStr);
  }

  function _onError(err) {
    _log(`MQTT error: ${err.message || err}`, 'error');
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

    _log(`Connecting to ${url}`);

    const opts = {
      clientId: _uniqueClientId(),
      keepalive: 30,
      clean: true,
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
        qos: 0,
        retain: false
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
  }

  function pub(topic, payload, retained = false) {
    if (!_client || !_connected) {
      _log(`Publish skipped (not connected): ${topic}`, 'warning');
      return false;
    }
    _client.publish(topic, String(payload), { qos: 0, retain: retained }, (err) => {
      if (err) _log(`Publish error on ${topic}: ${err}`, 'error');
    });
    return true;
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
      return pub(topic, str, retained);
    },

    subscribe(topic, callback) {
      if (!_subs[topic]) _subs[topic] = [];
      const entry = { fn: callback, subId: Math.random().toString(36).slice(2, 8) };
      _subs[topic].push(entry);

      if (_client && _connected) {
        _client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) _log(`Subscribe error: ${topic} — ${err}`, 'error');
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
    }
  };

})();