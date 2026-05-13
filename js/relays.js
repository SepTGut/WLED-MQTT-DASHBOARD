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
  let _pendingState = {}; // id -> expected bool

  /* ── subscription handles ───────────────────────── */
  let _subFull = null;
  let _subSingle = null;
  let _subDetail = null;

  /* ── logging shortcut ───────────────────────────── */
  const log = (m, lvl = 'info') => window.AppLog && AppLog[lvl](m);

  /* ════════════════════════════════════════════════
     MQTT SUBSCRIPTIONS
  ════════════════════════════════════════════════ */

  function _subscribe() {
    _subFull = MQTTClient.subscribe(_prefix + '/v', _onFullState);
    _subSingle = MQTTClient.subscribe(_prefix + '/relay/+/v', _onRelayState);
    _subDetail = MQTTClient.subscribe(_prefix + '/relay/+/detail', _onRelayDetail);
    log('[Relays] subscribed → ' + _prefix);
  }

  function _unsubscribe() {
    if (_subFull) { _subFull.unsubscribe(); _subFull = null; }
    if (_subSingle) { _subSingle.unsubscribe(); _subSingle = null; }
    if (_subDetail) { _subDetail.unsubscribe(); _subDetail = null; }
  }

  /* ── {prefix}/v  full JSON state ──────────────── */
  function _onFullState(payloadStr) {
    let json;
    try { json = JSON.parse(payloadStr); }
    catch (e) { log('[Relays] bad JSON: ' + e, 'error'); return; }
    var relays = window.AppCoreUtils && window.AppCoreUtils.normalizeRelayList
      ? window.AppCoreUtils.normalizeRelayList(json)
      : [];
    if (!relays.length && !Array.isArray(json.relays) && !Array.isArray(json.r)) return;

    _relays = relays.map(function (next) {
      var existing = _relays.find(function (r) { return r.id === next.id; });
      if (existing) {
        if (!next.name || next.name === ('Relay ' + next.id)) next.name = existing.name;
        next.timer = next.timer || existing.timer || 0;
      }
      return next;
    });
    _pendingState = {};
    _render();
    log('[Relays] ' + _relays.length + ' relays updated', 'success');
  }

  /* ── {prefix}/relay/N/v  per-relay ────────────── */
  function _onRelayState(payloadStr, topic) {
    var parts = topic.split('/');
    var id = parseInt(parts[parts.length - 2], 10);
    if (isNaN(id)) return;

    var payloadObj = null;
    try { payloadObj = JSON.parse(payloadStr); } catch (e) { }
    var on = null;
    var timer = null;
    var name = null;
    if (payloadObj && typeof payloadObj === 'object') {
      if (typeof payloadObj.on === 'boolean') on = payloadObj.on;
      else if (typeof payloadObj.on === 'number') on = payloadObj.on !== 0;
      else if (typeof payloadObj.on === 'string') {
        on = window.AppCoreUtils && window.AppCoreUtils.relayIsOnPayload
          ? window.AppCoreUtils.relayIsOnPayload(payloadObj.on)
          : payloadObj.on.trim().toLowerCase() === 'on';
      }
      if (payloadObj.tr !== undefined) timer = Number(payloadObj.tr);
      else if (payloadObj.timer_remaining !== undefined) timer = Number(payloadObj.timer_remaining);
      else if (payloadObj.timer !== undefined) timer = Number(payloadObj.timer);
      if (payloadObj.n !== undefined) name = payloadObj.n;
      else if (payloadObj.name !== undefined) name = payloadObj.name;
    } else {
      on = window.AppCoreUtils && window.AppCoreUtils.relayStateFromPayload
        ? window.AppCoreUtils.relayStateFromPayload(payloadStr)
        : (payloadStr.trim().toLowerCase() === 'on');
    }
    if (on === null) return;

    var relay = _relays.find(function (r) { return r.id === id; });
    if (relay) {
      relay.on = on;
      if (name) relay.name = name;
      if (!isNaN(timer)) relay.timer = timer;
      if (_pendingState[id] !== undefined && _pendingState[id] === on) delete _pendingState[id];
      _updateCard(id);
      // restart countdown if timer changed
      if (timer > 0) {
        clearInterval(_timers[id]);
        _startCountdown(id, timer);
      }
    } else {
      _relays.push({
        id: id,
        name: name || ('Relay ' + id),
        on: on,
        timer: !isNaN(timer) ? timer : 0
      });
      _render();
    }
  }

  function _onRelayDetail(payloadStr, topic) {
    var parts = topic.split('/');
    var id = parseInt(parts[parts.length - 2], 10);
    if (isNaN(id)) return;

    var detail;
    try { detail = JSON.parse(payloadStr); } catch (e) { return; }
    if (!detail || typeof detail !== 'object') return;

    var on = window.AppCoreUtils && window.AppCoreUtils.relayStateFromPayload
      ? window.AppCoreUtils.relayStateFromPayload(payloadStr)
      : !!detail.on;
    var timer = window.AppCoreUtils && window.AppCoreUtils.relayTimerFromObject
      ? window.AppCoreUtils.relayTimerFromObject(detail)
      : Number(detail.timer_remaining) || 0;
    var relay = _relays.find(function (r) { return r.id === id; });

    if (relay) {
      relay.name = detail.name || relay.name;
      if (on !== null) relay.on = on;
      relay.timer = timer;
      _updateCard(id);
    } else {
      _relays.push({
        id: id,
        name: detail.name || ('Relay ' + id),
        on: on === null ? false : on,
        timer: timer
      });
      _render();
    }
  }

  /* ════════════════════════════════════════════════
     SEND COMMANDS
  ════════════════════════════════════════════════ */

  function _toggle(id) {
    var r = _relays.find(function (x) { return x.id === id; });
    if (!r) return;
    // 🛡️ Prevent double‑click while a command is pending
    if (_pendingState[id] !== undefined) return;

    _pendingState[id] = !r.on;
    MQTTClient.publish(_prefix + '/relay/' + id + '/set', 'toggle');
    log('→ Toggle relay ' + id + ' (pending confirmation)');

    // Flash timeout: if confirmation doesn't arrive in 3s, revert and flash error
    var timeout = setTimeout(function () {
      if (_pendingState[id] !== undefined) {
        delete _pendingState[id];
        _updateCard(id);
        var card = document.querySelector('.relay-card[data-id="' + id + '"]');
        if (card) {
          card.classList.add('flash-error');
          setTimeout(function () { card.classList.remove('flash-error'); }, 600);
        }
        log('⚠ Relay ' + id + ' toggle timeout – no response', 'warning');
      }
    }, 3000);

    // The confirmation will arrive via _onRelayState, which clears pendingState.
    // Once pending state is cleared, we flash the card.
    var checkConfirm = setInterval(function () {
      if (_pendingState[id] === undefined) {
        clearInterval(checkConfirm);
        clearTimeout(timeout);
        var card = document.querySelector('.relay-card[data-id="' + id + '"]');
        if (card) {
          card.classList.add('flash-success');
          setTimeout(function () { card.classList.remove('flash-success'); }, 600);
        }
      }
    }, 100);
  }

  function _pulse(id, ms) {
    ms = Math.max(50, parseInt(ms, 10) || 500);
    MQTTClient.publishJSON(_prefix + '/set/relay/' + id, { pulse: ms });
    log('→ Pulse relay ' + id + ' for ' + ms + ' ms');
  }

  function _setTimer(id, sec) {
    sec = Math.max(1, parseInt(sec, 10) || 10);
    MQTTClient.publishJSON(_prefix + '/set/relay/' + id, { timer: sec });
    log('→ Timer relay ' + id + ' for ' + sec + ' s');
  }

  /* ════════════════════════════════════════════════
     RENDER — full grid rebuild
  ════════════════════════════════════════════════ */

  function _render() {
    var grid = document.getElementById('relay-grid');
    var empty = document.getElementById('relay-empty');
    if (!grid) return;

    Object.keys(_timers).forEach(function (k) { clearInterval(_timers[k]); });
    _timers = {};

    if (!_relays.length) {
      if (empty) empty.style.display = '';
      Array.from(grid.children).forEach(function (c) {
        if (c.id !== 'relay-empty') c.remove();
      });
      return;
    }

    if (empty) empty.style.display = 'none';

    Array.from(grid.children).forEach(function (c) {
      if (c.id !== 'relay-empty') c.remove();
    });

    _relays.forEach(function (r) { grid.appendChild(_buildCard(r)); });

    _relays.forEach(function (r) { if (r.timer > 0) _startCountdown(r.id, r.timer); });

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

    card.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var id = parseInt(card.dataset.id, 10);

      // 🛡️ Prevent double‑click while a command is pending
      if (action === 'toggle' && _pendingState[id] !== undefined) return;

      if (action === 'toggle') { _toggle(id); }
      else if (action === 'pulse') { _showPulseSheet(id, btn, card); }
      else if (action === 'timer') { _showTimerSheet(id, btn, card); }
    });

    return card;
  }

  /* ── update an existing card without full rebuild ── */
  function _updateCard(id) {
    var grid = document.getElementById('relay-grid');
    var card = grid && grid.querySelector('.relay-card[data-id="' + id + '"]');
    var relay = _relays.find(function (r) { return r.id === id; });
    if (!card || !relay) return;
    card.classList.toggle('on', relay.on);
    card.classList.toggle('pending', _pendingState[id] !== undefined);
    var btn = card.querySelector('[data-action="toggle"]');
    if (btn) {
      if (_pendingState[id] !== undefined) btn.textContent = '...';
      else btn.textContent = relay.on ? 'ON' : 'OFF';
    }
    var nameEl = card.querySelector('.relay-name');
    if (nameEl) nameEl.textContent = relay.name;
    var timerEl = document.getElementById('relay-timer-' + id);
    if (timerEl) {
      timerEl.textContent = relay.timer > 0 ? _fmtSec(relay.timer) : '';
    }
  }

  /* ════════════════════════════════════════════════
     INLINE SHEETS (pulse / timer input)
  ════════════════════════════════════════════════ */

  function _clearSheet() {
    document.querySelectorAll('.relay-inline-sheet').forEach(function (s) { s.remove(); });
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

    sheet.querySelectorAll('.sheet-preset').forEach(function (b) {
      b.addEventListener('click', function () { _pulse(id, b.dataset.val); _clearSheet(); });
    });
    sheet.querySelector('#sheet-pulse-go').addEventListener('click', function () {
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

    sheet.querySelectorAll('.sheet-preset').forEach(function (b) {
      b.addEventListener('click', function () { _setTimer(id, b.dataset.val); _clearSheet(); });
    });
    sheet.querySelector('#sheet-timer-go').addEventListener('click', function () {
      _setTimer(id, sheet.querySelector('#sheet-timer-in').value);
      _clearSheet();
    });

    card.appendChild(sheet);
    _outsideClose(sheet);
  }

  function _outsideClose(sheet) {
    setTimeout(function () {
      document.addEventListener('click', function _c(e) {
        if (!sheet.contains(e.target)) { _clearSheet(); document.removeEventListener('click', _c); }
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
    clearInterval(_timers[id]);
    _timers[id] = setInterval(function () {
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
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return h + 'h ' + String(m).padStart(2, '0') + 'm';
    }
    if (s >= 60) {
      var m2 = Math.floor(s / 60), r = s % 60;
      return m2 + ':' + String(r).padStart(2, '0');
    }
    return s + 's';
  }

  /* ════════════════════════════════════════════════
     PATTERN SEQUENCER UI
  ════════════════════════════════════════════════ */

  var _patternUiWired = false;

  function _initPatternUI() {
    if (_patternUiWired) return;
    _patternUiWired = true;
    var btnAdd = document.getElementById('btn-add-step');
    var btnRun = document.getElementById('btn-pattern-run');
    var btnStop = document.getElementById('btn-pattern-stop');

    btnAdd && btnAdd.addEventListener('click', function () {
      _patternSteps.push({ mask: 1, duration_ms: 500 });
      _renderPatternSteps();
    });

    btnRun && btnRun.addEventListener('click', function () {
      if (!_patternSteps.length) { log('[Pattern] No steps', 'warning'); return; }
      var repeat = parseInt(document.getElementById('pattern-repeat').value, 10);
      MQTTClient.publishJSON(_prefix + '/set/pattern/run', { steps: _patternSteps, repeat: repeat });
      log('→ Pattern started (' + _patternSteps.length + ' steps, repeat=' + repeat + ')');
    });

    btnStop && btnStop.addEventListener('click', function () {
      MQTTClient.publish(_prefix + '/set/pattern/stop', '');
      log('→ Pattern stopped');
    });

    if (!_patternSteps.length) _patternSteps = [{ mask: 1, duration_ms: 500 }];
    _renderPatternSteps();
  }

  function _renderPatternSteps() {
    var container = document.getElementById('pattern-steps');
    var btnRun = document.getElementById('btn-pattern-run');
    if (!container) return;
    container.innerHTML = '';

    _patternSteps.forEach(function (step, i) {
      var row = document.createElement('div');
      row.className = 'pattern-step';

      var maxBit = Math.max(_relays.length, 8);
      var bitsHtml = '';
      for (var b = 0; b < Math.min(maxBit, 16); b++) {
        var checked = ((step.mask >> b) & 1) ? 'checked' : '';
        var label = (_relays[b] ? _relays[b].name : 'R' + b);
        bitsHtml +=
          '<label class="pattern-bit-label" title="' + _esc(label) + '">' +
          '<input type="checkbox" class="pattern-bit" data-bit="' + b + '" ' + checked + '/>' +
          '<span>' + b + '</span>' +
          '</label>';
      }

      row.innerHTML =
        '<div class="pattern-step-header">' +
        '<span class="pattern-step-num">Step ' + (i + 1) + '</span>' +
        '<button class="pattern-step-remove" data-idx="' + i + '" title="Remove">×</button>' +
        '</div>' +
        '<div class="pattern-bit-row">' + bitsHtml + '</div>' +
        '<div class="pattern-step-meta">' +
        '<span class="pattern-step-label">Duration</span>' +
        '<input type="number" class="field-input pattern-dur" value="' + step.duration_ms + '" min="50" max="60000" step="50"/>' +
        '<span class="pattern-step-label">ms</span>' +
        '</div>';

      row.querySelectorAll('.pattern-bit').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var mask = 0;
          row.querySelectorAll('.pattern-bit').forEach(function (c) {
            if (c.checked) mask |= (1 << parseInt(c.dataset.bit, 10));
          });
          _patternSteps[i].mask = mask;
        });
      });

      row.querySelector('.pattern-dur').addEventListener('input', function (e) {
        _patternSteps[i].duration_ms = Math.max(50, parseInt(e.target.value, 10) || 500);
      });

      row.querySelector('.pattern-step-remove').addEventListener('click', function () {
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
        Object.keys(_timers).forEach(function (k) { clearInterval(_timers[k]); });
        _timers = {};
        _relays = [];
        _pendingState = {};
        var empty = document.getElementById('relay-empty');
        var grid = document.getElementById('relay-grid');
        if (empty) { empty.querySelector('p').textContent = 'Connect to broker to see relays'; empty.style.display = ''; }
        if (grid) { Array.from(grid.children).forEach(function (c) { if (c.id !== 'relay-empty') c.remove(); }); }
      }

  function _esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

  /* ════════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════════ */
  return {
      init: function (prefix) {
        if (_prefix !== prefix) {
          _unsubscribe();
          _prefix = prefix;
          _subscribe();
        } else if (!_subFull) {
          _subscribe();
        }
        _initPatternUI();
        MQTTClient.publish(_prefix + '/ping', '1');
        MQTTClient.publish(_prefix + '/get', 'all');
        log('[Relays] init → ' + prefix);
      },
      onConnected: function () { },
      onDisconnected: _onDisconnected,
      get relays() { return _relays; }
    };

  }) ();
