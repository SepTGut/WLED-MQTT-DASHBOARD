/**
 * visuals.js - Eye-catching UI effects & animations
 * Premium Polish Edition
 */

class Visuals {
    constructor() {
        this.canvas = document.getElementById('particle-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.mouse = { x: null, y: null, radius: 180 };
        this.accentColor = '#f59e0b';
        this.lastTheme = '';
        this.performanceMode = false;

        this.init();
        this.animate();
        this.setupEventListeners();
    }

    init() {
        this.resize();
        this.createParticles();
        this.updateAccentColor();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    createParticles() {
        this.particles = [];
        const quantity = Math.floor((this.canvas.width * this.canvas.height) / 12000);
        for (let i = 0; i < quantity; i++) {
            this.particles.push(new Particle(this.canvas.width, this.canvas.height));
        }
    }

    updateAccentColor() {
        const theme = document.documentElement.getAttribute('data-theme');
        if (theme === this.lastTheme) return;
        this.lastTheme = theme;
        this.accentColor = getComputedStyle(document.body).getPropertyValue('--color-accent').trim() || '#f59e0b';
    }

    setupEventListeners() {
        // Watch for theme changes
        const observer = new MutationObserver(() => this.updateAccentColor());
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

        window.addEventListener('resize', () => {
            this.resize();
            this.createParticles();
        });

        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            this.applyEffects(e);
        });
    }

    applyEffects(e) {
        if (this.performanceMode) return;
        // 1. 3D Tilt & Glare for Cards
        const cards = document.querySelectorAll('.relay-card, .sensor-card, .section-card');
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            if (x > -50 && y > -50 && x < rect.width + 50 && y < rect.height + 50) {
                // Tilt
                const rotateX = (y - rect.height / 2) / 15;
                const rotateY = -(x - rect.width / 2) / 15;
                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-5px)`;
                
                // Set CSS variables for Glare (the ::after element uses these)
                const px = (x / rect.width) * 100;
                const py = (y / rect.height) * 100;
                card.style.setProperty('--x', `${px}%`);
                card.style.setProperty('--y', `${py}%`);
                
                if (card.classList.contains('relay-card')) {
                    card.style.boxShadow = `0 20px 40px -15px var(--color-accent-dim), var(--shadow-lg)`;
                }
            } else {
                card.style.transform = '';
                card.style.boxShadow = '';
            }
        });

        // 2. Magnetic Buttons & Icons
        const magnetics = document.querySelectorAll('.quick-btn, .tab-btn, .primary-btn, .icon-btn, .chip-btn, .conn-badge');
        magnetics.forEach(btn => {
            const rect = btn.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distX = e.clientX - centerX;
            const distY = e.clientY - centerY;
            const dist = Math.sqrt(distX * distX + distY * distY);

            const limit = btn.classList.contains('conn-badge') ? 100 : 60;
            if (dist < limit) {
                const strength = btn.classList.contains('conn-badge') ? 0.15 : 0.3;
                const x = distX * strength;
                const y = distY * strength;
                btn.style.transform = `translate(${x}px, ${y}px)`;
                if (btn.querySelector('svg')) {
                    btn.querySelector('svg').style.transform = `scale(1.1) translate(${x * 0.2}px, ${y * 0.2}px)`;
                }
            } else {
                btn.style.transform = '';
                if (btn.querySelector('svg')) {
                    btn.querySelector('svg').style.transform = '';
                }
            }
        });
    }

    animate() {
        if (this.performanceMode) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        const accent = this.accentColor;

        this.particles.forEach(p => {
            p.update(this.mouse);
            p.draw(this.ctx, accent);
        });

        this.connectParticles(accent);
        requestAnimationFrame(() => this.animate());
    }

    connectParticles(color) {
        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                const dx = this.particles[i].x - this.particles[j].x;
                const dy = this.particles[i].y - this.particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 130) {
                    this.ctx.strokeStyle = color;
                    this.ctx.globalAlpha = (1 - (distance / 130)) * 0.3;
                    this.ctx.lineWidth = 0.6;
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
                    this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
                    this.ctx.stroke();
                }
            }
        }
        this.ctx.globalAlpha = 1;
    }

    setPerformanceMode(on) {
        this.performanceMode = !!on;
        if (!this.performanceMode) {
            this.animate();
        } else {
            // Reset all card/button transforms
            document.querySelectorAll('.relay-card, .sensor-card, .section-card, .quick-btn, .tab-btn, .primary-btn, .icon-btn, .chip-btn, .conn-badge')
                .forEach(el => {
                    el.style.transform = '';
                    el.style.boxShadow = '';
                });
        }
    }
}

class Particle {
    constructor(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.size = Math.random() * 2 + 1;
        this.speedX = (Math.random() - 0.5) * 0.5;
        this.speedY = (Math.random() - 0.5) * 0.5;
        this.w = w;
        this.h = h;
    }

    update(mouse) {
        this.x += this.speedX;
        this.y += this.speedY;

        if (this.x < 0) this.x = this.w;
        if (this.x > this.w) this.x = 0;
        if (this.y < 0) this.y = this.h;
        if (this.y > this.h) this.y = 0;

        // Interaction with mouse
        if (mouse.x) {
            const dx = this.x - mouse.x;
            const dy = this.y - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < mouse.radius) {
                const force = (mouse.radius - dist) / mouse.radius;
                this.x += dx * force * 0.015;
                this.y += dy * force * 0.015;
            }
        }
    }

    draw(ctx, color) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    window.visuals = new Visuals();
});
