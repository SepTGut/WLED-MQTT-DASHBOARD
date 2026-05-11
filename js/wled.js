/* ═══════════════════════════════════════════════════════
   wled.js  —  WLED LED control module (Multi-device version)
   ─────────────────────────────────────────────────────
   ═══════════════════════════════════════════════════════ */

class WLEDDevice {
  constructor(prefix, containerId) {
    this.prefix = prefix;
    this.containerId = containerId;
    this.power = false;
    this.bri = 128;
    this.color = '#FF6600';
    this.speed = 128;
    this.intens = 128;
    this.fx = -1;
    this.mcuTemp = null;
    this.online = false;
    this.effects = [
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

    this.briTimer = null;
    this.spdTimer = null;
    this.intTimer = null;
    this.subscriptions = [];

    this.init();
  }

  log(m, lvl) { window.AppLog && AppLog[lvl || 'info'](`[WLED][${this.prefix}] ${m}`); }

  init() {
    this.loadState();
    this.render();
    this.wireEvents();
    this.subscribe();
    setTimeout(() => this.requestFullState(), 500);
    this.log('initialized');
  }

  saveState() {
    try {
      const data = { bri: this.bri, color: this.color, speed: this.speed, intens: this.intens, fx: this.fx };
      localStorage.setItem('wled_ui_state_' + this.prefix, JSON.stringify(data));
    } catch (e) {}
  }

  loadState() {
    try {
      const saved = localStorage.getItem('wled_ui_state_' + this.prefix);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.bri !== undefined) this.bri = data.bri;
        if (data.color !== undefined) this.color = data.color;
        if (data.speed !== undefined) this.speed = data.speed;
        if (data.intens !== undefined) this.intens = data.intens;
        if (data.fx !== undefined) this.fx = data.fx;
      }
    } catch (e) {}
  }

  subscribe() {
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/g', (p) => this.onBrightness(p)));
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/c', (p) => this.onColor(p)));
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/status', (p) => this.onStatus(p)));
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/v', (p) => this.onFullState(p)));
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/mcutemp', (p) => this.onMcutemp(p)));
  }

  unsubscribe() {
    this.subscriptions.forEach(s => s.unsubscribe());
    this.subscriptions = [];
  }

  onStatus(payloadStr) {
    const p = payloadStr.trim().toLowerCase();
    this.online = (p === 'online');
    this.power = this.online;
    this.updatePowerUI();
    this.enableControls(this.online);
  }

  onFullState(payloadStr) {
    let json;
    try { json = JSON.parse(payloadStr); } catch(e) { json = null; }
    if (json) {
      if (json.on   !== undefined) this.power = !!json.on;
      if (json.bri  !== undefined) this.bri   = Number(json.bri);
      if (json.col) {
          if (Array.isArray(json.col[0])) {
            const rgb = json.col[0];
            this.color = this.rgbToHex(rgb[0]||0, rgb[1]||0, rgb[2]||0);
          } else if (typeof json.col === 'string') {
            this.color = json.col.startsWith('#') ? json.col : '#' + json.col;
          }
      }
      if (Array.isArray(json.seg) && json.seg[0]) {
        const seg = json.seg[0];
        if (seg.sx !== undefined) this.speed  = Number(seg.sx);
        if (seg.ix !== undefined) this.intens = Number(seg.ix);
        if (seg.fx !== undefined) this.fx     = Number(seg.fx);
      }
      if (json.temp !== undefined && !isNaN(Number(json.temp))) {
          this.updateTempUI(Number(json.temp));
      }
      if (Array.isArray(json.effects)) {
          this.effects = ["(none)"].concat(json.effects);
          this.populateEffects();
      }
      this.updateAllUI();
      this.saveState();
      return;
    }

    // XML fallback... (keeping XML logic for backward compat)
    if (payloadStr.indexOf('<vs>') !== -1) {
        const tag = (name) => {
            const re = new RegExp('<' + name + '>([^<]*)</' + name + '>', 'i');
            const m  = payloadStr.match(re);
            return m ? m[1] : null;
        };
        const ac = parseInt(tag('ac'), 10);
        if (!isNaN(ac)) this.bri = Math.max(0, Math.min(255, ac));
        const sx = parseInt(tag('sx'), 10);
        if (!isNaN(sx)) this.speed = Math.max(0, Math.min(255, sx));
        const ix = parseInt(tag('ix'), 10);
        if (!isNaN(ix)) this.intens = Math.max(0, Math.min(255, ix));
        const fx = parseInt(tag('fx'), 10);
        if (!isNaN(fx)) this.fx = fx;
        this.updateAllUI();
        this.saveState();
    }
  }

  onMcutemp(payloadStr) {
    const v = parseFloat(payloadStr.trim());
    if (!isNaN(v)) this.updateTempUI(v);
  }

  onBrightness(p) {
    const v = parseInt(p.trim(), 10);
    if (!isNaN(v)) { this.bri = v; this.updateBriUI(); this.saveState(); }
  }

  onColor(p) {
    const raw = p.trim();
    if (raw) { this.color = raw.startsWith('#') ? raw : '#' + raw; this.updateColorUI(); this.saveState(); }
  }

  requestFullState() {
    MQTTClient.publish(this.prefix + '/api', '{"v":true}');
  }

  sendPower(on) {
    this.power = !!on;
    MQTTClient.publish(this.prefix, on ? 'ON' : 'OFF');
    MQTTClient.publishJSON(this.prefix + '/api', { on: on });
    this.updatePowerUI();
  }

  sendBrightness(val) {
    this.bri = parseInt(val, 10);
    MQTTClient.publish(this.prefix + '/g', String(this.bri));
    MQTTClient.publishJSON(this.prefix + '/api', { bri: this.bri });
    this.saveState();
  }

  sendColor(hex) {
    this.color = hex;
    MQTTClient.publish(this.prefix + '/c', hex);
    const rgb = this.hexToRgb(hex);
    MQTTClient.publishJSON(this.prefix + '/api', { col: [[rgb.r, rgb.g, rgb.b]] });
    this.updateColorUI();
    this.saveState();
  }

  sendSpeed(val) {
    this.speed = parseInt(val, 10);
    MQTTClient.publishJSON(this.prefix + '/api', { seg: [{ id: 0, sx: this.speed }] });
    this.saveState();
  }

  sendIntensity(val) {
    this.intens = parseInt(val, 10);
    MQTTClient.publishJSON(this.prefix + '/api', { seg: [{ id: 0, ix: this.intens }] });
    this.saveState();
  }

  sendEffect(fx) {
    this.fx = parseInt(fx, 10);
    MQTTClient.publishJSON(this.prefix + '/api', { fx: this.fx });
    this.updateFxUI();
    this.saveState();
  }

  sendPreset(num) {
    MQTTClient.publishJSON(this.prefix + '/api', { ps: parseInt(num, 10) });
  }

  /* ── UI Rendering ───────────────────────────── */
  render() {
    const parent = document.getElementById(this.containerId);
    if (!parent) return;

    const t = document.getElementById('tmpl-wled-panel');
    if (!t) return;

    const clone = t.content.cloneNode(true);
    const card = clone.querySelector('.wled-device-card');
    card.id = 'wled-card-' + this.prefix.replace(/\//g, '-');
    card.querySelector('.device-name').textContent = this.prefix;
    
    parent.appendChild(clone);
    this.el = document.getElementById(card.id);
  }

  updateAllUI() {
    this.updatePowerUI();
    this.updateBriUI();
    this.updateColorUI();
    this.updateSpdUI();
    this.updateIntUI();
    this.updateFxUI();
  }

  updatePowerUI() { this.find('#wled-power').checked = this.power; }
  updateBriUI() { 
      this.find('#wled-bri').value = this.bri;
      this.find('#bri-value').textContent = this.bri;
  }
  updateColorUI() {
      this.find('#wled-color').value = this.color;
      this.find('#color-hex').textContent = this.color.toUpperCase();
      this.el.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color.toUpperCase() === this.color.toUpperCase()));
  }
  updateSpdUI() { this.find('#wled-spd').value = this.speed; this.find('#spd-value').textContent = this.speed; }
  updateIntUI() { this.find('#wled-int').value = this.intens; this.find('#int-value').textContent = this.intens; }
  updateFxUI() { this.find('#wled-fx').value = this.fx; }
  updateTempUI(v) { this.find('#wled-temp').textContent = v.toFixed(1) + '°C'; }

  populateEffects() {
    const sel = this.find('#wled-fx');
    const curr = sel.value;
    sel.innerHTML = this.effects.map((name, i) => `<option value="${i - 1}">${name}</option>`).join('');
    sel.value = curr;
  }

  enableControls(on) {
      this.el.querySelectorAll('input, select, button').forEach(el => {
          if (!el.classList.contains('btn-wled-remove')) el.disabled = !on;
      });
  }

  find(sel) { return this.el.querySelector(sel); }

  wireEvents() {
    this.find('#btn-wled-refresh').onclick = () => this.requestFullState();
    this.find('#wled-power').onchange = (e) => this.sendPower(e.target.checked);
    
    const sliderInput = (id, badgeId, timer, sendFn) => {
        const el = this.find(id);
        const badge = this.find(badgeId);
        el.oninput = () => {
            badge.textContent = el.value;
            clearTimeout(this[timer]);
            this[timer] = setTimeout(() => sendFn.call(this, el.value), 100);
        };
    };

    sliderInput('#wled-bri', '#bri-value', 'briTimer', this.sendBrightness);
    sliderInput('#wled-spd', '#spd-value', 'spdTimer', this.sendSpeed);
    sliderInput('#wled-int', '#int-value', 'intTimer', this.sendIntensity);

    this.find('#wled-color').oninput = (e) => {
        this.find('#color-hex').textContent = e.target.value.toUpperCase();
        clearTimeout(this.briTimer);
        this.briTimer = setTimeout(() => this.sendColor(e.target.value), 150);
    };

    this.el.querySelectorAll('.color-dot').forEach(d => {
        d.onclick = () => this.sendColor(d.dataset.color);
    });

    this.find('#wled-fx').onchange = (e) => this.sendEffect(e.target.value);
    this.find('#btn-wled-loadpreset').onclick = () => this.sendPreset(this.find('#wled-preset').value);
    
    this.find('.btn-wled-remove').onclick = () => {
        if (confirm('Remove this WLED device?')) {
            window.WLEDModule.removeDevice(this.prefix);
        }
    };
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 255, g: 102, b: 0 };
  }

  rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
}

window.WLEDModule = (function () {
  const _devices = {}; // prefix -> WLEDDevice instance

  return {
    init: function (prefix) {
      if (_devices[prefix]) return;
      _devices[prefix] = new WLEDDevice(prefix, 'wled-container');
      this.updateEmptyState();
    },
    removeDevice: function (prefix) {
        if (_devices[prefix]) {
            _devices[prefix].unsubscribe();
            const el = document.getElementById('wled-card-' + prefix.replace(/\//g, '-'));
            if (el) el.remove();
            delete _devices[prefix];
            this.updateEmptyState();
        }
    },
    updateEmptyState: function () {
        const empty = document.getElementById('wled-empty');
        if (empty) empty.style.display = Object.keys(_devices).length ? 'none' : '';
    },
    onConnected: function () {},
    onDisconnected: function () {
        Object.keys(_devices).forEach(p => {
            const d = _devices[p];
            d.online = false;
            d.enableControls(false);
            d.updatePowerUI();
        });
    }
  };
})();