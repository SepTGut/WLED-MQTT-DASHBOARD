/* ═══════════════════════════════════════════════════════
   app.js  —  Main application entry point
   ─────────────────────────────────────────────────────
   Load order:  mqtt.js → relays.js → wled.js → sensors.js → app.js

   Responsibilities:
   • Tab / bottom-nav routing
   • Theme switching  (persists to localStorage)
   • Activity log helper  (window.AppLog)
   • Connect / Disconnect UI + validation
   • Settings persist to localStorage
   • Wire MQTTClient → RelayModule / WLEDModule / SensorModule
   • Quick-bar relay actions (All ON/OFF/Ping)
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════════
   1. ACTIVITY LOG  (defined first — all modules use it)
══════════════════════════════════════════════════════ */
window.AppLog = (function () {
  var el       = document.getElementById('log-output');
  var btnClear = document.getElementById('btn-clear-log');

  function pad(n) { return String(n).padStart(2, '0'); }
  function ts() {
    var d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function add(msg, level) {
    if (!el) return;
    var line = document.createElement('div');
    line.className = 'log-line ' + (level || 'info');
    var safe = String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    line.innerHTML = '<span class="log-ts">' + ts() + '</span><span class="log-msg">' + safe + '</span>';
    el.appendChild(line);
    while (el.children.length > 300) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  btnClear && btnClear.addEventListener('click', function () { el.innerHTML = ''; });

  return {
    info:    function (m) { add(m, 'info');    },
    success: function (m) { add(m, 'success'); },
    warn:    function (m) { add(m, 'warning'); },
    error:   function (m) { add(m, 'error');   }
  };
})();


/* ══════════════════════════════════════════════════════
   2. TAB ROUTING
══════════════════════════════════════════════════════ */
(function initTabs() {
  var panels   = document.querySelectorAll('.tab-panel');
  var tabBtns  = document.querySelectorAll('.tab-btn');
  var bnavBtns = document.querySelectorAll('.bnav-btn');

  function switchTab(name) {
    panels.forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    tabBtns.forEach(function (b) {
      var on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    bnavBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
  }

  tabBtns.forEach(function (b)  { b.addEventListener('click', function () { switchTab(b.dataset.tab); }); });
  bnavBtns.forEach(function (b) { b.addEventListener('click', function () { switchTab(b.dataset.tab); }); });
})();


/* ══════════════════════════════════════════════════════
   3. THEME SWITCHER
══════════════════════════════════════════════════════ */
(function initTheme() {
  var KEY      = 'mqttctrl_theme';
  var html     = document.documentElement;
  var btn      = document.getElementById('theme-btn');
  var panel    = document.getElementById('theme-panel');
  var backdrop = document.getElementById('theme-backdrop');
  var swatches = document.querySelectorAll('.theme-swatch');

  function apply(name) {
    html.setAttribute('data-theme', name);
    localStorage.setItem(KEY, name);
    swatches.forEach(function (s) { s.classList.toggle('active', s.dataset.theme === name); });
  }

  function open()  { panel.classList.remove('hidden'); btn.setAttribute('aria-expanded','true'); }
  function close() { panel.classList.add('hidden');    btn.setAttribute('aria-expanded','false'); }

  apply(localStorage.getItem(KEY) || 'dark');

  btn.addEventListener('click', function () { panel.classList.contains('hidden') ? open() : close(); });
  backdrop && backdrop.addEventListener('click', close);
  swatches.forEach(function (s) {
    s.addEventListener('click', function () { apply(s.dataset.theme); close(); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();


/* ══════════════════════════════════════════════════════
   4. SETTINGS  — persist / restore
══════════════════════════════════════════════════════ */
(function initSettings() {
  var KEY    = 'mqttctrl_settings';
  var fields = ['cfg-host','cfg-port','cfg-tls','cfg-user','cfg-relay-prefix','cfg-wled-prefix'];

  /* Restore */
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    fields.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || saved[id] === undefined) return;
      if (el.type === 'checkbox') el.checked = !!saved[id];
      else el.value = saved[id];
    });
  } catch (e) { /* ignore */ }

  /* Save on every change */
  fields.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      try {
        var data = JSON.parse(localStorage.getItem(KEY) || '{}');
        data[id] = el.type === 'checkbox' ? el.checked : el.value;
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e) { /* ignore */ }
    });
  });
})();


/* ══════════════════════════════════════════════════════
   5. CONNECTION UI
══════════════════════════════════════════════════════ */
(function initConnectionUI() {
  var btnConnect    = document.getElementById('btn-connect');
  var btnDisconnect = document.getElementById('btn-disconnect');
  var badge         = document.getElementById('conn-badge');
  var badgeLabel    = badge.querySelector('.conn-label');

  /* ── setConnectionState ────────────────────────── */
  function setState(state) {
    badge.setAttribute('data-state', state);
    var labels = { disconnected:'Offline', connecting:'Connecting…', connected:'Online', error:'Error' };
    badgeLabel.textContent = labels[state] || state;

    var connected = (state === 'connected');
    var busy      = (state === 'connecting');

    btnConnect.disabled    = connected || busy;
    btnDisconnect.disabled = !connected;

    /* Enable / disable control buttons */
    ['btn-alloff','btn-allon','btn-ping','btn-show-pattern'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !connected;
    });
  }
  window.setConnectionState = setState;   /* MQTTClient calls this */

  /* ── Connect button ────────────────────────────── */
  function doConnect() {
    var host = document.getElementById('cfg-host').value.trim();
    var port = parseInt(document.getElementById('cfg-port').value, 10);
    var tls  = document.getElementById('cfg-tls').checked;
    var user = document.getElementById('cfg-user').value.trim();
    var pass = document.getElementById('cfg-pass').value;

    if (!host) { AppLog.error('Please enter a broker host.'); return; }
    if (!port || port < 1 || port > 65535) { AppLog.error('Invalid port number.'); return; }

    setState('connecting');
    AppLog.info('Connecting to ' + (tls ? 'wss' : 'ws') + '://' + host + ':' + port + ' …');
    MQTTClient.connect({ host: host, port: port, useTLS: tls, username: user, password: pass });
  }

  btnConnect.addEventListener('click', doConnect);

  /* Enter key in settings inputs triggers connect */
  ['cfg-host','cfg-port','cfg-user','cfg-pass'].forEach(function (id) {
    var el = document.getElementById(id);
    el && el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doConnect();
    });
  });

  /* ── Disconnect button ─────────────────────────── */
  btnDisconnect.addEventListener('click', function () {
    MQTTClient.disconnect();
    setState('disconnected');
    AppLog.info('Disconnected.');
  });

  setState('disconnected');
})();


