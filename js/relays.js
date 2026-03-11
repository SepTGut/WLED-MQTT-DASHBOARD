/* ═══════════════════════════════════════════════════════
   relays.js  —  Relay control module
   ─────────────────────────────────────────────────────
   Handles:
   • Subscribing to {prefix}/v and {prefix}/relay/+/v
   • Rendering relay cards from received MQTT state
   • Toggle / Pulse / Timer commands per relay
   • Pattern sequencer UI (build steps + run/stop)
   • onConnected / onDisconnected lifecycle hooks
   ═══════════════════════════════════════════════════════ */

window.RelayModule = (function () {

  /* ── state ──────────────────────────────────────── */
  let _prefix = 'home/relay';
  let _relays = [];       // [{id, name, on, timer}, …]
  let _timers = {};       // id → setInterval handle (countdown)
  let _patternSteps = []; // [{mask, duration_ms}, …]

  /* ── logging shortcut ───────────────────────────── */
  const log = (m, lvl='info') => window.AppLog && AppLog[lvl](m);

  /* ════════════════════════════════════════════════
     MQTT SUBSCRIPTIONS
  ════════════════════════════════════════════════ */

  function _subscribe() {
    MQTTClient.subscribe(_prefix + '/v',          _onFullState);
    MQTTClient.subscribe(_prefix + '/relay/+/v',  _onRelayState);
    log('[Relays] subscribed → ' + _prefix);
  }

  function _unsubscribe() {
    MQTTClient.unsubscribe(_prefix + '/v');
    MQTTClient.unsubscribe(_prefix + '/relay/+/v');
  }

  /* ── {prefix}/v  full JSON state ──────────────── */
  function _onFullState(payloadStr) {
    let json;
    try { json = JSON.parse(payloadStr); }
    catch (e) { log('[Relays] bad JSON: ' + e, 'error'); return; }
    if (!Array.isArray(json.relays)) return;
    _relays = json.relays.map(function(r) {
      return {
        id:    r.id    !== undefined ? r.id : 0,
        name:  r.name  || ('Relay ' + r.id),
        on:    !!r.on,
        timer: Number(r.timer) || 0
      };
    });
    _render();
    log('[Relays] ' + _relays.length + ' relays updated', 'success');
  }

  /* ── {prefix}/relay/N/v  per-relay ────────────── */
  function _onRelayState(payloadStr, topic) {
    var parts = topic.split('/');
    var id    = parseInt(parts[parts.length - 2], 10);
    if (isNaN(id)) return;
    var on    = (payloadStr.trim().toLowerCase() === 'on');
    var relay = _relays.find(function(r){ return r.id === id; });
    if (relay) { relay.on = on; _updateCard(id); }
  }

  /* ════════════════════════════════════════════════
     SEND COMMANDS
  ════════════════════════════════════════════════ */

  function _toggle(id) {
    MQTTClient.publishJSON(_prefix + '/api', { relay: id, on: 't' });
    log('→ Toggle relay ' + id);
    var r = _relays.find(function(r){ return r.id === id; });
    if (r) { r.on = !r.on; _updateCard(id); }
  }

  function _pulse(id, ms) {
    ms = Math.max(50, parseInt(ms, 10) || 500);
    MQTTClient.publishJSON(_prefix + '/api', { relay: id, pulse: ms });
    log('→ Pulse relay ' + id + ' for ' + ms + ' ms');
  }

  function _setTimer(id, sec) {
    sec = Math.max(1, parseInt(sec, 10) || 10);
    MQTTClient.publishJSON(_prefix + '/api', { relay: id, timer: sec });
    log('→ Timer relay ' + id + ' for ' + sec + ' s');
  }

  /* ════════════════════════════════════════════════
     RENDER — full grid rebuild
  ════════════════════════════════════════════════ */

  function _render() {
    var grid  = document.getElementById('relay-grid');
    var empty = document.getElementById('relay-empty');
    if (!grid) return;

    /* stop all countdowns */
    Object.keys(_timers).forEach(function(k){ clearInterval(_timers[k]); });
    _timers = {};

    if (!_relays.length) {
      if (empty) empty.style.display = '';
      Array.from(grid.children).forEach(function(c){
        if (c.id !== 'relay-empty') c.remove();
      });
      return;
    }

    if (empty) empty.style.display = 'none';

    /* remove old cards */
    Array.from(grid.children).forEach(function(c){
      if (c.id !== 'relay-empty') c.remove();
    });

    /* add new cards */
    _relays.forEach(function(r){ grid.appendChild(_buildCard(r)); });

    /* start countdowns */
    _relays.forEach(function(r){ if (r.timer > 0) _startCountdown(r.id, r.timer); });

    /* enable pattern run button */
    var btnRun = document.getElementById('btn-pattern-run');
    if (btnRun) btnRun.disabled = !MQTTClient.connected;
  }

  /* ── build one relay card ──────────────────────── */
  function _buildCard(r) {
    var card = document.createElement('div');
    card.className = 'relay-card' + (r.on ? ' on' : '');
    card.dataset.id = r.id;

    card.innerHTML =
      '<div class="relay-card-top">' +
        '<span class="relay-name">' + _esc(r.name) + '</span>' +
        '<span class="relay-id-badge">#' + r.id + '</span>' +
      '</div>' +
      '<button class="relay-toggle" data-action="toggle" aria-label="Toggle relay ' + r.id + '">' +
        (r.on ? 'ON' : 'OFF') +
      '</button>' +
      '<div class="relay-actions">' +
        '<button class="relay-action-btn" data-action="pulse" title="Momentary pulse">Pulse</button>' +
        '<button class="relay-action-btn" data-action="timer" title="Auto-off timer">Timer</button>' +
      '</div>' +
      '<div class="relay-timer" id="relay-timer-' + r.id + '">' +
        (r.timer > 0 ? _fmtSec(r.timer) : '') +
      '</div>';

    card.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var id     = parseInt(card.dataset.id, 10);
      if      (action === 'toggle') { _toggle(id); }
      else if (action === 'pulse')  { _showPulseSheet(id, btn, card); }
      else if (action === 'timer')  { _showTimerSheet(id, btn, card); }
    });

    return card;
  }

  /* ── update an existing card without full rebuild ── */
  function _updateCard(id) {
    var grid  = document.getElementById('relay-grid');
    var card  = grid && grid.querySelector('.relay-card[data-id="' + id + '"]');
    var relay = _relays.find(function(r){ return r.id === id; });
    if (!card || !relay) return;
    card.classList.toggle('on', relay.on);
    var btn = card.querySelector('[data-action="toggle"]');
    if (btn) btn.textContent = relay.on ? 'ON' : 'OFF';
  }

  /* ════════════════════════════════════════════════
     INLINE SHEETS (pulse / timer input)
  ════════════════════════════════════════════════ */

  function _clearSheet() {
    document.querySelectorAll('.relay-inline-sheet').forEach(function(s){ s.remove(); });
  }

  function _showPulseSheet(id, anchor, card) {
    _clearSheet();
    var sheet = document.createElement('div');
    sheet.className = 'relay-inline-sheet';
    sheet.innerHTML =
      '<p class="sheet-label">Pulse duration</p>' +
      '<div class="sheet-row">' +
        '<button class="sheet-preset" data-val="100">100ms</button>' +
        '<button class="sheet-preset" data-val="250">250ms</button>' +
        '<button class="sheet-preset" data-val="500">500ms</button>' +
        '<button class="sheet-preset" data-val="1000">1 s</button>' +
        '<button class="sheet-preset" data-val="2000">2 s</button>' +
      '</div>' +
      '<div class="sheet-custom-row">' +
        '<input type="number" class="sheet-input" id="sheet-pulse-in" value="500" min="50" max="30000" placeholder="ms"/>' +
        '<span class="sheet-unit">ms</span>' +
        '<button class="primary-btn sheet-go" id="sheet-pulse-go">Go</button>' +
      '</div>';

    sheet.querySelectorAll('.sheet-preset').forEach(function(b){
      b.addEventListener('click', function(){ _pulse(id, b.dataset.val); _clearSheet(); });
    });
    sheet.querySelector('#sheet-pulse-go').addEventListener('click', function(){
      _pulse(id, sheet.querySelector('#sheet-pulse-in').value);
      _clearSheet();
    });

    card.appendChild(sheet);
    _outsideClose(sheet);
  }

  function _showTimerSheet(id, anchor, card) {
    _clearSheet();
    var sheet = document.createElement('div');
    sheet.className = 'relay-inline-sheet';
    sheet.innerHTML =
      '<p class="sheet-label">Auto-off timer</p>' +
      '<div class="sheet-row">' +
        '<button class="sheet-preset" data-val="10">10 s</button>' +
        '<button class="sheet-preset" data-val="30">30 s</button>' +
        '<button class="sheet-preset" data-val="60">1 m</button>' +
        '<button class="sheet-preset" data-val="300">5 m</button>' +
        '<button class="sheet-preset" data-val="600">10 m</button>' +
      '</div>' +
      '<div class="sheet-custom-row">' +
        '<input type="number" class="sheet-input" id="sheet-timer-in" value="60" min="1" max="86400" placeholder="sec"/>' +
        '<span class="sheet-unit">s</span>' +
        '<button class="primary-btn sheet-go" id="sheet-timer-go">Go</button>' +
      '</div>';

    sheet.querySelectorAll('.sheet-preset').forEach(function(b){
      b.addEventListener('click', function(){ _setTimer(id, b.dataset.val); _clearSheet(); });
    });
    sheet.querySelector('#sheet-timer-go').addEventListener('click', function(){
      _setTimer(id, sheet.querySelector('#sheet-timer-in').value);
      _clearSheet();
    });

    card.appendChild(sheet);
    _outsideClose(sheet);
  }

  function _outsideClose(sheet) {
    setTimeout(function(){
      document.addEventListener('click', function _c(e){
        if (!sheet.contains(e.target)){ _clearSheet(); document.removeEventListener('click',_c); }
      });
    }, 0);
  }

  /* ════════════════════════════════════════════════
     COUNTDOWN DISPLAY
  ════════════════════════════════════════════════ */

  function _startCountdown(id, sec) {
    var remaining = sec;
    var el = document.getElementById('relay-timer-' + id);
    if (!el) return;
    el.textContent = _fmtSec(remaining);
    _timers[id] = setInterval(function(){
      remaining--;
      if (!el.isConnected || remaining <= 0) {
        clearInterval(_timers[id]);
        delete _timers[id];
        if (el.isConnected) el.textContent = '';
        return;
      }
      el.textContent = _fmtSec(remaining);
    }, 1000);
  }

  function _fmtSec(s) {
    if (s >= 3600) {
      var h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
      return h + 'h ' + String(m).padStart(2,'0') + 'm';
    }
    if (s >= 60) {
      var m2 = Math.floor(s/60), r = s%60;
      return m2 + ':' + String(r).padStart(2,'0');
    }
    return s + 's';
  }

  /* ════════════════════════════════════════════════
     PATTERN SEQUENCER UI
  ════════════════════════════════════════════════ */

  function _initPatternUI() {
    var btnAdd  = document.getElementById('btn-add-step');
    var btnRun  = document.getElementById('btn-pattern-run');
    var btnStop = document.getElementById('btn-pattern-stop');

    btnAdd && btnAdd.addEventListener('click', function(){
      _patternSteps.push({ mask: 1, duration_ms: 500 });
      _renderPatternSteps();
    });

    btnRun && btnRun.addEventListener('click', function(){
      if (!_patternSteps.length){ log('[Pattern] No steps', 'warning'); return; }
      var repeat = parseInt(document.getElementById('pattern-repeat').value, 10);
      MQTTClient.publishJSON(_prefix + '/api', { pattern: { steps: _patternSteps, repeat: repeat } });
      log('→ Pattern started (' + _patternSteps.length + ' steps, repeat=' + repeat + ')');
    });

    btnStop && btnStop.addEventListener('click', function(){
      MQTTClient.publishJSON(_prefix + '/api', { pattern: 'stop' });
      log('→ Pattern stopped');
    });

    if (!_patternSteps.length) _patternSteps = [{ mask: 1, duration_ms: 500 }];
    _renderPatternSteps();
  }

  function _renderPatternSteps() {
    var container = document.getElementById('pattern-steps');
    var btnRun    = document.getElementById('btn-pattern-run');
    if (!container) return;
    container.innerHTML = '';

    _patternSteps.forEach(function(step, i){
      var row = document.createElement('div');
      row.className = 'pattern-step';

      /* relay bit checkboxes */
      var maxBit = Math.max(_relays.length, 8);
      var bitsHtml = '';
      for (var b = 0; b < Math.min(maxBit, 16); b++) {
        var checked = ((step.mask >> b) & 1) ? 'checked' : '';
        var label   = (_relays[b] ? _relays[b].name : 'R'+b);
        bitsHtml +=
          '<label class="pattern-bit-label" title="' + _esc(label) + '">' +
            '<input type="checkbox" class="pattern-bit" data-bit="' + b + '" ' + checked + '/>' +
            '<span>' + b + '</span>' +
          '</label>';
      }

      row.innerHTML =
        '<div class="pattern-step-header">' +
          '<span class="pattern-step-num">Step ' + (i+1) + '</span>' +
          '<button class="pattern-step-remove" data-idx="' + i + '" title="Remove">×</button>' +
        '</div>' +
        '<div class="pattern-bit-row">' + bitsHtml + '</div>' +
        '<div class="pattern-step-meta">' +
          '<span class="pattern-step-label">Duration</span>' +
          '<input type="number" class="field-input pattern-dur" value="' + step.duration_ms + '" min="50" max="60000" step="50"/>' +
          '<span class="pattern-step-label">ms</span>' +
        '</div>';

      /* bit toggles */
      row.querySelectorAll('.pattern-bit').forEach(function(cb){
        cb.addEventListener('change', function(){
          var mask = 0;
          row.querySelectorAll('.pattern-bit').forEach(function(c){
            if (c.checked) mask |= (1 << parseInt(c.dataset.bit, 10));
          });
          _patternSteps[i].mask = mask;
        });
      });

      /* duration change */
      row.querySelector('.pattern-dur').addEventListener('input', function(e){
        _patternSteps[i].duration_ms = Math.max(50, parseInt(e.target.value,10) || 500);
      });

      /* remove step */
      row.querySelector('.pattern-step-remove').addEventListener('click', function(){
        _patternSteps.splice(i, 1);
        _renderPatternSteps();
      });

      container.appendChild(row);
    });

    if (btnRun) btnRun.disabled = (!MQTTClient.connected || _patternSteps.length === 0);
  }

  /* ════════════════════════════════════════════════
     LIFECYCLE HOOKS
  ════════════════════════════════════════════════ */

  function _onDisconnected() {
    Object.keys(_timers).forEach(function(k){ clearInterval(_timers[k]); });
    _timers  = {};
    _relays  = [];
    var empty = document.getElementById('relay-empty');
    var grid  = document.getElementById('relay-grid');
    if (empty) { empty.querySelector('p').textContent = 'Connect to broker to see relays'; empty.style.display = ''; }
    if (grid)  { Array.from(grid.children).forEach(function(c){ if (c.id !== 'relay-empty') c.remove(); }); }
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
    init: function(prefix) {
      if (_prefix !== prefix) _unsubscribe();
      _prefix = prefix;
      _subscribe();
      _initPatternUI();
      MQTTClient.publish(_prefix + '/ping', '1');
      log('[Relays] init → ' + prefix);
    },
    onConnected:    function(){ /* prefix set by init() via app.js wrapper */ },
    onDisconnected: _onDisconnected,
    get relays(){ return _relays; }
  };

})();

