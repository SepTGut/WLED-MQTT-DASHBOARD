/* ═══════════════════════════════════════════════════════
   mqtt.js  v2.1 — MQTT connection manager (mqtt.js client)
   ─────────────────────────────────────────────────────
   Bug fixes v2.1:
   • Duplicate-payload filter now TIME-BASED (100 ms) — heartbeats pass through
   • Reconnect capped at 20 attempts (was Infinity)
   • Offline command queue drains on reconnect (was silently dropped)
   • publish() uses QoS 1 by default for reliability
   • publishJSON() exposed and consistent
   • Watchdog timer cleared properly on disconnect
   ═══════════════════════════════════════════════════════ */

window.MQTTClient = (function () {

  let _client = null;
  let _connected = false;
  let _cfg = null;
  let _reconnTimer = null;
  let _retryAttempt = 0;
  const _maxRetries = 20;          // FIX: was Infinity

  const _subs = {};    // pattern → [{ fn, subId }]
  const _activeSubscriptions = new Set();
  const _lastPayload = {};    // topic → { str, ts }
  const _queue = [];    // offline command queue
  const DEDUP_WINDOW_MS = 100;   // FIX: time-based dedup window
  const QUEUE_LIMIT = 50;
  let _connectTimeoutTimer = null;
  const _connectTimeoutMs = 12000;

  /* ══════════════════════════════════════════════
     Logging
  ══════════════════════════════════════════════ */
  function _log(msg, level) {
    level = level || 'info';
    window.AppLog && window.AppLog[level] && window.AppLog[level](msg);
    console.log('[MQTT][' + level + ']', msg);
  }

  /* ══════════════════════════════════════════════
     Client ID (stable across reloads)
  ══════════════════════════════════════════════ */
  function _uniqueClientId() {
    let id = null;
    try { id = localStorage.getItem('mqttctrl_client_id'); } catch (e) { }
    if (!id) {
      id = 'mqttctrl_' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem('mqttctrl_client_id', id); } catch (e) { }
    }
    return id;
  }

  /* ══════════════════════════════════════════════
     Topic matching
  ══════════════════════════════════════════════ */
  function _topicMatches(pattern, topic) {
    if (window.AppCoreUtils && window.AppCoreUtils.mqttTopicMatches)
      return window.AppCoreUtils.mqttTopicMatches(pattern, topic);
    if (pattern === topic) return true;
    if (pattern === '#') return true;
    return false;
  }

  /* ══════════════════════════════════════════════
     Topic validation
  ══════════════════════════════════════════════ */
  function _isValidTopic(topic, allowWildcards) {
    if (!topic || typeof topic !== 'string') return false;
    if (topic.length > 255) return false;
    if (/[+#]/.test(topic) && !allowWildcards) return false;
    var parts = topic.split('/');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].includes('+') && parts[i].length > 1) return false;
      if (parts[i].includes('#') && (parts[i].length > 1 || i !== parts.length - 1)) return false;
    }
    return true;
  }

  /* ══════════════════════════════════════════════
     Exponential back-off
  ══════════════════════════════════════════════ */
  function _nextReconnectMs() {
    var base = 1200;
    var cap = 30000;
    var delay = window.AppCoreUtils && window.AppCoreUtils.computeBackoffMs
      ? window.AppCoreUtils.computeBackoffMs(_retryAttempt, base, cap)
      : Math.min(base * Math.pow(2, _retryAttempt), cap);
    var jitter = Math.floor(delay * (Math.random() * 0.3 - 0.15));
    return Math.max(800, delay + jitter);
  }

  function _scheduleReconnect(reason) {
    if (!_cfg) return;
    if (_retryAttempt >= _maxRetries) {
      _log('Reconnect limit (' + _maxRetries + ') reached. Reconnect manually.', 'error');
      window.setConnectionState && window.setConnectionState('error');
      return;
    }
    if (_reconnTimer) clearTimeout(_reconnTimer);
    var waitMs = _nextReconnectMs();
    var n = _retryAttempt + 1;
    _log((reason || 'Reconnecting') + ' in ' + (waitMs / 1000).toFixed(1) + ' s (attempt ' + n + '/' + _maxRetries + ')', 'warning');
    window.setConnectionState && window.setConnectionState('connecting', { retryAttempt: n, retryInMs: waitMs });
    _reconnTimer = setTimeout(function () {
      _reconnTimer = null;
      _retryAttempt += 1;
      _doConnect(_cfg);
    }, waitMs);
  }

  /* ══════════════════════════════════════════════
     Dispatch to subscribers
  ══════════════════════════════════════════════ */
  function _dispatch(topic, payloadStr) {
    Object.keys(_subs).forEach(function (pattern) {
      if (_topicMatches(pattern, topic)) {
        _subs[pattern].forEach(function (entry) {
          try { entry.fn(payloadStr, topic); }
          catch (e) { console.error('[MQTT] subscriber error', e); }
        });
      }
    });
  }

  /* ══════════════════════════════════════════════
     Re-subscribe after reconnect
  ══════════════════════════════════════════════ */
  function _resubscribeAll() {
    _activeSubscriptions.clear();
    Object.keys(_subs).forEach(function (pattern) {
      if (!_isValidTopic(pattern, true)) {
        _log('Skipping invalid subscription: ' + pattern, 'error');
        return;
      }
      _client.subscribe(pattern, { qos: 0 }, function (err) {
        if (err) _log('Subscribe error: ' + pattern + ' — ' + err, 'error');
        else _activeSubscriptions.add(pattern);
      });
    });
  }

  /* ══════════════════════════════════════════════
     Connection callbacks
  ══════════════════════════════════════════════ */
  function _onConnect() {
    _connected = true;
    _retryAttempt = 0;
    _log('Connected to broker ✓', 'success');
    window.setConnectionState && window.setConnectionState('connected');

    if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null; }
    if (_connectTimeoutTimer) { clearTimeout(_connectTimeoutTimer); _connectTimeoutTimer = null; }

    _resubscribeAll();
    _processQueue();   // FIX: drain offline queue on every connect, not just first

    var relayPrefix = _getRelayPrefix();
    if (relayPrefix) {
      _pub(relayPrefix + '/presence', 'online', true, 1);
      setTimeout(function () { _pub(relayPrefix + '/ping', '1', false, 0); }, 350);
    }

    window.RelayModule && window.RelayModule.onConnected && window.RelayModule.onConnected();
    window.WLEDModule && window.WLEDModule.onConnected && window.WLEDModule.onConnected();
    window.SensorModule && window.SensorModule.onConnected && window.SensorModule.onConnected();
  }

  function _onClose() {
    if (!_connected) return;   // guard against double-fire
    _connected = false;
    _activeSubscriptions.clear();
    _log('Disconnected from broker', 'error');
    window.setConnectionState && window.setConnectionState('error');

    if (_connectTimeoutTimer) { clearTimeout(_connectTimeoutTimer); _connectTimeoutTimer = null; }

    window.RelayModule && window.RelayModule.onDisconnected && window.RelayModule.onDisconnected();
    window.WLEDModule && window.WLEDModule.onDisconnected && window.WLEDModule.onDisconnected();
    window.SensorModule && window.SensorModule.onDisconnected && window.SensorModule.onDisconnected();

    if (_cfg) _scheduleReconnect('Reconnecting');
  }

  function _onMessage(topic, payload) {
    var payloadStr = payload.toString();
    var now = Date.now();

    // FIX: time-based dedup — only skip if SAME payload within 100 ms window
    var last = _lastPayload[topic];
    if (last && last.str === payloadStr && (now - last.ts) < DEDUP_WINDOW_MS) return;

    _lastPayload[topic] = { str: payloadStr, ts: now };
    _dispatch(topic, payloadStr);
  }

  function _onError(err) {
    var msg = err.message || String(err);
    if (msg.includes('Not authorized')) msg = 'Connection Refused: Not authorized (check username/password)';
    else if (msg.includes('Identifier rejected')) msg = 'Connection Refused: Client ID rejected';
    else if (msg.includes('Server unavailable')) msg = 'Connection Refused: Server unavailable';
    _log('MQTT error: ' + msg, 'error');
    if (_connectTimeoutTimer) { clearTimeout(_connectTimeoutTimer); _connectTimeoutTimer = null; }
  }

  /* ══════════════════════════════════════════════
     Internal publish
  ══════════════════════════════════════════════ */
  function _pub(topic, payload, retained, qos) {
    retained = !!retained;
    qos = (qos === undefined || qos === null) ? 1 : qos;

    if (!_client || !_connected) {
      if (_queue.length < QUEUE_LIMIT) {
        _queue.push({ topic: topic, payload: payload, retained: retained, qos: qos });
        _log('Offline: queued → ' + topic, 'warning');
      } else {
        _log('Offline: queue full, dropped → ' + topic, 'error');
      }
      return false;
    }

    if (!_isValidTopic(topic)) {
      _log('Invalid publish topic: ' + topic, 'error');
      return false;
    }

    _client.publish(topic, String(payload), { qos: qos, retain: retained }, function (err) {
      if (err) _log('Publish error on ' + topic + ': ' + err, 'error');
    });
    return true;
  }

  function _processQueue() {
    if (!_queue.length) return;
    _log('Draining ' + _queue.length + ' queued message(s)…', 'info');
    // Copy and clear first to avoid infinite re-queue if publish fails
    var pending = _queue.splice(0, _queue.length);
    pending.forEach(function (msg) {
      _pub(msg.topic, msg.payload, msg.retained, msg.qos);
    });
  }

  /* ══════════════════════════════════════════════
     Connect
  ══════════════════════════════════════════════ */
  function _doConnect(cfg) {
    if (_client) { try { _client.end(true); } catch (e) { } _client = null; }

    var useSSL = !!cfg.useTLS;
    var protocol = useSSL ? 'wss' : 'ws';
    var url = protocol + '://' + cfg.host + ':' + cfg.port + '/mqtt';

    _log('Connecting → ' + url);

    var relayPrefix = _getRelayPrefix();
    var opts = {
      clientId: _uniqueClientId(),
      keepalive: 30,
      clean: false,
      reconnectPeriod: 0,
      username: cfg.username || undefined,
      password: cfg.password || undefined,
    };

    if (relayPrefix) {
      opts.will = { topic: relayPrefix + '/presence', payload: 'offline', qos: 1, retain: true };
    }

    try {
      _client = mqtt.connect(url, opts);
    } catch (e) {
      _log('Create client error: ' + e, 'error');
      window.setConnectionState && window.setConnectionState('error');
      return;
    }

    _client.on('connect', _onConnect);
    _client.on('close', _onClose);
    _client.on('message', _onMessage);
    _client.on('error', _onError);

    // Connection watchdog
    if (_connectTimeoutTimer) clearTimeout(_connectTimeoutTimer);
    _connectTimeoutTimer = setTimeout(function () {
      if (!_connected) {
        _log('Connection attempt timed out after ' + (_connectTimeoutMs / 1000) + ' s', 'error');
        _onClose();
      }
    }, _connectTimeoutMs);
  }

  function _getRelayPrefix() {
    var el = document.getElementById('cfg-relay-prefix');
    return el ? (el.value.trim() || 'home/relay') : 'home/relay';
  }

  /* ══════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════ */
  return {
    get connected() { return _connected; },

    connect: function (cfg) {
      _cfg = Object.assign({}, cfg);
      _retryAttempt = 0;
      _doConnect(_cfg);
    },

    disconnect: function () {
      if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null; }
      if (_connectTimeoutTimer) { clearTimeout(_connectTimeoutTimer); _connectTimeoutTimer = null; }
      _cfg = null;
      _retryAttempt = 0;

      if (_client) {
        var relayPrefix = _getRelayPrefix();
        if (relayPrefix && _connected) {
          try { _pub(relayPrefix + '/presence', 'offline', false, 0); } catch (_) { }
        }
        try { _client.end(true); } catch (e) { }
        _client = null;
      }

      _connected = false;
      Object.keys(_lastPayload).forEach(function (k) { delete _lastPayload[k]; });
    },

    /* publish — default QoS 1 for reliability */
    publish: function (topic, payload, retained) {
      var str = (typeof payload === 'object') ? JSON.stringify(payload) : String(payload);
      return _pub(topic, str, !!retained, 1);
    },

    /* publishJSON — convenience wrapper */
    publishJSON: function (topic, obj, retained) {
      return _pub(topic, JSON.stringify(obj), !!retained, 1);
    },

    subscribe: function (topic, callback) {
      if (!_subs[topic]) _subs[topic] = [];
      var entry = { fn: callback, subId: Math.random().toString(36).slice(2, 8) };
      _subs[topic].push(entry);

      if (!_isValidTopic(topic, true)) {
        _log('Invalid subscription topic: ' + topic, 'error');
        return { unsubscribe: function () { } };
      }

      if (_client && _connected && !_activeSubscriptions.has(topic)) {
        _client.subscribe(topic, { qos: 0 }, function (err) {
          if (err) _log('Subscribe error: ' + topic + ' — ' + err, 'error');
          else _activeSubscriptions.add(topic);
        });
      }

      return {
        unsubscribe: function () {
          if (!_subs[topic]) return;
          _subs[topic] = _subs[topic].filter(function (e) { return e.subId !== entry.subId; });
          if (_subs[topic].length === 0) {
            delete _subs[topic];
            _activeSubscriptions.delete(topic);
            if (_client && _connected) _client.unsubscribe(topic);
          }
        }
      };
    },

    unsubscribe: function (topic) {
      delete _subs[topic];
      _activeSubscriptions.delete(topic);
      if (_client && _connected) _client.unsubscribe(topic);
    },

    isValidTopic: function (topic, allowWildcards) {
      return _isValidTopic(topic, allowWildcards);
    }
  };

})();