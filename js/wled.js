/* ═══════════════════════════════════════════════════════
   wled.js  —  WLED LED control module (custom device)
   ─────────────────────────────────────────────────────
   MQTT topics used:

   SUBSCRIBE (state from device):
     {prefix}/g          brightness  0–255
     {prefix}/c          color hex   #RRGGBB
     {prefix}/status     "online" / "offline"
     {prefix}/v          XML state (custom device) or JSON (standard WLED)
     {prefix}/mcutemp    MCU temperature (float)

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
  
  var _effects = [
    "(none)", "Solid", "Blink", "Breathe", "Wipe", "Wipe Random", "Random Colors", "Sweep", "Dynamic", "Colorloop",
    "Rainbow", "Scan", "Dual Scan", "Fade", "Theater", "Theater Rainbow", "Running", "Saw", "Twinkle", "Dissolve",
    "Dissolve Rnd", "Sparkle", "Dark Sparkle", "Sparkle+", "Strobe", "Strobe Rainbow", "Mega Strobe", "Blink Rainbow",
    "Android", "Chase", "Chase Random", "Chase Rainbow", "Chase Flash", "Chase Flash Rnd", "Rainbow Runner", "Colorful",
    "Traffic Light", "Sweep Random", "Running 2", "Aurora", "Stream", "Scanner", "Lighthouse", "Fireworks", "Rain",
    "Tetrix", "Fire Flicker", "Gradient", "Loading", "Rolling Balls", "Fairy", "Two Dots", "Fairytwirl", "Running Dual",
    "Halloween", "Tricolor Chase", "Tricolor Wipe", "Tricolor Fade", "Lightning", "ICU", "Multi Comet", "Dual Scanner", "Stream 2",
    "Oscillate", "Pride 2015", "Juggle", "Palette", "Fire 2012", "Colorwaves", "BPM", "Fill Noise", "Noise 1", "Noise 2",
    "Noise 3", "Noise 4", "Colortwinkles", "Lake", "Meteor", "Meteor Smooth", "Railway", "Ripple"
  ];

  var _briTimer  = null;
  var _spdTimer  = null;
  var _intTimer  = null;
  var _online    = false;

  var log = function(m, lvl) { window.AppLog && AppLog[lvl || 'info'](m); };

  function _saveState() {
    try {
      var data = {
        bri: _bri,
        color: _color,
        speed: _speed,
        intens: _intens,
        fx: _fx
      };
      localStorage.setItem('wled_ui_state_' + _prefix, JSON.stringify(data));
    } catch (e) {}
  }

  function _loadState() {
    try {
      var saved = localStorage.getItem('wled_ui_state_' + _prefix);
      if (saved) {
        var data = JSON.parse(saved);
        if (data.bri !== undefined) _bri = data.bri;
        if (data.color !== undefined) _color = data.color;
        if (data.speed !== undefined) _speed = data.speed;
        if (data.intens !== undefined) _intens = data.intens;
        if (data.fx !== undefined) _fx = data.fx;
      }
    } catch (e) {}
  }

  /* ════════════════════════════════════════════════
     MQTT SUBSCRIPTIONS
  ════════════════════════════════════════════════ */

  function _subscribe() {
    MQTTClient.subscribe(_prefix + '/g',       _onBrightness);
    MQTTClient.subscribe(_prefix + '/c',       _onColor);
    MQTTClient.subscribe(_prefix + '/status',  _onStatus);
    MQTTClient.subscribe(_prefix + '/v',       _onFullState);
    MQTTClient.subscribe(_prefix + '/mcutemp', _onMcutemp);
    log('[WLED] subscribed → ' + _prefix);
  }

  /* ── Status (online/offline) ────────────────────── */
  function _onStatus(payloadStr) {
    var p = payloadStr.trim().toLowerCase();
    if (p === 'online')  { _power = true;  _online = true;  _updatePowerUI(); _enableControls(true); }
    if (p === 'offline') { _power = false; _online = false; _updatePowerUI(); _enableControls(false); _clearTemp(); }
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
    if (!on) _clearTemp();
  }

  /* ── Clear temperature badge ────────────────────── */
  function _clearTemp() {
    var el = document.getElementById('wled-temp');
    if (el) el.textContent = '--°C';
  }

  /* ── {prefix}/v  full state (JSON or XML) ───────── */
  function _onFullState(payloadStr) {
    // Try JSON first (standard WLED)
    var json;
    try { json = JSON.parse(payloadStr); } catch(e) { json = null; }
    if (json) {
      if (json.on   !== undefined) { _power = !!json.on;          _updatePowerUI(); }
      if (json.bri  !== undefined) { _bri   = Number(json.bri);    _updateBriUI(); }

      if (Array.isArray(json.col) && Array.isArray(json.col[0])) {
        var rgb = json.col[0];
        _color = _rgbToHex(rgb[0]||0, rgb[1]||0, rgb[2]||0);
        _updateColorUI();
      } else if (typeof json.col === 'string') {
        _color = json.col.startsWith('#') ? json.col : '#' + json.col;
        _updateColorUI();
        _saveState();
      }

      if (Array.isArray(json.seg) && json.seg[0]) {
        var seg = json.seg[0];
        if (seg.sx !== undefined) { _speed  = Number(seg.sx); _updateSpdUI(); }
        if (seg.ix !== undefined) { _intens = Number(seg.ix); _updateIntUI(); }
        if (seg.fx !== undefined) { _fx     = Number(seg.fx); _updateFxUI(); }
        _saveState();
      }

        if (json.temp !== undefined && !isNaN(Number(json.temp))) {
          _updateTempUI(Number(json.temp));
        }

        // Optional: Update effect list if present in full state
        if (Array.isArray(json.effects)) {
          _effects = ["(none)"].concat(json.effects);
          _populateEffects();
        }
        return;
    }

    // XML path (custom KamarATS/SetGT device)
    if (payloadStr.indexOf('<vs>') !== -1) {
      var tag = function(name) {
        var re = new RegExp('<' + name + '>([^<]*)</' + name + '>', 'i');
        var m  = payloadStr.match(re);
        return m ? m[1] : null;
      };

      // Brightness
      var ac = parseInt(tag('ac'), 10);
      if (!isNaN(ac)) { _bri = Math.max(0, Math.min(255, ac)); _updateBriUI(); _saveState(); }

      // Color (multiple <cl> elements)
      var clValues = [];
      var clRe = /<cl>([^<]*)<\/cl>/gi;
      var clMatch;
      while ((clMatch = clRe.exec(payloadStr)) !== null) {
        clValues.push(parseInt(clMatch[1], 10));
      }
      if (clValues.length >= 3) {
        var r = clValues[0] || 0, g = clValues[1] || 0, b = clValues[2] || 0;
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          _color = _rgbToHex(r, g, b);
          _updateColorUI();
          _saveState();
        }
      }

      // Speed
      var sx = parseInt(tag('sx'), 10);
      if (!isNaN(sx)) { _speed = Math.max(0, Math.min(255, sx)); _updateSpdUI(); _saveState(); }

      // Intensity
      var ix = parseInt(tag('ix'), 10);
      if (!isNaN(ix)) { _intens = Math.max(0, Math.min(255, ix)); _updateIntUI(); _saveState(); }

      // Effect
      var fx = parseInt(tag('fx'), 10);
      if (!isNaN(fx) && fx >= 0) { _fx = fx; _updateFxUI(); _saveState(); }
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

  /* ── brightness ─────────────────────────────────── */
  function _onBrightness(payloadStr) {
    var v = parseInt(payloadStr.trim(), 10);
    if (isNaN(v)) return;
    _bri = Math.max(0, Math.min(255, v));
    _updateBriUI();
    _saveState();
  }

  /* ── color hex ──────────────────────────────────── */
  function _onColor(payloadStr) {
    var raw = payloadStr.trim();
    if (!raw) return;
    _color = raw.startsWith('#') ? raw : '#' + raw;
    _updateColorUI();
    _saveState();
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
    _saveState();
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
    _saveState();
  }

  function _sendSpeed(val) {
    _speed = Math.max(0, Math.min(255, parseInt(val, 10)));
    MQTTClient.publishJSON(_prefix + '/api', { seg: [{ id: 0, sx: _speed }] });
    log('→ WLED speed ' + _speed);
    _saveState();
  }

  function _sendIntensity(val) {
    _intens = Math.max(0, Math.min(255, parseInt(val, 10)));
    MQTTClient.publishJSON(_prefix + '/api', { seg: [{ id: 0, ix: _intens }] });
    log('→ WLED intensity ' + _intens);
    _saveState();
  }

  function _sendEffect(fx) {
    fx = parseInt(fx, 10);
    if (isNaN(fx) || fx < 0) return;
    _fx = fx;
    MQTTClient.publishJSON(_prefix + '/api', { fx: fx });
    log('→ WLED effect ' + fx);
    _updateFxUI();
    _saveState();
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

  function _populateEffects() {
    var sel = document.getElementById('wled-fx');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = "";
    _effects.forEach(function(name, i) {
      var opt = document.createElement('option');
      opt.value = i - 1;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.value = current;
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
      _loadState();
      _populateEffects();
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