/* ═══════════════════════════════════════════════════════
   wled.js  —  WLED LED control module (custom device)
   ─────────────────────────────────────────────────────
   MQTT topics used:

   SUBSCRIBE (state from device):
     {prefix}/g          brightness  0–255
     {prefix}/c          color hex   #RRGGBB
     {prefix}/status     "online" / "offline"
     {prefix}/v          FULL JSON STATE (standard WLED)
                         — ignored when not parseable
     {prefix}/mcutemp    MCU temperature (float)
     {prefix}/system     system info JSON

   PUBLISH (commands to device):
     {prefix}            "ON" / "OFF"   (if supported)
     {prefix}/g          brightness  0–255
     {prefix}/c          color hex   #RRGGBB
     {prefix}/api        {"v":true}               request full state
     {prefix}/api        {"seg":[{"id":0,"sx":N}]}   set speed
     {prefix}/api        {"seg":[{"id":0,"ix":N}]}   set intensity
     {prefix}/api        {"fx":N}                 set effect
     {prefix}/api        {"ps":N}                 recall preset
   ═══════════════════════════════════════════════════════ */

window.WLEDModule = (function () {

  var _prefix  = 'wled/my_wled';
  var _power   = false;
  var _bri     = 128;
  var _color   = '#FF6600';
  var _speed   = 128;
  var _intens  = 128;
  var _fx      = -1;        // current effect ID, -1 = none
  var _mcuTemp = null;      // latest MCU temperature

  var _briTimer  = null;
  var _spdTimer  = null;
  var _intTimer  = null;
  var _online    = false;

  var log = function(m, lvl) { window.AppLog && AppLog[lvl || 'info'](m); };

  /* ════════════════════════════════════════════════
     MQTT SUBSCRIPTIONS
  ════════════════════════════════════════════════ */

  function _subscribe() {
    MQTTClient.subscribe(_prefix + '/g',       _onBrightness);
    MQTTClient.subscribe(_prefix + '/c',       _onColor);
    MQTTClient.subscribe(_prefix + '/status',  _onStatus);
    MQTTClient.subscribe(_prefix + '/v',       _onFullState);
    MQTTClient.subscribe(_prefix + '/mcutemp', _onMcutemp);
    MQTTClient.subscribe(_prefix + '/system',  _onSystemInfo);   // ← System info
    log('[WLED] subscribed → ' + _prefix);
  }

  /* ── Status (online/offline) ────────────────────── */
  function _onStatus(payloadStr) {
    var p = payloadStr.trim().toLowerCase();
    if (p === 'online')  { _power = true;  _online = true;  _updatePowerUI(); _enableControls(true); }
    if (p === 'offline') { _power = false; _online = false; _updatePowerUI(); _enableControls(false); _clearTemp(); _clearSysInfo(); }
  }

  /* ── Enable/disable all sliders and toggle ──────── */
  function _enableControls(on) {
    var powerEl = document.getElementById('wled-power');
    var briEl   = document.getElementById('wled-bri');
    var colorEl = document.getElementById('wled-color');
    var spdEl   = document.getElementById('wled-spd');
    var intEl   = document.getElementById('wled-int');
    var fxSel   = document.getElementById('wled-fx');
    var presetInput = document.getElementById('wled-preset');
    var presetBtn   = document.getElementById('btn-wled-loadpreset');
    if (powerEl)  powerEl.disabled  = !on;
    if (briEl)    briEl.disabled    = !on;
    if (colorEl)  colorEl.disabled  = !on;
    if (spdEl)    spdEl.disabled    = !on;
    if (intEl)    intEl.disabled    = !on;
    if (fxSel)    fxSel.disabled    = !on;
    if (presetInput) presetInput.disabled = !on;
    if (presetBtn)   presetBtn.disabled   = !on;
    if (!on) { _clearTemp(); _clearSysInfo(); }
  }

  /* ── Clear temperature badge ────────────────────── */
  function _clearTemp() {
    var el = document.getElementById('wled-temp');
    if (el) el.textContent = '--°C';
  }

  /* ── Clear system info ────────────────────────── */
  function _clearSysInfo() {
    var el = document.getElementById('wled-sysinfo');
    if (el) el.innerHTML = 'Waiting for data…';
  }

  /* ── {prefix}/v  full JSON state ────────────────── */
  function _onFullState(payloadStr) {
    var json;
    try { json = JSON.parse(payloadStr); } catch(e) { return; }

    if (json.on   !== undefined) { _power = !!json.on;          _updatePowerUI(); }
    if (json.bri  !== undefined) { _bri   = Number(json.bri);    _updateBriUI(); }

    if (Array.isArray(json.col) && Array.isArray(json.col[0])) {
      var rgb = json.col[0];
      _color = _rgbToHex(rgb[0]||0, rgb[1]||0, rgb[2]||0);
      _updateColorUI();
    } else if (typeof json.col === 'string') {
      _color = json.col.startsWith('#') ? json.col : '#' + json.col;
      _updateColorUI();
    }

    if (Array.isArray(json.seg) && json.seg[0]) {
      var seg = json.seg[0];
      if (seg.sx !== undefined) { _speed  = Number(seg.sx); _updateSpdUI(); }
      if (seg.ix !== undefined) { _intens = Number(seg.ix); _updateIntUI(); }
      if (seg.fx !== undefined) { _fx     = Number(seg.fx); _updateFxUI(); }
    }

    if (json.temp !== undefined && !isNaN(Number(json.temp))) {
      _updateTempUI(Number(json.temp));
    }
  }

  /* ── MCU Temperature ───────────────────────────── */
  function _onMcutemp(payloadStr) {
    var v = parseFloat(payloadStr.trim());
    if (isNaN(v)) return;
    _updateTempUI(v);
  }

  function _updateTempUI(val) {
    var el = document.getElementById('wled-temp');
    if (el) el.textContent = val.toFixed(1) + '°C';
  }

  /* ── System Info ────────────────────────────────── */
  function _onSystemInfo(payloadStr) {
    var json;
    try { json = JSON.parse(payloadStr); } catch(e) { return; }
    var el = document.getElementById('wled-sysinfo');
    if (!el) return;

    var uptime = json.uptime_s;
    var heap   = json.free_heap;
    var rssi   = json.rssi;
    var relaysOn  = json.relays_on;
    var numRelays = json.num_relays;
    var patActive = json.pattern_active;

    var html = '';
    if (uptime !== undefined) {
      var d = Math.floor(uptime / 86400);
      var h = Math.floor((uptime % 86400) / 3600);
      var m = Math.floor((uptime % 3600) / 60);
      var u = (d ? d + 'd ' : '') + h + 'h ' + m + 'm';
      html += '<div><span>Uptime</span><span>' + u + '</span></div>';
    }
    if (heap !== undefined) html += '<div><span>Free Heap</span><span>' + (heap/1024).toFixed(1) + ' KB</span></div>';
    if (rssi !== undefined) html += '<div><span>RSSI</span><span>' + rssi + ' dBm</span></div>';
    if (numRelays !== undefined) {
      html += '<div><span>Relays</span><span>' + (relaysOn||0) + ' / ' + numRelays + ' on</span></div>';
    }
    if (patActive !== undefined) html += '<div><span>Pattern</span><span>' + (patActive ? 'running' : 'idle') + '</span></div>';

    el.innerHTML = html || 'Waiting for data…';
  }

  /* ── brightness ─────────────────────────────────── */
  function _onBrightness(payloadStr) {
    var v = parseInt(payloadStr.trim(), 10);
    if (isNaN(v)) return;
    _bri = Math.max(0, Math.min(255, v));
    _updateBriUI();
  }

  /* ── color hex ──────────────────────────────────── */
  function _onColor(payloadStr) {
    var raw = payloadStr.trim();
    if (!raw) return;
    _color = raw.startsWith('#') ? raw : '#' + raw;
    _updateColorUI();
  }

  /* ── Request device full state ──────────────────── */
  function _requestFullState() {
    MQTTClient.publish(_prefix + '/api', '{"v":true}');
    log('→ Requested WLED full state');
  }

  /* ════════════════════════════════════════════════
     PUBLISH COMMANDS
  ════════════════════════════════════════════════ */

  function _sendPower(on) {
    _power = !!on;
    MQTTClient.publish(_prefix, on ? 'ON' : 'OFF');
    MQTTClient.publishJSON(_prefix + '/api', { on: on });
    log('→ WLED power ' + (on ? 'ON' : 'OFF'));
    _updatePowerUI();
  }

  function _sendBrightness(val) {
    _bri = Math.max(0, Math.min(255, parseInt(val, 10)));
    MQTTClient.publish(_prefix + '/g', String(_bri));
    MQTTClient.publishJSON(_prefix + '/api', { bri: _bri });
    log('→ WLED brightness ' + _bri);
  }

  function _sendColor(hex) {
    _color = hex;
    var bare = hex.replace('#', '');
    MQTTClient.publish(_prefix + '/c', hex);
    MQTTClient.publish(_prefix + '/col', bare);
    var rgb = _hexToRgb(hex);
    MQTTClient.publishJSON(_prefix + '/api', { col: [[rgb.r, rgb.g, rgb.b]] });
    log('→ WLED color ' + hex);
    _updateColorUI();
  }

  function _sendSpeed(val) {
    _speed = Math.max(0, Math.min(255, parseInt(val, 10)));
    MQTTClient.publishJSON(_prefix + '/api', { seg: [{ id: 0, sx: _speed }] });
    log('→ WLED speed ' + _speed);
  }

  function _sendIntensity(val) {
    _intens = Math.max(0, Math.min(255, parseInt(val, 10)));
    MQTTClient.publishJSON(_prefix + '/api', { seg: [{ id: 0, ix: _intens }] });
    log('→ WLED intensity ' + _intens);
  }

  function _sendEffect(fx) {
    fx = parseInt(fx, 10);
    if (isNaN(fx) || fx < 0) return;
    _fx = fx;
    MQTTClient.publishJSON(_prefix + '/api', { fx: fx });
    log('→ WLED effect ' + fx);
    _updateFxUI();
  }

  function _sendPreset(num) {
    num = parseInt(num, 10);
    if (isNaN(num) || num < 1 || num > 250) return;
    MQTTClient.publishJSON(_prefix + '/api', { ps: num });
    log('→ WLED preset ' + num);
  }

  /* ════════════════════════════════════════════════
     UI UPDATE HELPERS
  ════════════════════════════════════════════════ */

  function _updatePowerUI() {
    var el = document.getElementById('wled-power');
    if (el) el.checked = _power;
  }

  function _updateBriUI() {
    var slider = document.getElementById('wled-bri');
    var badge  = document.getElementById('bri-value');
    if (slider) slider.value = _bri;
    if (badge)  badge.textContent = _bri;
  }

  function _updateColorUI() {
    var picker = document.getElementById('wled-color');
    var badge  = document.getElementById('color-hex');
    if (picker) picker.value = _color;
    if (badge)  badge.textContent = _color.toUpperCase();
    document.querySelectorAll('.color-dot').forEach(function(d){
      d.classList.toggle('active', d.dataset.color.toUpperCase() === _color.toUpperCase());
    });
  }

  function _updateSpdUI() {
    var el = document.getElementById('wled-spd');
    var b  = document.getElementById('spd-value');
    if (el) el.value = _speed;
    if (b)  b.textContent = _speed;
  }

  function _updateIntUI() {
    var el = document.getElementById('wled-int');
    var b  = document.getElementById('int-value');
    if (el) el.value = _intens;
    if (b)  b.textContent = _intens;
  }

  function _updateFxUI() {
    var sel = document.getElementById('wled-fx');
    if (sel) sel.value = _fx;
  }

  function _showPanel(visible) {
    var panel = document.getElementById('wled-panel');
    var empty = document.getElementById('wled-empty');
    if (panel) panel.style.display = visible ? '' : 'none';
    if (empty) empty.style.display = visible ? 'none' : '';
  }

  /* ════════════════════════════════════════════════
     WIRE UI EVENTS
  ════════════════════════════════════════════════ */

  var _eventsWired = false;

  function _wireEvents() {
    if (_eventsWired) return;
    _eventsWired = true;

    var refreshBtn = document.getElementById('btn-wled-refresh');
    refreshBtn && refreshBtn.addEventListener('click', function(){
      _requestFullState();
    });

    var powerEl = document.getElementById('wled-power');
    powerEl && powerEl.addEventListener('change', function(){
      _sendPower(this.checked);
    });

    var briEl = document.getElementById('wled-bri');
    briEl && briEl.addEventListener('input', function(){
      var v = this.value;
      var badge = document.getElementById('bri-value');
      if (badge) badge.textContent = v;
      clearTimeout(_briTimer);
      _briTimer = setTimeout(function(){ _sendBrightness(v); }, 80);
    });

    var colorEl = document.getElementById('wled-color');
    colorEl && colorEl.addEventListener('input', function(){
      var badge = document.getElementById('color-hex');
      if (badge) badge.textContent = this.value.toUpperCase();
      clearTimeout(_briTimer);
      _briTimer = setTimeout(function(){ _sendColor(colorEl.value); }, 150);
    });

    document.querySelectorAll('.color-dot').forEach(function(dot){
      dot.addEventListener('click', function(){
        _sendColor(dot.dataset.color);
      });
    });

    var spdEl = document.getElementById('wled-spd');
    spdEl && spdEl.addEventListener('input', function(){
      var v = this.value;
      var badge = document.getElementById('spd-value');
      if (badge) badge.textContent = v;
      clearTimeout(_spdTimer);
      _spdTimer = setTimeout(function(){ _sendSpeed(v); }, 80);
    });

    var intEl = document.getElementById('wled-int');
    intEl && intEl.addEventListener('input', function(){
      var v = this.value;
      var badge = document.getElementById('int-value');
      if (badge) badge.textContent = v;
      clearTimeout(_intTimer);
      _intTimer = setTimeout(function(){ _sendIntensity(v); }, 80);
    });

    /* Effect selector */
    var fxEl = document.getElementById('wled-fx');
    fxEl && fxEl.addEventListener('change', function(){
      _sendEffect(this.value);
    });

    /* Load Preset button */
    var presetBtn = document.getElementById('btn-wled-loadpreset');
    presetBtn && presetBtn.addEventListener('click', function(){
      var num = parseInt(document.getElementById('wled-preset').value, 10);
      _sendPreset(num);
    });
  }

  function _onDisconnected() {
    _showPanel(false);
  }

  /* ════════════════════════════════════════════════
     COLOR UTILITIES
  ════════════════════════════════════════════════ */

  function _hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 255, g: 102, b: 0 };
  }

  function _rgbToHex(r, g, b) {
    return '#' +
      ('0' + Math.max(0,Math.min(255,r)).toString(16)).slice(-2) +
      ('0' + Math.max(0,Math.min(255,g)).toString(16)).slice(-2) +
      ('0' + Math.max(0,Math.min(255,b)).toString(16)).slice(-2);
  }

  /* ════════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════════ */
  return {
    init: function(prefix) {
      _prefix = prefix;
      _wireEvents();
      _subscribe();
      _showPanel(true);
      _updatePowerUI();
      _updateBriUI();
      _updateColorUI();
      _updateSpdUI();
      _updateIntUI();
      _updateFxUI();
      setTimeout(_requestFullState, 500);
      log('[WLED] init → ' + prefix);
    },
    onConnected:    function(){},
    onDisconnected: _onDisconnected
  };
})();