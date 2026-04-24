/* ═══════════════════════════════════════════════════════
   wled.js  —  WLED LED control module (custom device)
   ─────────────────────────────────────────────────────
   MQTT topics used:

   SUBSCRIBE (state from device):
     {prefix}/g          brightness  0–255
     {prefix}/c          color hex   #RRGGBB
     {prefix}/status     "online" / "offline"
     {prefix}/v          (custom encoded, ignored)

   PUBLISH (commands to device):
     {prefix}            "ON" / "OFF"   (if supported)
     {prefix}/g          brightness  0–255
     {prefix}/c          color hex   #RRGGBB
   ═══════════════════════════════════════════════════════ */

window.WLEDModule = (function () {

  var _prefix  = 'wled/my_wled';
  var _power   = false;
  var _bri     = 128;
  var _color   = '#FF6600';
  var _speed   = 128;   // not used by this device but kept for UI consistency
  var _intens  = 128;

  var _briTimer  = null;
  var _spdTimer  = null;
  var _intTimer  = null;

  var log = function(m, lvl) { window.AppLog && AppLog[lvl || 'info'](m); };

  function _subscribe() {
    MQTTClient.subscribe(_prefix + '/g',      _onBrightness);
    MQTTClient.subscribe(_prefix + '/c',      _onColor);
    MQTTClient.subscribe(_prefix + '/status', _onStatus);   // custom power topic
    // /v is ignored because it's not JSON
    log('[WLED] subscribed → ' + _prefix);
  }

  function _unsubscribe() {
    // No handles saved; prefix change just reconnects, so old subscriptions die automatically
  }

  /* ── Status (online/offline) ────────────────────── */
  function _onStatus(payloadStr) {
    var p = payloadStr.trim().toLowerCase();
    if (p === 'online')  { _power = true;  _updatePowerUI(); }
    if (p === 'offline') { _power = false; _updatePowerUI(); }
  }

  /* ── {prefix}/v  ignored ────────────────────────── */
  function _onFullState(payloadStr) {
    // not used
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

  /* ════════════════════════════════════════════════
     PUBLISH COMMANDS
  ════════════════════════════════════════════════ */

  function _sendPower(on) {
    _power = !!on;
    MQTTClient.publish(_prefix, on ? 'ON' : 'OFF');      // try standard WLED
    // Uncomment if your device listens on /status for commands
    // MQTTClient.publish(_prefix + '/status', on ? 'online' : 'offline');
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
    MQTTClient.publish(_prefix + '/c', hex);      // your device expects #RRGGBB on /c
    log('→ WLED color ' + hex);
    _updateColorUI();
  }

  function _sendSpeed(val) {
    _speed = Math.max(0, Math.min(255, parseInt(val, 10)));
    // Not supported by this device; just update UI
    log('→ WLED speed ' + _speed + ' (local only)');
  }

  function _sendIntensity(val) {
    _intens = Math.max(0, Math.min(255, parseInt(val, 10)));
    log('→ WLED intensity ' + _intens + ' (local only)');
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

  function _showPanel(visible) {
    var panel = document.getElementById('wled-panel');
    var empty = document.getElementById('wled-empty');
    if (panel) panel.style.display = visible ? '' : 'none';
    if (empty) empty.style.display = visible ? 'none' : '';
  }

  var _eventsWired = false;

  function _wireEvents() {
    if (_eventsWired) return;
    _eventsWired = true;

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
  }

  function _onDisconnected() {
    _showPanel(false);
  }

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
      log('[WLED] init → ' + prefix);
    },
    onConnected:    function(){},
    onDisconnected: _onDisconnected
  };
})();