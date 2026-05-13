/**
 * visuals.js v2.0 — Eye-catching UI effects
 * Aurora mesh · Neon particles · Magnetic buttons · 3D card tilt
 */
'use strict';

class Visuals {
    constructor() {
        this.canvas = document.getElementById('particle-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.mouse = { x: null, y: null };
        this.accentColor = '#f59e0b';
        this.accentRgb = '245,158,11';
        this.lastTheme = '';
        this.performanceMode = false;
        this.animFrame = null;
        this.running = false;
        this._rafBound = this._raf.bind(this);

        // Aurora layers
        this.auroraTime = 0;

        this._init();
    }

    _init() {
        this._resize();
        this._createParticles();
        this._updateAccent();
        this._setupListeners();
        this._start();
    }

    // ─── Accent colour ──────────────────────────────
    _updateAccent() {
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        if (theme === this.lastTheme) return;
        this.lastTheme = theme;

        const style = getComputedStyle(document.body);
        this.accentColor = style.getPropertyValue('--color-accent').trim() || '#f59e0b';

        // Parse rgb values for rgba usage
        const rgbStr = style.getPropertyValue('--color-accent-rgb').trim();
        this.accentRgb = rgbStr || '245,158,11';
    }

    // ─── Resize ─────────────────────────────────────
    _resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        this.ctx.scale(dpr, dpr);
        this.W = window.innerWidth;
        this.H = window.innerHeight;
    }

    // ─── Particles ──────────────────────────────────
    _createParticles() {
        this.particles = [];
        const count = Math.min(Math.floor((this.W * this.H) / 14000), 60);
        for (let i = 0; i < count; i++) {
            this.particles.push(new Particle(this.W, this.H));
        }
    }

