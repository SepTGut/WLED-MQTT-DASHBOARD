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
  var KEY      = 'mqttctrl_active_tab';
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
    try { localStorage.setItem(KEY, name); } catch (e) { /* ignore */ }
  }

  tabBtns.forEach(function (b)  { b.addEventListener('click', function () { switchTab(b.dataset.tab); }); });
  bnavBtns.forEach(function (b) { b.addEventListener('click', function () { switchTab(b.dataset.tab); }); });

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
  var valid = saved && document.getElementById('tab-' + saved);
  if (valid) switchTab(saved);
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
  var VERSION = 2;
  var fields = ['cfg-host','cfg-port','cfg-tls','cfg-user','cfg-relay-prefix','cfg-wled-prefix','cfg-remember-pass'];

  /* Restore */
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!saved.__v || saved.__v < VERSION) {
      saved = { __v: VERSION };
      localStorage.setItem(KEY, JSON.stringify(saved));
    }
    fields.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || saved[id] === undefined) return;
      if (el.type === 'checkbox') el.checked = !!saved[id];
      else el.value = saved[id];
    });
    var pass = document.getElementById('cfg-pass');
    if (pass && saved['cfg-remember-pass'] && typeof saved['cfg-pass'] === 'string') {
      pass.value = saved['cfg-pass'];
    }
  } catch (e) { /* ignore */ }

  /* Save on every change */
  fields.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      try {
        var data = JSON.parse(localStorage.getItem(KEY) || '{}');
        data.__v = VERSION;
        data[id] = el.type === 'checkbox' ? el.checked : el.value;
        var passEl = document.getElementById('cfg-pass');
        var rememberEl = document.getElementById('cfg-remember-pass');
        if (passEl && rememberEl && rememberEl.checked) data['cfg-pass'] = passEl.value;
        if (rememberEl && !rememberEl.checked) delete data['cfg-pass'];
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e) { /* ignore */ }
    });
  });

  var btnReset = document.getElementById('btn-reset-settings');
  if (btnReset) {
    btnReset.addEventListener('click', function() {
      if (confirm('Are you sure you want to clear all settings and saved passwords?')) {
        localStorage.removeItem(KEY);
        location.reload();
      }
    });
  }
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
  function setState(state, meta) {
    badge.setAttribute('data-state', state);
    var labels = { disconnected:'Offline', connecting:'Connecting…', connected:'Online', error:'Error' };
    var text = labels[state] || state;
    if (state === 'connecting' && meta && meta.retryAttempt) {
      text = 'Connecting (try ' + meta.retryAttempt + ')';
    }
    badgeLabel.textContent = text;

    var connected = (state === 'connected');
    var busy      = (state === 'connecting');

    btnConnect.disabled    = connected || busy;
    btnDisconnect.disabled = !connected;

    /* Enable / disable control buttons */
    ['btn-alloff','btn-allon','btn-ping','btn-show-pattern'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !connected;
    });

    /* Connection info update */
    if (state === 'connected') {
      connStart = Date.now();
      tooltipBroker.textContent = (document.getElementById('cfg-host').value || 'broker') + ':' + (document.getElementById('cfg-port').value || '8884');
      updateUptime();
      if (uptimeInterval) clearInterval(uptimeInterval);
      uptimeInterval = setInterval(updateUptime, 1000);
    } else {
      connStart = null;
      if (uptimeInterval) { clearInterval(uptimeInterval); uptimeInterval = null; }
      tooltipUptime.textContent = '—';
      tooltipBroker.textContent = '—';
      tooltip.classList.remove('visible');
    }
  }
  window.setConnectionState = setState;   /* MQTTClient calls this */

  var connStart = null;
  var tooltip   = document.getElementById('conn-tooltip');
  var tooltipBroker = document.getElementById('tooltip-broker');
  var tooltipUptime = document.getElementById('tooltip-uptime');
  var uptimeInterval = null;

  function updateUptime() {
    if (connStart) {
      var sec = Math.floor((Date.now() - connStart) / 1000);
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      tooltipUptime.textContent = m + 'm ' + s + 's';
    }
  }

  // Show/hide tooltip on badge click
  badge.addEventListener('click', function() {
    tooltip.classList.toggle('visible');
  });
  // Hide when clicking outside
  document.addEventListener('click', function(e) {
    if (!badge.contains(e.target) && !tooltip.contains(e.target)) {
      tooltip.classList.remove('visible');
    }
  });


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


/* ... (all previous code exactly as in your file) ... */

/* ══════════════════════════════════════════════════════
   6. QUICK-BAR ACTIONS  (relay tab)
══════════════════════════════════════════════════════ */
(function initQuickBar() {
  function relayPrefix() {
    return (document.getElementById('cfg-relay-prefix').value || 'home/relay').trim();
  }

  document.getElementById('btn-alloff').addEventListener('click', function () {
    AppLog.info('→ All relays OFF');
    MQTTClient.publishJSON(relayPrefix() + '/api', { on: false });
  });

  document.getElementById('btn-allon').addEventListener('click', function () {
    AppLog.info('→ All relays ON');
    MQTTClient.publishJSON(relayPrefix() + '/api', { on: true });
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

/* ... (rest of app.js unchanged) ... */

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
