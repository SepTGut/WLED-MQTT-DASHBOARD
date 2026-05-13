/* ═══════════════════════════════════════════════════════
   wled.js  v2.1 — WLED LED control module (Multi-device)
   ─────────────────────────────────────────────────────
   Bug fixes v2.1:
   • render() now correctly references the appended DOM node
     (was calling getElementById before clone was appended)
   • enableControls skips refresh AND remove buttons when offline
   • Refresh button not disabled on disableControls
   • Color presets show 8 colours (restore from old UI)
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
      '(none)', 'Solid', 'Blink', 'Breathe', 'Wipe', 'Wipe Random', 'Random Colors',
      'Sweep', 'Dynamic', 'Colorloop', 'Rainbow', 'Scan', 'Dual Scan', 'Fade',
      'Theater', 'Theater Rainbow', 'Running', 'Saw', 'Twinkle', 'Dissolve',
      'Dissolve Rnd', 'Sparkle', 'Dark Sparkle', 'Sparkle+', 'Strobe',
      'Strobe Rainbow', 'Mega Strobe', 'Blink Rainbow', 'Android', 'Chase',
      'Chase Random', 'Chase Rainbow', 'Chase Flash', 'Chase Flash Rnd',
      'Rainbow Runner', 'Colorful', 'Traffic Light', 'Sweep Random', 'Running 2',
      'Aurora', 'Stream', 'Scanner', 'Lighthouse', 'Fireworks', 'Rain', 'Tetrix',
      'Fire Flicker', 'Gradient', 'Loading', 'Rolling Balls', 'Fairy', 'Two Dots',
      'Fairytwirl', 'Running Dual', 'Halloween', 'Tricolor Chase', 'Tricolor Wipe',
      'Tricolor Fade', 'Lightning', 'ICU', 'Multi Comet', 'Dual Scanner', 'Stream 2',
      'Oscillate', 'Pride 2015', 'Juggle', 'Palette', 'Fire 2012', 'Colorwaves',
      'BPM', 'Fill Noise', 'Noise 1', 'Noise 2', 'Noise 3', 'Noise 4',
      'Colortwinkles', 'Lake', 'Meteor', 'Meteor Smooth', 'Railway', 'Ripple'
    ];

    this.briTimer = null;
    this.spdTimer = null;
    this.intTimer = null;
    this.colorTimer = null;
    this.subscriptions = [];

    this.el = null;    // set after DOM insertion in render()

    this._init();
  }

  log(m, lvl) { window.AppLog && AppLog[lvl || 'info']('[WLED][' + this.prefix + '] ' + m); }

  _init() {
    this._loadState();
    this._render();    // inserts into DOM first
    this._wireEvents();
    this._subscribe();
    setTimeout(() => this._requestFullState(), 600);
    this.log('initialized');
  }

  /* ── Persistence ────────────────────────────── */
  _saveState() {
    try {
      localStorage.setItem('wled_ui_' + this.prefix, JSON.stringify({
        bri: this.bri, color: this.color,
        speed: this.speed, intens: this.intens, fx: this.fx
      }));
    } catch (e) { }
  }

  _loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem('wled_ui_' + this.prefix));
      if (saved) {
        if (saved.bri !== undefined) this.bri = saved.bri;
        if (saved.color !== undefined) this.color = saved.color;
        if (saved.speed !== undefined) this.speed = saved.speed;
        if (saved.intens !== undefined) this.intens = saved.intens;
        if (saved.fx !== undefined) this.fx = saved.fx;
      }
    } catch (e) { }
  }

  /* ── MQTT Subscriptions ─────────────────────── */
  _subscribe() {
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/g', (p) => this._onBrightness(p)));
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/c', (p) => this._onColor(p)));
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/status', (p) => this._onStatus(p)));
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/v', (p) => this._onFullState(p)));
    this.subscriptions.push(MQTTClient.subscribe(this.prefix + '/mcutemp', (p) => this._onMcutemp(p)));
  }

  unsubscribe() {
    this.subscriptions.forEach(s => s.unsubscribe());
    this.subscriptions = [];
  }

  /* ── MQTT Callbacks ─────────────────────────── */
  _onStatus(payloadStr) {
    const p = payloadStr.trim().toLowerCase();
    this.online = (p === 'online');
    this.power = this.online;
    this._updatePowerUI();
    this._enableControls(this.online);
    this.log(this.online ? 'online' : 'offline');
  }

  _onFullState(payloadStr) {
    let json;
    try { json = JSON.parse(payloadStr); } catch (e) { json = null; }

    if (json) {
      if (json.on !== undefined) this.power = !!json.on;
      if (json.bri !== undefined) this.bri = Number(json.bri);
      if (json.col) {
        if (Array.isArray(json.col[0])) {
          const [rr, gg, bb] = json.col[0];
          this.color = this._rgbToHex(rr || 0, gg || 0, bb || 0);
        } else if (typeof json.col === 'string') {
          this.color = json.col.startsWith('#') ? json.col : '#' + json.col;
        }
      }
      if (Array.isArray(json.seg) && json.seg[0]) {
        const seg = json.seg[0];
        if (seg.sx !== undefined) this.speed = Number(seg.sx);
        if (seg.ix !== undefined) this.intens = Number(seg.ix);
        if (seg.fx !== undefined) this.fx = Number(seg.fx);
      }
      if (json.temp !== undefined && !isNaN(Number(json.temp))) {
        this._updateTempUI(Number(json.temp));
      }
      if (Array.isArray(json.effects)) {
        this.effects = ['(none)'].concat(json.effects);
        this._populateEffects();
      }
      this._updateAllUI();
      this._saveState();
      return;
    }

    // XML fallback (WLED < v0.12)
    if (payloadStr.includes('<vs>')) {
      const tag = (name) => { const m = payloadStr.match(new RegExp('<' + name + '>([^<]*)</' + name + '>', 'i')); return m ? m[1] : null; };
      const ac = parseInt(tag('ac'), 10); if (!isNaN(ac)) this.bri = Math.max(0, Math.min(255, ac));
      const sx = parseInt(tag('sx'), 10); if (!isNaN(sx)) this.speed = Math.max(0, Math.min(255, sx));
      const ix = parseInt(tag('ix'), 10); if (!isNaN(ix)) this.intens = Math.max(0, Math.min(255, ix));
      const fx = parseInt(tag('fx'), 10); if (!isNaN(fx)) this.fx = fx;
      this._updateAllUI();
      this._saveState();
    }
  }

  _onMcutemp(payloadStr) {
    const v = parseFloat(payloadStr.trim());
    if (!isNaN(v)) this._updateTempUI(v);
  }

  _onBrightness(p) {
    const v = parseInt(p.trim(), 10);
    if (!isNaN(v)) { this.bri = v; this._updateBriUI(); this._saveState(); }
  }

  _onColor(p) {
    const raw = p.trim();
    if (raw) { this.color = raw.startsWith('#') ? raw : '#' + raw; this._updateColorUI(); this._saveState(); }
  }

  /* ── Commands ───────────────────────────────── */
  _requestFullState() { MQTTClient.publish(this.prefix + '/api', '{"v":true}'); }

  sendPower(on) {
    this.power = !!on;
    MQTTClient.publish(this.prefix, on ? 'ON' : 'OFF');
    MQTTClient.publishJSON(this.prefix + '/api', { on: on });
    this._updatePowerUI();
  }

  sendBrightness(val) {
    this.bri = parseInt(val, 10);
    MQTTClient.publish(this.prefix + '/g', String(this.bri));
    MQTTClient.publishJSON(this.prefix + '/api', { bri: this.bri });
    this._saveState();
  }

  sendColor(hex) {
    this.color = hex;
    MQTTClient.publish(this.prefix + '/c', hex);
    const rgb = this._hexToRgb(hex);
    MQTTClient.publishJSON(this.prefix + '/api', { col: [[rgb.r, rgb.g, rgb.b]] });
    this._updateColorUI();
    this._saveState();
  }

  sendSpeed(val) {
    this.speed = parseInt(val, 10);
    MQTTClient.publishJSON(this.prefix + '/api', { seg: [{ id: 0, sx: this.speed }] });
    this._saveState();
  }

  sendIntensity(val) {
    this.intens = parseInt(val, 10);
    MQTTClient.publishJSON(this.prefix + '/api', { seg: [{ id: 0, ix: this.intens }] });
    this._saveState();
  }

  sendEffect(fx) {
    this.fx = parseInt(fx, 10);
    MQTTClient.publishJSON(this.prefix + '/api', { fx: this.fx });
    this._updateFxUI();
    this._saveState();
  }

  sendPreset(num) { MQTTClient.publishJSON(this.prefix + '/api', { ps: parseInt(num, 10) }); }

  /* ── Render (DOM) ───────────────────────────── */
  _render() {
    const parent = document.getElementById(this.containerId);
    if (!parent) return;
    const t = document.getElementById('tmpl-wled-panel');
    if (!t) return;

    const clone = t.content.cloneNode(true);
    const cardId = 'wled-card-' + this.prefix.replace(/\//g, '-');
    const card = clone.querySelector('.wled-device-card');
    card.id = cardId;
    card.querySelector('.device-name').textContent = this.prefix;

    // FIX: append FIRST, then resolve el by id
    parent.appendChild(clone);
    this.el = document.getElementById(cardId);

    if (!this.el) {
      this.log('render: card element not found after append!', 'error');
      return;
    }

    // Populate effects dropdown
    this._populateEffects();
    // Set initial slider values from saved state
    this._updateAllUI();
  }

  /* ── UI Updates ─────────────────────────────── */
  _find(sel) { return this.el ? this.el.querySelector(sel) : null; }

  _updateAllUI() {
    if (!this.el) return;
    this._updatePowerUI();
    this._updateBriUI();
    this._updateColorUI();
    this._updateSpdUI();
    this._updateIntUI();
    this._updateFxUI();
  }

  _updatePowerUI() {
    const el = this._find('#wled-power');
    if (el) el.checked = this.power;
  }
  _updateBriUI() {
    const s = this._find('#wled-bri');
    const b = this._find('#bri-value');
    if (s) s.value = this.bri;
    if (b) b.textContent = this.bri;
  }
  _updateColorUI() {
    const c = this._find('#wled-color');
    const ch = this._find('#color-hex');
    if (c) c.value = this.color;
    if (ch) ch.textContent = this.color.toUpperCase();
    this.el && this.el.querySelectorAll('.color-dot').forEach(d => {
      d.classList.toggle('active', d.dataset.color.toUpperCase() === this.color.toUpperCase());
    });
  }
  _updateSpdUI() {
    const s = this._find('#wled-spd'); const v = this._find('#spd-value');
    if (s) s.value = this.speed; if (v) v.textContent = this.speed;
  }
  _updateIntUI() {
    const s = this._find('#wled-int'); const v = this._find('#int-value');
    if (s) s.value = this.intens; if (v) v.textContent = this.intens;
  }
  _updateFxUI() {
    const s = this._find('#wled-fx');
    if (s) s.value = this.fx;
  }
  _updateTempUI(v) {
    const el = this._find('#wled-temp');
    if (el) el.textContent = v.toFixed(1) + '°C';
  }

  _populateEffects() {
    const sel = this._find('#wled-fx');
    if (!sel) return;
    const curr = sel.value;
    sel.innerHTML = this.effects.map((name, i) =>
      '<option value="' + (i - 1) + '">' + name + '</option>'
    ).join('');
    sel.value = curr;
  }

  /* ── FIX: enableControls — don't disable refresh or remove ── */
  _enableControls(on) {
    if (!this.el) return;
    this.el.querySelectorAll('input, select, button').forEach(el => {
      // Never disable the remove or refresh buttons
      if (el.classList.contains('btn-wled-remove')) return;
      if (el.classList.contains('btn-wled-refresh')) return;
      el.disabled = !on;
    });
  }

  /* ── Event Wiring ───────────────────────────── */
  _wireEvents() {
    if (!this.el) return;

    this._find('#btn-wled-refresh').onclick = () => this._requestFullState();
    this._find('#wled-power').onchange = (e) => this.sendPower(e.target.checked);

    const sliderBind = (id, badgeId, timerKey, sendFn) => {
      const el = this._find(id);
      const badge = this._find(badgeId);
      if (!el) return;
      el.oninput = () => {
        if (badge) badge.textContent = el.value;
        clearTimeout(this[timerKey]);
        this[timerKey] = setTimeout(() => sendFn.call(this, el.value), 120);
      };
    };

    sliderBind('#wled-bri', '#bri-value', 'briTimer', this.sendBrightness);
    sliderBind('#wled-spd', '#spd-value', 'spdTimer', this.sendSpeed);
    sliderBind('#wled-int', '#int-value', 'intTimer', this.sendIntensity);

    const colorEl = this._find('#wled-color');
    if (colorEl) {
      colorEl.oninput = (e) => {
        const hexEl = this._find('#color-hex');
        if (hexEl) hexEl.textContent = e.target.value.toUpperCase();
        clearTimeout(this.colorTimer);
        this.colorTimer = setTimeout(() => this.sendColor(e.target.value), 160);
      };
    }

    this.el.querySelectorAll('.color-dot').forEach(d => {
      d.onclick = () => this.sendColor(d.dataset.color);
    });

    const fxSel = this._find('#wled-fx');
    if (fxSel) fxSel.onchange = (e) => this.sendEffect(e.target.value);

    const presetBtn = this._find('#btn-wled-loadpreset');
    if (presetBtn) presetBtn.onclick = () => {
      const inp = this._find('#wled-preset');
      if (inp) this.sendPreset(inp.value);
    };

    const removeBtn = this._find('.btn-wled-remove');
    if (removeBtn) removeBtn.onclick = () => {
      if (confirm('Remove WLED device "' + this.prefix + '"?')) {
        window.WLEDModule.removeDevice(this.prefix);
      }
    };
  }

  /* ── Helpers ────────────────────────────────── */
  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
      : { r: 255, g: 102, b: 0 };
  }

  _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
}

/* ════════════════════════════════════════════════
   WLEDModule — multi-device manager
════════════════════════════════════════════════ */
window.WLEDModule = (function () {
  const _devices = {};  // prefix → WLEDDevice

  return {
    init(prefix) {
      if (_devices[prefix]) return;  // already added
      _devices[prefix] = new WLEDDevice(prefix, 'wled-container');
      this._updateEmpty();
    },

    removeDevice(prefix) {
      if (_devices[prefix]) {
        _devices[prefix].unsubscribe();
        const el = document.getElementById('wled-card-' + prefix.replace(/\//g, '-'));
        if (el) el.remove();
        delete _devices[prefix];
        this._updateEmpty();
      }
    },

    _updateEmpty() {
      const empty = document.getElementById('wled-empty');
      if (empty) empty.style.display = Object.keys(_devices).length ? 'none' : '';
    },

    onConnected() {
      Object.keys(_devices).forEach(p => {
        _devices[p]._requestFullState();
      });
    },
    onDisconnected() {
      Object.keys(_devices).forEach(p => {
        const d = _devices[p];
        d.online = false;
        d._enableControls(false);
        d._updatePowerUI();
      });
    }
  };
})();