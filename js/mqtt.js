/* ═══════════════════════════════════════════════════════
   mqtt.js  —  MQTT connection manager
   ─────────────────────────────────────────────────────
   Wraps the Paho MQTT (1.x) WebSocket client.

   Public API used by other modules:
     MQTTClient.connect(cfg)
     MQTTClient.disconnect()
     MQTTClient.publish(topic, payload, retained?)
     MQTTClient.subscribe(topic, callback)  → { unsubscribe }
     MQTTClient.connected  → boolean
   ═══════════════════════════════════════════════════════ */

window.MQTTClient = (function () {

  /* ── internal state ─────────────────────────────── */
  let _client      = null;
  let _connected   = false;
  let _cfg         = null;
  let _reconnTimer = null;
  let _retryAttempt = 0;
  const _maxRetries = Infinity;   // keep trying forever

  // topic pattern → array of { fn, subId }
  const _subs = {};
  // deduplication cache
  const _lastPayload = {};

  /* ── helpers ────────────────────────────────────── */
  function _log(msg, level = 'info') {
    window.AppLog && window.AppLog[level] && window.AppLog[level](msg);
    console.log(`[MQTT][${level}]`, msg);
  }

  function _uniqueClientId() {
    return 'mqttctrl_' + Math.random().toString(36).slice(2, 10);
  }

  /* ── topic matching (supports # and + wildcards) ── */
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

  /* ── dispatch incoming message to subscribers ───── */
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

  /* ── re-subscribe all registered patterns ───────── */
  function _resubscribeAll() {
    Object.keys(_subs).forEach(pattern => {
      try {
        _client.subscribe(pattern, { qos: 0 });
        _log(`↩ Re-subscribed: ${pattern}`);
      } catch (e) {
        _log(`Subscribe error: ${pattern} — ${e}`, 'error');
      }
    });
  }

  /* ── Paho callbacks ─────────────────────────────── */
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

  function _onConnectionLost(res) {
    _connected = false;
    const msg = res.errorMessage || 'unknown';
    _log(`Disconnected: ${msg}`, res.errorCode === 0 ? 'info' : 'error');
    window.setConnectionState && window.setConnectionState(
      res.errorCode === 0 ? 'disconnected' : 'error'
    );

    window.RelayModule && window.RelayModule.onDisconnected && window.RelayModule.onDisconnected();
    window.WLEDModule  && window.WLEDModule.onDisconnected  && window.WLEDModule.onDisconnected();
    window.SensorModule && window.SensorModule.onDisconnected && window.SensorModule.onDisconnected();

    if (res.errorCode !== 0 && _cfg) {
      _scheduleReconnect('Reconnecting');
    }
  }

  function _onMessageArrived(message) {
    const topic   = message.destinationName;
    const payload = message.payloadString;
    // Deduplicate consecutive identical payloads
    if (_lastPayload[topic] === payload) return;
    _lastPayload[topic] = payload;
    _dispatch(topic, payload);
  }

  /* ── low-level connect ──────────────────────────── */
  function _doConnect(cfg) {
    if (_client) {
      try { _client.disconnect(); } catch (_) {}
      _client = null;
    }

    const clientId = _uniqueClientId();
    const useSSL   = !!cfg.useTLS;

    _log(`Connecting to ${useSSL ? 'wss' : 'ws'}://${cfg.host}:${cfg.port} (${clientId})`);

    try {
      _client = new Paho.MQTT.Client(cfg.host, Number(cfg.port), '/mqtt', clientId);
    } catch(e) {
      _log(`Failed to create Paho client: ${e}`, 'error');
      window.setConnectionState && window.setConnectionState('error');
      return;
    }

    _client.onConnectionLost = _onConnectionLost;
    _client.onMessageArrived = _onMessageArrived;

    const opts = {
      useSSL,
      timeout:   10,
      keepAliveInterval: 30,
      cleanSession: true,
      onSuccess: _onConnect,
      onFailure: (err) => {
        _log(`Connection failed: ${err.errorMessage}`, 'error');
        window.setConnectionState && window.setConnectionState('error');
        _scheduleReconnect('Retrying');
      }
    };

    if (cfg.username) opts.userName = cfg.username;
    if (cfg.password) opts.password = cfg.password;

    const relayPrefix = _getRelayPrefix();
    if (relayPrefix) {
      const will = new Paho.MQTT.Message('offline');
      will.destinationName = `${relayPrefix}/presence`;
      will.retained = false;
      opts.willMessage = will;
    }

    try {
      _client.connect(opts);
    } catch(e) {
      _log(`Connect error: ${e}`, 'error');
      window.setConnectionState && window.setConnectionState('error');
    }
  }

  function _getRelayPrefix() {
    const el = document.getElementById('cfg-relay-prefix');
    return el ? (el.value.trim() || 'home/relay') : 'home/relay';
  }

  function pub(topic, payload, retained = false) {
    if (!_client || !_connected) {
      _log(`Publish skipped (not connected): ${topic}`, 'warning');
      return false;
    }
    try {
      const msg = new Paho.MQTT.Message(String(payload));
      msg.destinationName = topic;
      msg.retained = retained;
      msg.qos = 0;
      _client.send(msg);
      return true;
    } catch(e) {
      _log(`Publish error on ${topic}: ${e}`, 'error');
      return false;
    }
  }

  /* ══════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════ */
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

      if (_client && _connected) {
        const relayPrefix = _getRelayPrefix();
        if (relayPrefix) {
          try { pub(`${relayPrefix}/presence`, 'offline', false); } catch (_) {}
        }
        try { _client.disconnect(); } catch (_) {}
      }

      _connected = false;
      _client    = null;
      // Clear dedup cache on disconnect
      Object.keys(_lastPayload).forEach(k => delete _lastPayload[k]);
    },

    publish(topic, payload, retained = false) {
      const str = (typeof payload === 'object')
        ? JSON.stringify(payload)
        : String(payload);
      return pub(topic, str, retained);
    },

    /* subscribe(topic, callback) → { unsubscribe }
       Returns a handle to safely unsubscribe only this callback. */
    subscribe(topic, callback) {
      if (!_subs[topic]) _subs[topic] = [];
      const entry = { fn: callback, subId: Math.random().toString(36).slice(2, 8) };
      _subs[topic].push(entry);

      if (_client && _connected) {
        try { _client.subscribe(topic, { qos: 0 }); }
        catch(e) { _log(`Subscribe error: ${topic} — ${e}`, 'error'); }
      }

      return {
        unsubscribe: function() {
          if (!_subs[topic]) return;
          _subs[topic] = _subs[topic].filter(e => e.subId !== entry.subId);
          if (_subs[topic].length === 0) {
            delete _subs[topic];
            if (_client && _connected) {
              try { _client.unsubscribe(topic); } catch (_) {}
            }
          }
        }
      };
    },

    /* unsubscribe(topic) — legacy bulk remove (still works) */
    unsubscribe(topic) {
      delete _subs[topic];
      if (_client && _connected) {
        try { _client.unsubscribe(topic); } catch (_) {}
      }
    },

    publishJSON(topic, obj, retained = false) {
      return pub(topic, JSON.stringify(obj), retained);
    }
  };

})();