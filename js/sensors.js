/* ═══════════════════════════════════════════════════════
   sensors.js  —  Digital sensor display module
   ─────────────────────────────────────────────────────
   The relay controller firmware publishes sensor state
   two ways:

   1. Inside the full state JSON on  {prefix}/v:
        { "relays":[…], "sensors":[{id,name,gpio,active}, …] }

   2. Per-sensor retained topic:
        {prefix}/sensor/{id}/v   →  "active" | "idle"

   This module subscribes to both, renders sensor cards,
   and keeps them updated in real-time.
   ═══════════════════════════════════════════════════════ */

window.SensorModule = (function () {

  var _prefix  = 'home/relay';
  var _sensors = [];   /* [{id, name, gpio, active, lastChange}, …] */

  var _subFull   = null;
  var _subSensor = null;

  var log = function (m, lvl) { window.AppLog && AppLog[lvl || 'info'](m); };

  /* ════════════════════════════════════════════════
     SUBSCRIBE
  ════════════════════════════════════════════════ */

  function _subscribe() {
    _subFull   = MQTTClient.subscribe(_prefix + '/v',           _onFullState);
    _subSensor = MQTTClient.subscribe(_prefix + '/sensor/+/v',  _onSensorState);
    log('[Sensors] subscribed → ' + _prefix);
  }

  function _unsubscribe() {
    if (_subFull)   { _subFull.unsubscribe();   _subFull = null; }
    if (_subSensor) { _subSensor.unsubscribe(); _subSensor = null; }
  }

  /* ── {prefix}/v  (we only care about sensors[]) ── */
  function _onFullState(payloadStr) {
    var json;
    try { json = JSON.parse(payloadStr); } catch (e) { return; }
    if (!Array.isArray(json.sensors) || json.sensors.length === 0) return;

    json.sensors.forEach(function (s) {
      var id  = s.id !== undefined ? s.id : s.index;
      var existing = _sensors.find(function (x) { return x.id === id; });
      if (existing) {
        var wasActive = existing.active;
        existing.name   = s.name  || existing.name;
        existing.gpio   = s.gpio  !== undefined ? s.gpio  : existing.gpio;
        existing.active = !!s.active;
        if (existing.active !== wasActive) existing.lastChange = Date.now();
      } else {
        _sensors.push({
          id:         id,
          name:       s.name || ('Sensor ' + id),
          gpio:       s.gpio !== undefined ? s.gpio : '–',
          active:     !!s.active,
          lastChange: Date.now()
        });
      }
    });

    _render();
    log('[Sensors] ' + _sensors.length + ' sensors updated');
  }

  /* ── {prefix}/sensor/N/v ──────────────────────── */
  function _onSensorState(payloadStr, topic) {
    var parts = topic.split('/');
    var id    = parseInt(parts[parts.length - 2], 10);
    if (isNaN(id)) return;

    var active = window.AppCoreUtils && window.AppCoreUtils.sensorStateFromPayload
      ? window.AppCoreUtils.sensorStateFromPayload(payloadStr)
      : (payloadStr.trim().toLowerCase() === 'active');
    if (active === null) return;
    var sensor = _sensors.find(function (s) { return s.id === id; });

    if (sensor) {
      if (sensor.active !== active) {
        sensor.active     = active;
        sensor.lastChange = Date.now();
        _updateCard(id);
      }
    } else {
      _sensors.push({
        id: id, name: 'Sensor ' + id, gpio: '–',
        active: active, lastChange: Date.now()
      });
      _render();
    }
  }

  /* ════════════════════════════════════════════════
     RENDER — full grid rebuild
  ════════════════════════════════════════════════ */

  function _render() {
    var grid  = document.getElementById('sensor-grid');
    var empty = document.getElementById('sensors-empty');
    if (!grid) return;

    if (!_sensors.length) {
      if (empty) empty.style.display = '';
      grid.innerHTML = '';
      return;
    }

    if (empty) empty.style.display = 'none';

    grid.innerHTML = '';
    _sensors.forEach(function (s) { grid.appendChild(_buildCard(s)); });

    _startElapsedTicker();
  }

  function _buildCard(s) {
    var card = document.createElement('div');
    card.className = 'sensor-card' + (s.active ? ' active' : '');
    card.dataset.id = s.id;

    card.innerHTML =
      '<div class="sensor-card-top">' +
        '<span class="sensor-name">' + _esc(s.name) + '</span>' +
        '<span class="sensor-id-badge">#' + s.id + '</span>' +
      '</div>' +
      '<span class="sensor-state-pill">' +
        '<span class="sensor-pill-dot"></span>' +
        (s.active ? 'ACTIVE' : 'IDLE') +
      '</span>' +
      '<div class="sensor-meta-row">' +
        '<span class="sensor-meta">GPIO ' + s.gpio + '</span>' +
        '<span class="sensor-elapsed" id="sensor-elapsed-' + s.id + '">' +
          _elapsed(s.lastChange) +
        '</span>' +
      '</div>';

    return card;
  }

  function _updateCard(id) {
    var grid   = document.getElementById('sensor-grid');
    var card   = grid && grid.querySelector('.sensor-card[data-id="' + id + '"]');
    var sensor = _sensors.find(function (s) { return s.id === id; });
    if (!card || !sensor) return;

    card.classList.toggle('active', sensor.active);
    var pill = card.querySelector('.sensor-state-pill');
    if (pill) pill.lastChild.textContent = sensor.active ? 'ACTIVE' : 'IDLE';
    var elapsed = card.querySelector('.sensor-elapsed');
    if (elapsed) elapsed.textContent = _elapsed(sensor.lastChange);
  }

  /* ════════════════════════════════════════════════
     ELAPSED TIME TICKER
  ════════════════════════════════════════════════ */

  var _ticker = null;

  function _startElapsedTicker() {
    if (_ticker) clearInterval(_ticker);
    _ticker = setInterval(function () {
      _sensors.forEach(function (s) {
        var el = document.getElementById('sensor-elapsed-' + s.id);
        if (el) el.textContent = _elapsed(s.lastChange);
      });
    }, 5000);
  }

  function _elapsed(ts) {
    if (!ts) return '';
    var sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 5)   return 'just now';
    if (sec < 60)  return sec + 's ago';
    if (sec < 3600) {
      var m = Math.floor(sec / 60);
      return m + 'm ago';
    }
    var h = Math.floor(sec / 3600);
    return h + 'h ago';
  }

  /* ════════════════════════════════════════════════
     LIFECYCLE
  ════════════════════════════════════════════════ */

  function _onDisconnected() {
    if (_ticker) { clearInterval(_ticker); _ticker = null; }
    _sensors = [];
    var grid  = document.getElementById('sensor-grid');
    var empty = document.getElementById('sensors-empty');
    if (grid)  grid.innerHTML = '';
    if (empty) { empty.style.display = ''; empty.querySelector('p').textContent = 'No sensors reported yet'; }
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ════════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════════ */
  return {
    init: function (prefix) {
      if (_prefix !== prefix) _unsubscribe();
      _prefix = prefix;
      _subscribe();
      log('[Sensors] init → ' + prefix);
    },
    onConnected:    function () {},
    onDisconnected: _onDisconnected,
    get sensors()   { return _sensors; }
  };

})();
