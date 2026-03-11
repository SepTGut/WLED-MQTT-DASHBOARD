/* ═══════════════════════════════════════════════════════
   mqtt.js  —  MQTT connection manager
   ─────────────────────────────────────────────────────
   Wraps the Paho MQTT (1.x) WebSocket client.

   Public API used by other modules:
     MQTTClient.connect(cfg)
     MQTTClient.disconnect()
     MQTTClient.publish(topic, payload, retained?)
     MQTTClient.subscribe(topic, callback)
     MQTTClient.unsubscribe(topic)
     MQTTClient.connected  → boolean
   ═══════════════════════════════════════════════════════ */

window.MQTTClient = (function () {

  /* ── internal state ─────────────────────────────── */
  let _client      = null;
  let _connected   = false;
  let _cfg         = null;
  let _reconnTimer = null;

  // topic pattern → array of callback(payloadStr, topic)
  const _subs = {};

  // How many pending subscribes are queued while disconnected
  const _pendingSubs = new Set();

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
    if (pattern === topic) return true;
    // Convert MQTT wildcards to regex
    const re = '^' + pattern
      .replace(/[.+?^${}()|[\]\\]/g, m => m === '+' ? '[^/]+' : '\\' + m)
      .replace(/\/#$/, '(/.*)?')
      .replace(/#$/, '.*') + '$';
    return new RegExp(re).test(topic);
  }

  /* ── dispatch incoming message to subscribers ───── */
  function _dispatch(topic, payloadStr) {
    Object.keys(_subs).forEach(pattern => {
      if (_topicMatches(pattern, topic)) {
        _subs[pattern].forEach(fn => {
          try { fn(payloadStr, topic); }
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
    _log('Connected to broker ✓', 'success');
    window.setConnectionState && window.setConnectionState('connected');

    // Cancel any pending reconnect
    if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null; }

    // Subscribe to all registered topics
    _resubscribeAll();

    // Send LWT presence announcement
    const relayPrefix = _getRelayPrefix();
    if (relayPrefix) {
      pub(`${relayPrefix}/presence`, 'online', false);
    }

    // Trigger initial state ping for relay controller
    if (relayPrefix) {
      setTimeout(() => pub(`${relayPrefix}/ping`, '1', false), 300);
    }

    // Notify modules
    window.RelayModule && window.RelayModule.onConnected && window.RelayModule.onConnected();
    window.WLEDModule  && window.WLEDModule.onConnected  && window.WLEDModule.onConnected();
  }

  function _onConnectionLost(res) {
    _connected = false;
    const msg = res.errorMessage || 'unknown';
    _log(`Disconnected: ${msg}`, res.errorCode === 0 ? 'info' : 'error');
    window.setConnectionState && window.setConnectionState(
      res.errorCode === 0 ? 'disconnected' : 'error'
    );

    // Notify modules
    window.RelayModule && window.RelayModule.onDisconnected && window.RelayModule.onDisconnected();
    window.WLEDModule  && window.WLEDModule.onDisconnected  && window.WLEDModule.onDisconnected();

    // Auto-reconnect (unless user manually disconnected: errorCode 0)
    if (res.errorCode !== 0 && _cfg) {
      _log('Reconnecting in 5 s…', 'warning');
      window.setConnectionState && window.setConnectionState('connecting');
      _reconnTimer = setTimeout(() => _doConnect(_cfg), 5000);
    }
  }

  function _onMessageArrived(message) {
    const topic   = message.destinationName;
    const payload = message.payloadString;
    _dispatch(topic, payload);
  }

  /* ── low-level connect ──────────────────────────── */
  function _doConnect(cfg) {
    // Clean up any existing client
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
      reconnect: false,   // we handle reconnect manually
      onSuccess: _onConnect,
      onFailure: (err) => {
        _log(`Connection failed: ${err.errorMessage}`, 'error');
        window.setConnectionState && window.setConnectionState('error');
        // Schedule reconnect
        _log('Retrying in 5 s…', 'warning');
        window.setConnectionState && window.setConnectionState('connecting');
        _reconnTimer = setTimeout(() => _doConnect(cfg), 5000);
      }
    };

    if (cfg.username) opts.userName = cfg.username;
    if (cfg.password) opts.password = cfg.password;

    // Last Will (presence offline)
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

  /* ── read current prefix from settings field ────── */
  function _getRelayPrefix() {
    const el = document.getElementById('cfg-relay-prefix');
    return el ? (el.value.trim() || 'home/relay') : 'home/relay';
  }

  /* ── publish helper (internal & external) ────────── */
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

    /* connect(cfg)
       cfg: { host, port, useTLS, username, password }  */
    connect(cfg) {
      _cfg = { ...cfg };
      _doConnect(_cfg);
    },

    /* disconnect() — clean user-initiated disconnect */
    disconnect() {
      if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null; }
      _cfg = null;   // prevent auto-reconnect

      if (_client && _connected) {
        // Send offline presence before disconnecting
        const relayPrefix = _getRelayPrefix();
        if (relayPrefix) {
          try { pub(`${relayPrefix}/presence`, 'offline', false); } catch (_) {}
        }
        try { _client.disconnect(); } catch (_) {}
      }

      _connected = false;
      _client    = null;
    },

    /* publish(topic, payload, retained?)
       payload can be string or object (auto JSON.stringify) */
    publish(topic, payload, retained = false) {
      const str = (typeof payload === 'object')
        ? JSON.stringify(payload)
        : String(payload);
      return pub(topic, str, retained);
    },

    /* subscribe(topic, callback)
       topic supports MQTT wildcards: # and +
       callback(payloadStr, topic)                     */
    subscribe(topic, callback) {
      if (!_subs[topic]) _subs[topic] = [];
      // Avoid duplicate callbacks
      if (!_subs[topic].includes(callback)) {
        _subs[topic].push(callback);
      }
      // Subscribe on broker if already connected
      if (_client && _connected) {
        try { _client.subscribe(topic, { qos: 0 }); }
        catch(e) { _log(`Subscribe error: ${topic} — ${e}`, 'error'); }
      }
    },

    /* unsubscribe(topic) — removes all callbacks for topic */
    unsubscribe(topic) {
      delete _subs[topic];
      if (_client && _connected) {
        try { _client.unsubscribe(topic); } catch (_) {}
      }
    },

    /* publishJSON(topic, obj, retained?) — convenience */
    publishJSON(topic, obj, retained = false) {
      return pub(topic, JSON.stringify(obj), retained);
    }
  };

})();
