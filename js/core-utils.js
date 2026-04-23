(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AppCoreUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mqttTopicMatches(pattern, topic) {
    if (pattern === topic) return true;
    var p = String(pattern || '').split('/');
    var t = String(topic || '').split('/');
    var i = 0;

    for (; i < p.length; i++) {
      var seg = p[i];
      if (seg === '#') return i === p.length - 1;
      if (t[i] === undefined) return false;
      if (seg !== '+' && seg !== t[i]) return false;
    }
    return i === t.length;
  }

  function relayIsOnPayload(payloadStr) {
    var p = String(payloadStr || '').trim().toLowerCase();
    return p === 'on' || p === '1' || p === 'true';
  }

  function sensorIsActivePayload(payloadStr) {
    var p = String(payloadStr || '').trim().toLowerCase();
    return p === 'active' || p === '1' || p === 'true' || p === 'on';
  }

  function relayStateFromPayload(payloadStr) {
    var raw = String(payloadStr || '').trim();
    if (!raw) return null;
    if (raw[0] === '{') {
      try {
        var obj = JSON.parse(raw);
        if (typeof obj.on === 'boolean') return obj.on;
        if (typeof obj.on === 'number') return obj.on !== 0;
        if (typeof obj.on === 'string') return relayIsOnPayload(obj.on);
      } catch (e) { /* ignore */ }
    }
    return relayIsOnPayload(raw);
  }

  function sensorStateFromPayload(payloadStr) {
    var raw = String(payloadStr || '').trim();
    if (!raw) return null;
    if (raw[0] === '{') {
      try {
        var obj = JSON.parse(raw);
        if (typeof obj.state === 'boolean') return obj.state;
        if (typeof obj.state === 'number') return obj.state !== 0;
        if (typeof obj.state === 'string') return sensorIsActivePayload(obj.state);
      } catch (e) { /* ignore */ }
    }
    return sensorIsActivePayload(raw);
  }

  function computeBackoffMs(attempt, baseMs, maxMs) {
    var exp = Math.max(0, Number(attempt) || 0);
    var raw = (Number(baseMs) || 1000) * Math.pow(2, exp);
    return Math.min(raw, Number(maxMs) || 30000);
  }

  return {
    mqttTopicMatches: mqttTopicMatches,
    relayIsOnPayload: relayIsOnPayload,
    sensorIsActivePayload: sensorIsActivePayload,
    relayStateFromPayload: relayStateFromPayload,
    sensorStateFromPayload: sensorStateFromPayload,
    computeBackoffMs: computeBackoffMs
  };
});
