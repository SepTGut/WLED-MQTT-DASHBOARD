/* ═══════════════════════════════════════════════════════
   app.js  v2.1 — Main application entry point
   ─────────────────────────────────────────────────────
   Changes v2.1:
   • Dispatches relays:update CustomEvent for status bar
   • Discovery init only called when connected
   • Performance-mode toggle wired after visuals load
   • Settings version bump → 3 (new perf-mode field)
   • Enter-key connect on all settings inputs
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════════
   1. ACTIVITY LOG
══════════════════════════════════════════════════════ */
window.AppLog = (function () {
  var el = document.getElementById('log-output');
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
    var safe = String(msg)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    line.innerHTML =
      '<span class="log-ts">' + ts() + '</span>' +
      '<span class="log-msg">' + safe + '</span>';
    el.appendChild(line);
    // Keep log lean
    while (el.children.length > 250) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  btnClear && btnClear.addEventListener('click', function () { el.innerHTML = ''; });

  return {
    info: function (m) { add(m, 'info'); },
    success: function (m) { add(m, 'success'); },
    warn: function (m) { add(m, 'warning'); },
    error: function (m) { add(m, 'error'); }
  };
})();


/* ══════════════════════════════════════════════════════
   2. TAB ROUTING
══════════════════════════════════════════════════════ */
(function initTabs() {
  var KEY = 'mqttctrl_active_tab';
  var panels = document.querySelectorAll('.tab-panel');
  var tabBtns = document.querySelectorAll('.tab-btn');
  var bnavBtns = document.querySelectorAll('.bnav-btn');

  function switchTab(name) {
    panels.forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    tabBtns.forEach(function (b) {
      var on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    bnavBtns.forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    try { localStorage.setItem(KEY, name); } catch (e) { }
  }

  tabBtns.forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab); });
  });
  bnavBtns.forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab); });
  });

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { }
  if (saved && document.getElementById('tab-' + saved)) {
    switchTab(saved);
  }
})();


