/**
 * visuals.js - Eye-catching UI effects & animations
 */

class Visuals {
    constructor() {
        this.canvas = document.getElementById('particle-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.mouse = { x: null, y: null, radius: 150 };
        this.accentColor = '#f59e0b';

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
        const quantity = Math.floor((this.canvas.width * this.canvas.height) / 15000);
        for (let i = 0; i < quantity; i++) {
            this.particles.push(new Particle(this.canvas.width, this.canvas.height));
        }
    }

    updateAccentColor() {
        this.accentColor = getComputedStyle(document.body).getPropertyValue('--color-accent').trim() || '#f59e0b';
    }

    setupEventListeners() {
        // Watch for theme changes
        const observer = new MutationObserver(() => {
            this.updateAccentColor();
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

        window.addEventListener('resize', () => {
            this.resize();
            this.createParticles();
        });

        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            this.applyTilt(e);
        });

        // Magnetic buttons effect
        document.addEventListener('mousemove', (e) => {
            const magnetics = document.querySelectorAll('.quick-btn, .tab-btn, .primary-btn, .icon-btn');
            magnetics.forEach(btn => {
                const rect = btn.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const distX = e.clientX - centerX;
                const distY = e.clientY - centerY;
                const dist = Math.sqrt(distX * distX + distY * distY);

                if (dist < 50) {
                    const x = distX * 0.25;
                    const y = distY * 0.25;
                    btn.style.transform = `translate(${x}px, ${y}px)`;
                    btn.style.zIndex = '10';
                } else {
                    btn.style.transform = '';
                    btn.style.zIndex = '';
                }
            });
        });
    }

    applyTilt(e) {
        const cards = document.querySelectorAll('.relay-card, .sensor-card, .section-card');
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            if (x > 0 && y > 0 && x < rect.width && y < rect.height) {
                const rotateX = (y - rect.height / 2) / 12;
                const rotateY = -(x - rect.width / 2) / 12;
                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-5px)`;
                card.style.boxShadow = `0 15px 35px -10px var(--color-accent-dim), var(--shadow-lg)`;
            } else {
                card.style.transform = '';
                card.style.boxShadow = '';
            }
        });
    }

    animate() {
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

                if (distance < 120) {
                    this.ctx.strokeStyle = color;
                    this.ctx.globalAlpha = (1 - (distance / 120)) * 0.4;
                    this.ctx.lineWidth = 0.5;
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
                    this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
                    this.ctx.stroke();
                }
            }
        }
        this.ctx.globalAlpha = 1;
    }
}

class Particle {
    constructor(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.size = Math.random() * 2 + 1;
        this.speedX = (Math.random() - 0.5) * 0.6;
        this.speedY = (Math.random() - 0.5) * 0.6;
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
                this.x += dx * force * 0.02;
                this.y += dy * force * 0.02;
            }
        }
    }

    draw(ctx, color) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    window.visuals = new Visuals();
});
