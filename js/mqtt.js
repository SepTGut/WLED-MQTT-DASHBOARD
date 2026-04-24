/* ═══════════════════════════════════════════════════════
   mqtt.js  —  MQTT connection manager (mqtt.js client)
   Works with broker.hivemq.com:8884 (wss)
   ═══════════════════════════════════════════════════════ */

window.MQTTClient = (function () {

  let _client      = null;
  let _connected   = false;
  let _cfg         = null;
  let _reconnTimer = null;
  let _retryAttempt = 0;
  const _maxRetries = Infinity;

  const _subs = {};
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

  function _scheduleReconnect(reason) {
    if (!_cfg) return;
    if (_reconnTimer) clearTimeout(_reconnTimer);
    const waitMs = Math.min(30000, 1000 * Math.pow(2, _retryAttempt));
    _retryAttempt++;
    _log(`${reason} – retry in ${(waitMs/1000).toFixed(1)}s`, 'warning');
    window.setConnectionState && window.setConnectionState('connecting', { retryAttempt: _retryAttempt });
    _reconnTimer = setTimeout(() => _doConnect(_cfg), waitMs);
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
        if (err) _log(`Subscribe error: ${pattern}`, 'error');
        else _log(`↩ Re-subscribed: ${pattern}`);
      });
    });
  }

  function _onConnect() {
    _connected = true;
    _retryAttempt = 0;
    _log('Connected to broker ✓', 'success');
    window.setConnectionState && window.setConnectionState('connected');
    if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null; }
    _resubscribeAll();

    const relayPrefix = _getRelayPrefix();
    if (relayPrefix) {
      pub(`${relayPrefix}/presence`, 'online');
      setTimeout(() => pub(`${relayPrefix}/ping`, '1'), 300);
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
    if (_cfg) _scheduleReconnect('Reconnecting');
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

  function _doConnect(cfg) {
    if (_client) _client.end(true);
    const useSSL = !!cfg.useTLS;
    const url = `${useSSL ? 'wss' : 'ws'}://${cfg.host}:${cfg.port}/mqtt`;

    const opts = {
      clientId: _uniqueClientId(),
      keepalive: 30,
      clean: true,
      reconnectPeriod: 0,   // we handle it manually
      username: cfg.username || undefined,
      password: cfg.password || undefined
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

    _client = mqtt.connect(url, opts);
    _client.on('connect', _onConnect);
    _client.on('close', _onClose);
    _client.on('message', _onMessage);
    _client.on('error', _onError);
  }

  function pub(topic, payload, retained = false) {
    if (!_client || !_connected) return false;
    _client.publish(topic, String(payload), { qos: 0, retain: retained }, (err) => {
      if (err) _log(`Publish error on ${topic}: ${err}`, 'error');
    });
    return true;
  }

  function _getRelayPrefix() {
    const el = document.getElementById('cfg-relay-prefix');
    return el ? (el.value.trim() || 'home/relay') : 'home/relay';
  }

  /* ── Public API (identical to before) ───────────────── */
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
      if (_client) {
        if (_connected) {
          const relayPrefix = _getRelayPrefix();
          if (relayPrefix) pub(`${relayPrefix}/presence`, 'offline');
        }
        _client.end(true);
        _client = null;
      }
      _connected = false;
      Object.keys(_lastPayload).forEach(k => delete _lastPayload[k]);
    },

    publish(topic, payload, retained = false) {
      const str = (typeof payload === 'object') ? JSON.stringify(payload) : String(payload);
      return pub(topic, str, retained);
    },

    subscribe(topic, callback) {
      if (!_subs[topic]) _subs[topic] = [];
      const entry = { fn: callback, subId: Math.random().toString(36).slice(2, 8) };
      _subs[topic].push(entry);
      if (_client && _connected) {
        _client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) _log(`Subscribe error: ${topic}`, 'error');
        });
      }
      return {
        unsubscribe: function() {
          if (!_subs[topic]) return;
          _subs[topic] = _subs[topic].filter(e => e.subId !== entry.subId);
          if (_subs[topic].length === 0) {
            delete _subs[topic];
            if (_client && _connected) _client.unsubscribe(topic);
          }
        }
      };
    },

    unsubscribe(topic) {
      delete _subs[topic];
      if (_client && _connected) _client.unsubscribe(topic);
    },

    publishJSON(topic, obj, retained = false) {
      return pub(topic, JSON.stringify(obj), retained);
    }
  };

})();