    // ─── Event listeners ────────────────────────────
    _setupListeners() {
        // Theme changes
        const obs = new MutationObserver(() => this._updateAccent());
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

        window.addEventListener('resize', () => {
            this._resize();
            this._createParticles();
        });

        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            if (!this.performanceMode) this._applyMagnetic(e);
        });

        window.addEventListener('mouseleave', () => {
            this.mouse.x = null;
            this.mouse.y = null;
        });
    }

    // ─── Magnetic button effect ──────────────────────
    _applyMagnetic(e) {
        const selectors = '.quick-btn, .tab-btn, .primary-btn, .icon-btn, .chip-btn, .conn-badge, .bnav-btn';
        document.querySelectorAll(selectors).forEach(btn => {
            const rect = btn.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = e.clientX - cx;
            const dy = e.clientY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const limit = Math.max(rect.width, 80);

            if (dist < limit) {
                const strength = 0.22 * (1 - dist / limit);
                const tx = dx * strength;
                const ty = dy * strength;
                btn.style.transform = `translate(${tx}px, ${ty}px)`;
            } else if (btn.style.transform) {
                btn.style.transform = '';
            }
        });
    }

    // ─── Card 3-D tilt ──────────────────────────────
    _apply3DTilt(e) {
        document.querySelectorAll('.relay-card, .sensor-card').forEach(card => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Only tilt if mouse is near the card
            const margin = 60;
            if (x > -margin && y > -margin && x < rect.width + margin && y < rect.height + margin) {
                const rx = ((y - rect.height / 2) / rect.height) * 10;
                const ry = -((x - rect.width / 2) / rect.width) * 10;
                card.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-3px)`;
                card.style.boxShadow = `0 16px 40px -10px rgba(${this.accentRgb},.25)`;
            } else {
                card.style.transform = '';
                card.style.boxShadow = '';
            }
        });
    }

    // ─── Render loop ────────────────────────────────
    _start() {
        if (this.running) return;
        this.running = true;
        this._raf();
    }

    _stop() {
        this.running = false;
        if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    }

    _raf() {
        if (!this.running) return;
        this.animFrame = requestAnimationFrame(this._rafBound);
        this._draw();
    }

    _draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.W, this.H);

        if (this.performanceMode) return;

        this.auroraTime += 0.004;
        this._drawAurora(ctx);
        this._drawGrid(ctx);
        this._updateParticles(ctx);
        this._connectParticles(ctx);
    }

    // ─── Aurora mesh background ──────────────────────
    _drawAurora(ctx) {
        const t = this.auroraTime;
        const W = this.W;
        const H = this.H;
        const [r, g, b] = this.accentRgb.split(',').map(Number);

        // Blob 1 — top-left, accent colour
        const g1 = ctx.createRadialGradient(
            W * (0.12 + Math.sin(t * 0.7) * 0.08),
            H * (0.14 + Math.cos(t * 0.5) * 0.08),
            0,
            W * 0.18, H * 0.18, W * 0.45
        );
        g1.addColorStop(0, `rgba(${r},${g},${b}, 0.07)`);
        g1.addColorStop(1, 'transparent');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, W, H);

        // Blob 2 — bottom-right, accent shifted
        const g2 = ctx.createRadialGradient(
            W * (0.84 + Math.cos(t * 0.6) * 0.07),
            H * (0.78 + Math.sin(t * 0.4) * 0.07),
            0,
            W * 0.80, H * 0.75, W * 0.4
        );
        g2.addColorStop(0, `rgba(${r},${g},${b}, 0.05)`);
        g2.addColorStop(1, 'transparent');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, W, H);

        // Blob 3 — centre-bottom, contrasting tint (blue/teal)
        const g3 = ctx.createRadialGradient(
            W * (0.5 + Math.sin(t * 0.3) * 0.12),
            H * (0.85 + Math.cos(t * 0.55) * 0.06),
            0,
            W * 0.5, H * 0.85, W * 0.35
        );
        g3.addColorStop(0, 'rgba(56,189,248, 0.05)');
        g3.addColorStop(1, 'transparent');
        ctx.fillStyle = g3;
        ctx.fillRect(0, 0, W, H);
    }

    // ─── Subtle grid ────────────────────────────────
    _drawGrid(ctx) {
        const [r, g, b] = this.accentRgb.split(',').map(Number);
        const t = this.auroraTime;
        const drift = (t * 18) % 48;
        ctx.strokeStyle = `rgba(${r},${g},${b}, 0.04)`;
        ctx.lineWidth = 0.5;
        const spacing = 48;

        ctx.beginPath();
        for (let x = -spacing + (drift % spacing); x < this.W + spacing; x += spacing) {
            ctx.moveTo(x, 0); ctx.lineTo(x, this.H);
        }
        for (let y = -spacing + (drift % spacing); y < this.H + spacing; y += spacing) {
            ctx.moveTo(0, y); ctx.lineTo(this.W, y);
        }
        ctx.stroke();
    }

    // ─── Particle update & draw ──────────────────────
    _updateParticles(ctx) {
        const [r, g, b] = this.accentRgb.split(',').map(Number);
        this.particles.forEach(p => {
            p.update(this.mouse, this.W, this.H);
            // Glow
            ctx.shadowBlur = 6;
            ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
            ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.shadowBlur = 0;
    }

    // ─── Connect nearby particles ────────────────────
    _connectParticles(ctx) {
        const [r, g, b] = this.accentRgb.split(',').map(Number);
        const maxDist = 120;
        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                const dx = this.particles[i].x - this.particles[j].x;
                const dy = this.particles[i].y - this.particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < maxDist) {
                    const alpha = (1 - dist / maxDist) * 0.25;
                    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(this.particles[i].x, this.particles[i].y);
                    ctx.lineTo(this.particles[j].x, this.particles[j].y);
                    ctx.stroke();
                }
            }
        }
    }

    // ─── Public API ──────────────────────────────────
    setPerformanceMode(on) {
        this.performanceMode = !!on;

        if (this.performanceMode) {
            // Reset all transforms imposed by effects
            const all = '.relay-card, .sensor-card, .section-card, .quick-btn, .tab-btn, .primary-btn, .icon-btn, .chip-btn, .conn-badge';
            document.querySelectorAll(all).forEach(el => {
                el.style.transform = '';
                el.style.boxShadow = '';
            });
        } else {
            // Restart loop if it stopped
            if (!this.running) this._start();
        }
    }

    // Called externally when hovering cards (wired in app.js if desired)
    applyEffects(e) {
        if (!this.performanceMode) this._apply3DTilt(e);
    }
}

// ─── Particle ────────────────────────────────────────
class Particle {
    constructor(W, H) {
        this._init(W, H);
    }

    _init(W, H) {
        this.W = W;
        this.H = H;
        this.x = Math.random() * W;
        this.y = Math.random() * H;
        this.size = Math.random() * 1.6 + 0.4;
        this.vx = (Math.random() - 0.5) * 0.45;
        this.vy = (Math.random() - 0.5) * 0.45;
        this.alpha = Math.random() * 0.5 + 0.15;
        this.alphaDir = (Math.random() > 0.5) ? 1 : -1;
    }

    update(mouse, W, H) {
        this.x += this.vx;
        this.y += this.vy;

        // Gentle alpha breathing
        this.alpha += this.alphaDir * 0.003;
        if (this.alpha > 0.65 || this.alpha < 0.05) this.alphaDir *= -1;

        // Wrap edges
        if (this.x < 0) this.x = W;
        if (this.x > W) this.x = 0;
        if (this.y < 0) this.y = H;
        if (this.y > H) this.y = 0;

        // Repel from mouse
        if (mouse.x !== null) {
            const dx = this.x - mouse.x;
            const dy = this.y - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const r = 100;
            if (dist < r) {
                const force = (r - dist) / r;
                this.x += dx * force * 0.02;
                this.y += dy * force * 0.02;
            }
        }
    }
}

// ─── Boot ────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    window.visuals = new Visuals();

    // Wire card hover → 3D tilt
    document.addEventListener('mousemove', (e) => {
        if (window.visuals && !window.visuals.performanceMode) {
            window.visuals.applyEffects(e);
        }
    });
});