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

  function parseJsonObject(payloadStr) {
    var raw = String(payloadStr || '').trim();
    if (!raw || raw[0] !== '{') return null;
    try {
      var obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function boolFromValue(value, truthyParser) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return truthyParser(value);
    return null;
  }

  function relayStateFromPayload(payloadStr) {
    var raw = String(payloadStr || '').trim();
    if (!raw) return null;
    var obj = parseJsonObject(raw);
    if (obj) {
      var on = boolFromValue(obj.on, relayIsOnPayload);
      if (on !== null) return on;
      var state = boolFromValue(obj.state, relayIsOnPayload);
      if (state !== null) return state;
    }
    return relayIsOnPayload(raw);
  }

  function sensorStateFromPayload(payloadStr) {
    var raw = String(payloadStr || '').trim();
    if (!raw) return null;
    var obj = parseJsonObject(raw);
    if (obj) {
      var state = boolFromValue(obj.state, sensorIsActivePayload);
      if (state !== null) return state;
      var compact = boolFromValue(obj.s, sensorIsActivePayload);
      if (compact !== null) return compact;
      var active = boolFromValue(obj.active, sensorIsActivePayload);
      if (active !== null) return active;
    }
    return sensorIsActivePayload(raw);
  }

  function relayTimerFromObject(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    var v = obj.timer_remaining;
    if (v === undefined) v = obj.timer;
    if (v === undefined) v = obj.tr;
    return Math.max(0, Number(v) || 0);
  }

  function normalizeRelayList(state) {
    if (!state || typeof state !== 'object') return [];
    var list = Array.isArray(state.relays) ? state.relays : (Array.isArray(state.r) ? state.r : []);
    return list.map(function (r, index) {
      var id = r.id !== undefined ? Number(r.id) : index;
      var on = boolFromValue(r.on, relayIsOnPayload);
      if (on === null) on = false;
      return {
        id: id,
        name: r.name || r.n || ('Relay ' + id),
        on: on,
        timer: relayTimerFromObject(r)
      };
    });
  }

  function normalizeSensorList(state) {
    if (!state || typeof state !== 'object') return [];
    var list = Array.isArray(state.sensors) ? state.sensors : (Array.isArray(state.s) ? state.s : []);
    return list.map(function (s, index) {
      var id = s.id !== undefined ? Number(s.id) : (s.index !== undefined ? Number(s.index) : index);
      var active = boolFromValue(s.active, sensorIsActivePayload);
      if (active === null) active = boolFromValue(s.state, sensorIsActivePayload);
      if (active === null) active = boolFromValue(s.s, sensorIsActivePayload);
      if (active === null) active = false;
      var elapsedSec = s.lc !== undefined ? Math.max(0, Number(s.lc) || 0) : null;
      return {
        id: id,
        name: s.name || s.n || ('Sensor ' + id),
        gpio: s.gpio !== undefined ? s.gpio : (s.pin !== undefined ? s.pin : '-'),
        active: active,
        lastChange: elapsedSec !== null ? Date.now() - (elapsedSec * 1000) : Date.now()
      };
    });
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
    relayTimerFromObject: relayTimerFromObject,
    normalizeRelayList: normalizeRelayList,
    normalizeSensorList: normalizeSensorList,
    computeBackoffMs: computeBackoffMs
  };
});