/* ══════════════════════════════════════════════════════
   3. THEME SWITCHER
══════════════════════════════════════════════════════ */
(function initTheme() {
  var KEY = 'mqttctrl_theme';
  var html = document.documentElement;
  var btn = document.getElementById('theme-btn');
  var panel = document.getElementById('theme-panel');
  var backdrop = document.getElementById('theme-backdrop');
  var swatches = document.querySelectorAll('.theme-swatch');

  function apply(name) {
    html.setAttribute('data-theme', name);
    document.body.setAttribute('data-theme', name);
    try { localStorage.setItem(KEY, name); } catch (e) { }
    swatches.forEach(function (s) {
      s.classList.toggle('active', s.dataset.theme === name);
    });
    // Let visuals pick up new accent colour
    if (window.visuals) window.visuals._updateAccent && window.visuals._updateAccent();
  }

  function openPanel() {
    panel.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  }
  function closePanel() {
    panel.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { }
  apply(saved || 'dark');

  btn.addEventListener('click', function () {
    panel.classList.contains('hidden') ? openPanel() : closePanel();
  });
  backdrop && backdrop.addEventListener('click', closePanel);
  swatches.forEach(function (s) {
    s.addEventListener('click', function () { apply(s.dataset.theme); closePanel(); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePanel();
  });
})();


/* ══════════════════════════════════════════════════════
   4. SETTINGS — persist / restore
══════════════════════════════════════════════════════ */
(function initSettings() {
  var KEY = 'mqttctrl_settings';
  var VERSION = 3;   // bumped from 2 → 3 for perf-mode field
  var fields = [
    'cfg-host', 'cfg-port', 'cfg-tls', 'cfg-user',
    'cfg-relay-prefix', 'cfg-wled-prefix',
    'cfg-remember-pass', 'cfg-perf-mode'
  ];

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
    var passEl = document.getElementById('cfg-pass');
    var rememberEl = document.getElementById('cfg-remember-pass');
    if (passEl && rememberEl && rememberEl.checked && typeof saved['cfg-pass'] === 'string') {
      passEl.value = saved['cfg-pass'];
    }
  } catch (e) { }

  /* Persist on change */
  function persist() {
    try {
      var data = JSON.parse(localStorage.getItem(KEY) || '{}');
      data.__v = VERSION;
      fields.forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        data[id] = (el.type === 'checkbox') ? el.checked : el.value;
      });
      var passEl = document.getElementById('cfg-pass');
      var rememberEl = document.getElementById('cfg-remember-pass');
      if (passEl && rememberEl && rememberEl.checked) {
        data['cfg-pass'] = passEl.value;
      } else {
        delete data['cfg-pass'];
      }
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { }
  }

  fields.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      // Validate topic fields inline
      if ((id === 'cfg-relay-prefix' || id === 'cfg-wled-prefix') && window.MQTTClient) {
        if (!MQTTClient.isValidTopic(el.value, true)) {
          AppLog.error('Warning: invalid topic pattern: ' + el.value);
          el.classList.add('field-error');
        } else {
          el.classList.remove('field-error');
        }
      }
      persist();
    });
  });

  /* WLED multi-device list */
  var WLED_KEY = 'mqttctrl_wled_list';
  window.getWLEDList = function () { try { return JSON.parse(localStorage.getItem(WLED_KEY) || '[]'); } catch (e) { return []; } };
  window.saveWLEDList = function (list) { try { localStorage.setItem(WLED_KEY, JSON.stringify(list)); } catch (e) { } };

  var btnAddWLED = document.getElementById('btn-add-wled');
  var inputAddWLED = document.getElementById('add-wled-prefix');
  if (btnAddWLED && inputAddWLED) {
    function doAddWLED() {
      var prefix = (inputAddWLED.value || '').trim();
      if (!prefix) return;
      var list = window.getWLEDList();
      if (!list.includes(prefix)) {
        list.push(prefix);
        window.saveWLEDList(list);
        if (MQTTClient.connected) WLEDModule.init(prefix);
        AppLog.success('Added WLED device: ' + prefix);
      }
      inputAddWLED.value = '';
    }
    btnAddWLED.addEventListener('click', doAddWLED);
    inputAddWLED.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doAddWLED();
    });
  }

  /* Hook WLEDModule.removeDevice → update saved list */
  var origRemove = WLEDModule.removeDevice.bind(WLEDModule);
  WLEDModule.removeDevice = function (prefix) {
    origRemove(prefix);
    var list = window.getWLEDList().filter(function (p) { return p !== prefix; });
    window.saveWLEDList(list);
  };

  /* Reset button */
  var btnReset = document.getElementById('btn-reset-settings');
  if (btnReset) {
    btnReset.addEventListener('click', function () {
      if (confirm('Reset all settings and clear saved passwords?')) {
        try {
          localStorage.removeItem(KEY);
          localStorage.removeItem(WLED_KEY);
        } catch (e) { }
        location.reload();
      }
    });
  }

  /* Performance mode */
  var perfEl = document.getElementById('cfg-perf-mode');
  if (perfEl) {
    function applyPerf() {
      if (window.visuals) window.visuals.setPerformanceMode(perfEl.checked);
    }
    perfEl.addEventListener('change', function () { persist(); applyPerf(); });
    // Defer until visuals are ready
    setTimeout(applyPerf, 300);
  }
})();


/* ══════════════════════════════════════════════════════
   5. CONNECTION UI
══════════════════════════════════════════════════════ */
(function initConnectionUI() {
  var btnConnect = document.getElementById('btn-connect');
  var btnDisconnect = document.getElementById('btn-disconnect');
  var badge = document.getElementById('conn-badge');
  var badgeLabel = badge.querySelector('.conn-label');

  var connStart = null;
  var uptimeInterval = null;
  var tooltipBroker = document.getElementById('tooltip-broker');
  var tooltipUptime = document.getElementById('tooltip-uptime');

  function setState(state, meta) {
    badge.setAttribute('data-state', state);
    var labels = {
      disconnected: 'Offline',
      connecting: 'Connecting…',
      connected: 'Online',
      error: 'Error'
    };
    var text = labels[state] || state;
    if (state === 'connecting' && meta && meta.retryAttempt) {
      text = 'Retry ' + meta.retryAttempt + '/' + 20;
    }
    badgeLabel.textContent = text;

    var connected = (state === 'connected');
    var busy = (state === 'connecting');

    btnConnect.disabled = connected || busy;
    btnDisconnect.disabled = !connected;

    ['btn-alloff', 'btn-allon', 'btn-ping', 'btn-show-pattern'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !connected;
    });

    if (state === 'connected') {
      connStart = Date.now();
      if (tooltipBroker) {
        tooltipBroker.textContent =
          (document.getElementById('cfg-host').value || 'broker') +
          ':' +
          (document.getElementById('cfg-port').value || '8884');
      }
      if (uptimeInterval) clearInterval(uptimeInterval);
      uptimeInterval = setInterval(updateUptime, 1000);
      updateUptime();
    } else {
      connStart = null;
      if (uptimeInterval) { clearInterval(uptimeInterval); uptimeInterval = null; }
      if (tooltipUptime) tooltipUptime.textContent = '—';
      if (tooltipBroker) tooltipBroker.textContent = '—';
    }
  }
  window.setConnectionState = setState;

  function updateUptime() {
    if (!connStart || !tooltipUptime) return;
    var sec = Math.floor((Date.now() - connStart) / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    tooltipUptime.textContent = m + 'm ' + String(s).padStart(2, '0') + 's';
  }

  function doConnect() {
    var host = document.getElementById('cfg-host').value.trim();
    var port = parseInt(document.getElementById('cfg-port').value, 10);
    var tls = document.getElementById('cfg-tls').checked;
    var user = document.getElementById('cfg-user').value.trim();
    var pass = document.getElementById('cfg-pass').value;

    if (!host) { AppLog.error('Please enter a broker host.'); return; }
    if (!port || port < 1 || port > 65535) { AppLog.error('Invalid port number.'); return; }

    setState('connecting');
    AppLog.info('Connecting to ' + (tls ? 'wss' : 'ws') + '://' + host + ':' + port + ' …');
    MQTTClient.connect({ host: host, port: port, useTLS: tls, username: user, password: pass });
  }

  btnConnect.addEventListener('click', doConnect);

  ['cfg-host', 'cfg-port', 'cfg-user', 'cfg-pass'].forEach(function (id) {
    var el = document.getElementById(id);
    el && el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doConnect();
    });
  });

  btnDisconnect.addEventListener('click', function () {
    MQTTClient.disconnect();
    setState('disconnected');
    AppLog.info('Disconnected.');
  });

  setState('disconnected');
})();