/* ══════════════════════════════════════════════════════
   6. QUICK-BAR ACTIONS  (relay tab)
══════════════════════════════════════════════════════ */
(function initQuickBar() {
  function relayPrefix() {
    return (document.getElementById('cfg-relay-prefix').value || 'home/relay').trim();
  }

  document.getElementById('btn-alloff').addEventListener('click', function () {
    AppLog.info('→ All relays OFF');
    MQTTClient.publish(relayPrefix(), 'OFF');
  });

  document.getElementById('btn-allon').addEventListener('click', function () {
    AppLog.info('→ All relays ON');
    MQTTClient.publish(relayPrefix(), 'ON');
  });

  document.getElementById('btn-ping').addEventListener('click', function () {
    AppLog.info('→ Ping');
    MQTTClient.publish(relayPrefix() + '/ping', '1');
  });

  document.getElementById('btn-show-pattern').addEventListener('click', function () {
    var sec = document.getElementById('pattern-section');
    if (sec) sec.style.display = (sec.style.display === 'none' ? '' : 'none');
  });
})();


/* ══════════════════════════════════════════════════════
   7. MODULE WIRING  —  inject prefixes on connect
      (app.js loads last; RelayModule, WLEDModule,
       SensorModule are already defined)
══════════════════════════════════════════════════════ */
(function wireModules() {

  function wrap(obj, method, before) {
    if (!obj) return;
    var orig = obj[method];
    obj[method] = function () {
      before.apply(this, arguments);
      if (orig) orig.apply(this, arguments);
    };
  }

  /* RelayModule */
  wrap(window.RelayModule, 'onConnected', function () {
    var p = (document.getElementById('cfg-relay-prefix').value || 'home/relay').trim();
    RelayModule.init(p);
  });

  /* WLEDModule */
  wrap(window.WLEDModule, 'onConnected', function () {
    var p = (document.getElementById('cfg-wled-prefix').value || 'wled/my_wled').trim();
    WLEDModule.init(p);
  });

  /* SensorModule */
  wrap(window.SensorModule, 'onConnected', function () {
    var p = (document.getElementById('cfg-relay-prefix').value || 'home/relay').trim();
    SensorModule.init(p);
  });

})();


/* ══════════════════════════════════════════════════════
   8. READY
══════════════════════════════════════════════════════ */
AppLog.info('MQTT Controller ready — configure broker in Settings then Connect.');
