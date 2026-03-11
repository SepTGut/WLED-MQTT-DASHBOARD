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

  var log = function (m, lvl) { window.AppLog && AppLog[lvl || 'info'](m); };

  /* ════════════════════════════════════════════════
     SUBSCRIBE
  ════════════════════════════════════════════════ */

  function _subscribe() {
    /* Full state — shares the same /v topic as RelayModule.
       We just look for the sensors[] array inside it.     */
    MQTTClient.subscribe(_prefix + '/v',           _onFullState);
    /* Per-sensor retained state */
    MQTTClient.subscribe(_prefix + '/sensor/+/v',  _onSensorState);
    log('[Sensors] subscribed → ' + _prefix);
  }

  function _unsubscribe() {
    MQTTClient.unsubscribe(_prefix + '/v');
    MQTTClient.unsubscribe(_prefix + '/sensor/+/v');
  }

  /* ── {prefix}/v  (we only care about sensors[]) ── */
  function _onFullState(payloadStr) {
    var json;
    try { json = JSON.parse(payloadStr); } catch (e) { return; }
    if (!Array.isArray(json.sensors) || json.sensors.length === 0) return;

    /* Merge: keep lastChange timestamps already tracked */
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
    /* topic: home/relay/sensor/0/v  →  parts[-2] = "0" */
    var id    = parseInt(parts[parts.length - 2], 10);
    if (isNaN(id)) return;

    var active = (payloadStr.trim().toLowerCase() === 'active');
    var sensor = _sensors.find(function (s) { return s.id === id; });

    if (sensor) {
      if (sensor.active !== active) {
        sensor.active     = active;
        sensor.lastChange = Date.now();
        _updateCard(id);
      }
    } else {
      /* First time we hear about this sensor — add a stub */
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

    /* Full rebuild — sensors don't change often */
    grid.innerHTML = '';
    _sensors.forEach(function (s) { grid.appendChild(_buildCard(s)); });

    /* Start elapsed-time ticker */
    _startElapsedTicker();
  }

  /* ── build one sensor card ──────────────────────── */
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

  /* ── update an existing card in-place ───────────── */
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
    }, 5000);   /* update every 5 s */
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

  /* ════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════ */
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
    onConnected:    function () { /* prefix set via app.js wrapper */ },
    onDisconnected: _onDisconnected,
    get sensors()   { return _sensors; }
  };

})();

/* ════════════════════════════════════════════════════
   Inject sensor-specific CSS
════════════════════════════════════════════════════ */
(function () {
  var s = document.createElement('style');
  s.textContent = `
    /* ── sensor card ── */
    .sensor-card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 6px;
    }

    .sensor-id-badge {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--color-text-muted);
      background: var(--color-surface-2);
      border-radius: var(--radius-sm);
      padding: 2px 5px;
      flex-shrink: 0;
    }

    .sensor-state-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: var(--radius-full);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .06em;
      background: var(--color-surface-2);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      width: fit-content;
      transition: all var(--transition);
    }

    .sensor-pill-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-text-muted);
      flex-shrink: 0;
      transition: background var(--transition);
    }

    .sensor-card.active .sensor-state-pill {
      background: var(--color-sensor-on);
      color: #000;
      border-color: var(--color-sensor-on);
      animation: sensor-pulse 2s infinite;
    }

    .sensor-card.active .sensor-pill-dot {
      background: rgba(0,0,0,.4);
    }

    @keyframes sensor-pulse {
      0%, 100% { box-shadow: 0 0 0 0   var(--color-sensor-on); }
      50%       { box-shadow: 0 0 0 5px rgba(56,212,212,0); }
    }

    .sensor-meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
    }

    .sensor-meta {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--color-text-muted);
    }

    .sensor-elapsed {
      font-size: 10px;
      color: var(--color-text-muted);
      white-space: nowrap;
    }
  `;
  document.head.appendChild(s);
})();