/* ══════════════════════════════════════════════════════
   6. QUICK-BAR ACTIONS
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
    if (sec) sec.style.display = (sec.style.display === 'none' || !sec.style.display) ? 'block' : 'none';
  });
})();


/* ══════════════════════════════════════════════════════
   7. MODULE WIRING
══════════════════════════════════════════════════════ */
(function wireModules() {

  function wrap(obj, method, before) {
    if (!obj || typeof obj[method] !== 'function') return;
    var orig = obj[method];
    obj[method] = function () {
      before.apply(this, arguments);
      orig.apply(this, arguments);
    };
  }

  /* RelayModule — init with prefix on connect */
  wrap(window.RelayModule, 'onConnected', function () {
    var p = (document.getElementById('cfg-relay-prefix').value || 'home/relay').trim();
    RelayModule.init(p);
  });

  /* WLEDModule — restore saved device list on connect */
  wrap(window.WLEDModule, 'onConnected', function () {
    var list = window.getWLEDList();
    if (list.length === 0) {
      var def = (document.getElementById('cfg-wled-prefix').value || 'wled/my_wled').trim();
      list.push(def);
      window.saveWLEDList(list);
    }
    list.forEach(function (p) { WLEDModule.init(p); });
  });

  /* SensorModule */
  wrap(window.SensorModule, 'onConnected', function () {
    var p = (document.getElementById('cfg-relay-prefix').value || 'home/relay').trim();
    SensorModule.init(p);
  });

  /* DiscoveryModule — init ONLY when connected */
  wrap(window.DiscoveryModule, 'onConnected', function () {
    DiscoveryModule.init();
  });

  var btnScan = document.getElementById('btn-discovery-scan');
  if (btnScan) {
    btnScan.addEventListener('click', function () {
      if (window.DiscoveryModule && MQTTClient.connected) {
        DiscoveryModule.startScan();
      } else {
        AppLog.warn('Connect to a broker before scanning.');
      }
    });
  }

  /* Relay status-bar updater
     RelayModule fires a custom event after every render/update */
  var _origRelayRender = null;
  function patchRelayRender() {
    if (!window.RelayModule) return;
    // Poll until RelayModule is fully loaded
    if (typeof RelayModule._patchedStatusBar === 'undefined') {
      RelayModule._patchedStatusBar = true;
      // Monkey-patch the internal render by observing relay-grid mutations
      var grid = document.getElementById('relay-grid');
      if (!grid) return;
      var mo = new MutationObserver(function () {
        var relays = RelayModule.relays || [];
        var onCount = relays.filter(function (r) { return r.on; }).length;
        document.dispatchEvent(new CustomEvent('relays:update', {
          detail: { total: relays.length, on: onCount }
        }));
      });
      mo.observe(grid, { childList: true, subtree: true, attributes: true });
    }
  }
  // Run after modules load
  setTimeout(patchRelayRender, 500);

})();


/* ══════════════════════════════════════════════════════
   8. READY
══════════════════════════════════════════════════════ */
AppLog.info('MQTT Controller v2.1 ready — go to Settings and Connect.');