/* ════════════════════════════════════════════════════
   Inject component-specific CSS (keeps layout.css clean)
════════════════════════════════════════════════════ */
(function(){
  var s = document.createElement('style');
  s.textContent = `
    .relay-inline-sheet {
      background: var(--color-surface-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 10px;
      margin-top: 8px;
      animation: sheet-in .15s ease;
    }
    @keyframes sheet-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }

    .sheet-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: .06em;
      margin-bottom: 7px;
    }
    .sheet-row {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 8px;
    }
    .sheet-preset {
      padding: 4px 9px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 600;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      color: var(--color-text);
      transition: all var(--transition);
    }
    .sheet-preset:hover { border-color: var(--color-accent); color: var(--color-accent); }
    .sheet-custom-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .sheet-input {
      flex: 1;
      padding: 6px 9px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text);
      font-size: 13px;
    }
    .sheet-input:focus { outline: none; border-color: var(--color-accent); }
    .sheet-unit { font-size: 11px; color: var(--color-text-muted); flex-shrink: 0; }
    .sheet-go   { flex-shrink: 0; padding: 6px 14px !important; font-size: 12px !important; }

    .pattern-step {
      background: var(--color-surface-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pattern-step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .pattern-step-num {
      font-size: 11px;
      font-weight: 700;
      color: var(--color-accent);
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .pattern-step-remove {
      color: var(--color-danger);
      font-size: 18px;
      line-height: 1;
      width: 24px; height: 24px;
      border-radius: var(--radius-sm);
      display: flex; align-items: center; justify-content: center;
      transition: background var(--transition);
    }
    .pattern-step-remove:hover { background: rgba(240,106,106,.15); }

    .pattern-bit-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pattern-bit-label {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      font-size: 10px;
      color: var(--color-text-muted);
      cursor: pointer;
      user-select: none;
      min-width: 22px;
    }
    .pattern-bit-label input {
      cursor: pointer;
      accent-color: var(--color-accent);
      width: 14px; height: 14px;
    }
    .pattern-bit-label:has(input:checked) { color: var(--color-accent); font-weight: 700; }

    .pattern-step-meta {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pattern-dur {
      width: 80px !important;
      padding: 5px 8px !important;
      font-size: 12px !important;
    }

    .pattern-footer {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
  `;
  document.head.appendChild(s);
})();
