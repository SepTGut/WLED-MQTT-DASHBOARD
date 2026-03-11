/* ═══════════════════════════════════════════════════════
   wled.js  —  WLED LED control module
   ─────────────────────────────────────────────────────
   MQTT topics used:

   SUBSCRIBE (state from WLED):
     {prefix}/g          brightness  0–255  (retained)
     {prefix}/c          color hex   #RRGGBB (retained)
     {prefix}            "ON" / "OFF"  (retained, WLED compat)
     {prefix}/v          full JSON state  {"on":…,"bri":…}

   PUBLISH (commands to WLED):
     {prefix}            "ON" / "OFF"
     {prefix}/api        JSON  {"on":true,"bri":128,"col":[[r,g,b]]}
     {prefix}/g          brightness  0–255  (plain text)
     {prefix}/col        hex color  "RRGGBB" (no #, WLED format)

   WLED JSON /api topic payload examples:
     {"on":true}
     {"bri":200}
     {"col":[[255,100,0]]}
     {"fx":0,"sx":128,"ix":128}
   ═══════════════════════════════════════════════════════ */

window.WLEDModule = (function () {

  /* ── state ──────────────────────────────────────── */
  var _prefix  = 'wled/my_wled';
  var _power   = false;
  var _bri     = 128;
  var _color   = '#FF6600';   // hex string
  var _speed   = 128;
  var _intens  = 128;

  /* ── debounce timers (sliders) ──────────────────── */
  var _briTimer  = null;
  var _spdTimer  = null;
  var _intTimer  = null;

  /* ── logging shortcut ───────────────────────────── */
  var log = function(m, lvl) { window.AppLog && AppLog[lvl || 'info'](m); };

  /* ════════════════════════════════════════════════
     MQTT SUBSCRIPTIONS
  ════════════════════════════════════════════════ */

  function _subscribe() {
    MQTTClient.subscribe(_prefix + '/v',   _onFullState);   // full JSON
    MQTTClient.subscribe(_prefix + '/g',   _onBrightness);  // brightness 0-255
    MQTTClient.subscribe(_prefix + '/c',   _onColor);       // color #RRGGBB
    MQTTClient.subscribe(_prefix,          _onPower);       // ON / OFF
    log('[WLED] subscribed → ' + _prefix);
  }

  function _unsubscribe() {
    MQTTClient.unsubscribe(_prefix + '/v');
    MQTTClient.unsubscribe(_prefix + '/g');
    MQTTClient.unsubscribe(_prefix + '/c');
    MQTTClient.unsubscribe(_prefix);
  }

  /* ── {prefix}/v  full JSON  ─────────────────────── */
  function _onFullState(payloadStr) {
    var json;
    try { json = JSON.parse(payloadStr); } catch(e) { return; }

    /* WLED /json/state shape: {on, bri, col:[[r,g,b]], seg:[{fx,sx,ix}], ...} */
    /* Relay-controller /v shape: {on, relays:[...]}  — ignore LED fields if absent */

    if (json.bri  !== undefined) { _bri   = Number(json.bri);  _updateBriUI(); }
    if (json.on   !== undefined) { _power = !!json.on;          _updatePowerUI(); }

    /* Color from col array (WLED) or string */
    if (Array.isArray(json.col) && Array.isArray(json.col[0])) {
      var rgb = json.col[0];
      _color = _rgbToHex(rgb[0]||0, rgb[1]||0, rgb[2]||0);
      _updateColorUI();
    } else if (typeof json.col === 'string') {
      _color = json.col.startsWith('#') ? json.col : '#' + json.col;
      _updateColorUI();
    }

    /* Speed & intensity from segment 0 */
    if (Array.isArray(json.seg) && json.seg[0]) {
      var seg = json.seg[0];
      if (seg.sx !== undefined) { _speed  = Number(seg.sx); _updateSpdUI(); }
      if (seg.ix !== undefined) { _intens = Number(seg.ix); _updateIntUI(); }
    }

    log('[WLED] state received');
  }

  /* ── {prefix}/g  brightness ─────────────────────── */
  function _onBrightness(payloadStr) {
    var v = parseInt(payloadStr.trim(), 10);
    if (isNaN(v)) return;
    _bri = Math.max(0, Math.min(255, v));
    _updateBriUI();
  }

  /* ── {prefix}/c  color hex ──────────────────────── */
  function _onColor(payloadStr) {
    var raw = payloadStr.trim();
    if (!raw) return;
    _color = raw.startsWith('#') ? raw : '#' + raw;
    _updateColorUI();
  }

  /* ── {prefix}  ON / OFF ─────────────────────────── */
  function _onPower(payloadStr) {
    var p = payloadStr.trim().toUpperCase();
    if (p === 'ON'  || p === '1' || p === 'TRUE')  { _power = true;  _updatePowerUI(); }
    if (p === 'OFF' || p === '0' || p === 'FALSE') { _power = false; _updatePowerUI(); }
  }

  /* ════════════════════════════════════════════════
     PUBLISH COMMANDS
  ════════════════════════════════════════════════ */

  function _sendPower(on) {
    _power = !!on;
    MQTTClient.publish(_prefix, on ? 'ON' : 'OFF');
    /* Also send JSON for WLED compatibility */
    MQTTClient.publishJSON(_prefix + '/api', { on: on });
    log('→ WLED power ' + (on ? 'ON' : 'OFF'));
    _updatePowerUI();
  }

  function _sendBrightness(val) {
    _bri = Math.max(0, Math.min(255, parseInt(val, 10)));
    MQTTClient.publish(_prefix + '/g', String(_bri));
    log('→ WLED brightness ' + _bri);
  }

  function _sendColor(hex) {
    _color = hex;
    /* WLED expects RRGGBB without # on /col topic */
    var bare = hex.replace('#', '');
    MQTTClient.publish(_prefix + '/col', bare);
    /* Also send via /api for usermod relay controller compatibility */
    var rgb = _hexToRgb(hex);
    MQTTClient.publishJSON(_prefix + '/api', { col: [[rgb.r, rgb.g, rgb.b]] });
    log('→ WLED color ' + hex);
    _updateColorUI();
  }

  function _sendSpeed(val) {
    _speed = Math.max(0, Math.min(255, parseInt(val, 10)));
    MQTTClient.publishJSON(_prefix + '/api', { seg: [{ sx: _speed }] });
    log('→ WLED speed ' + _speed);
  }

  function _sendIntensity(val) {
    _intens = Math.max(0, Math.min(255, parseInt(val, 10)));
    MQTTClient.publishJSON(_prefix + '/api', { seg: [{ ix: _intens }] });
    log('→ WLED intensity ' + _intens);
  }

  /* ════════════════════════════════════════════════
     UI UPDATE HELPERS  (state → DOM, no MQTT send)
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
    /* Highlight matching preset dot */
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

  function _showPanel(visible) {
    var panel = document.getElementById('wled-panel');
    var empty = document.getElementById('wled-empty');
    if (panel) panel.style.display = visible ? '' : 'none';
    if (empty) empty.style.display = visible ? 'none' : '';
  }

  /* ════════════════════════════════════════════════
     WIRE UI EVENTS  (called once on init)
  ════════════════════════════════════════════════ */

  var _eventsWired = false;

  function _wireEvents() {
    if (_eventsWired) return;
    _eventsWired = true;

    /* Power toggle */
    var powerEl = document.getElementById('wled-power');
    powerEl && powerEl.addEventListener('change', function(){
      _sendPower(this.checked);
    });

    /* Brightness slider — debounced 80ms */
    var briEl = document.getElementById('wled-bri');
    briEl && briEl.addEventListener('input', function(){
      var v = this.value;
      var badge = document.getElementById('bri-value');
      if (badge) badge.textContent = v;
      clearTimeout(_briTimer);
      _briTimer = setTimeout(function(){ _sendBrightness(v); }, 80);
    });

    /* Color picker */
    var colorEl = document.getElementById('wled-color');
    colorEl && colorEl.addEventListener('input', function(){
      var badge = document.getElementById('color-hex');
      if (badge) badge.textContent = this.value.toUpperCase();
      clearTimeout(_briTimer);   /* reuse timer slot */
      _briTimer = setTimeout(function(){ _sendColor(colorEl.value); }, 150);
    });

    /* Color preset dots */
    document.querySelectorAll('.color-dot').forEach(function(dot){
      dot.addEventListener('click', function(){
        _sendColor(dot.dataset.color);
      });
    });

    /* Speed slider — debounced 80ms */
    var spdEl = document.getElementById('wled-spd');
    spdEl && spdEl.addEventListener('input', function(){
      var v = this.value;
      var badge = document.getElementById('spd-value');
      if (badge) badge.textContent = v;
      clearTimeout(_spdTimer);
      _spdTimer = setTimeout(function(){ _sendSpeed(v); }, 80);
    });

    /* Intensity slider — debounced 80ms */
    var intEl = document.getElementById('wled-int');
    intEl && intEl.addEventListener('input', function(){
      var v = this.value;
      var badge = document.getElementById('int-value');
      if (badge) badge.textContent = v;
      clearTimeout(_intTimer);
      _intTimer = setTimeout(function(){ _sendIntensity(v); }, 80);
    });
  }

  /* ════════════════════════════════════════════════
     LIFECYCLE
  ════════════════════════════════════════════════ */

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
      if (_prefix !== prefix) _unsubscribe();
      _prefix = prefix;
      _wireEvents();
      _subscribe();
      _showPanel(true);
      /* Sync current UI values */
      _updatePowerUI();
      _updateBriUI();
      _updateColorUI();
      _updateSpdUI();
      _updateIntUI();
      log('[WLED] init → ' + prefix);
    },

    onConnected:    function(){ /* prefix set by init() via app.js wrapper */ },
    onDisconnected: _onDisconnected
  };

})();
