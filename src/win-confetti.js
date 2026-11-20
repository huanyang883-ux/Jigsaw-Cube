const colors = ['#a4bd7b', '#f1c275', '#e8ab90', '#a6c9d2', '#d8ca87'];

// Both boards use the same paper shapes, fall speed and fade in stage coordinates.
export class WinConfetti {
  constructor(host) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'win-confetti';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.paper = new Path2D();
    this.paper.roundRect(-2.5, -4, 5, 8, 2);
    this.star = new Path2D();
    for (let i = 0; i < 8; i++) {
      const radius = i % 2 === 0 ? 5 : 2, angle = (i - 2) * Math.PI / 4;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      if (i === 0) this.star.moveTo(x, y);
      else this.star.lineTo(x, y);
    }
    this.star.closePath();
  }

  resize(width, height, resolution) {
    this.width = width;
    this.height = height;
    const w = Math.max(1, Math.round(width * resolution)), h = Math.max(1, Math.round(height * resolution));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  start() {
    if (!this.ctx || !this.width || this.particles.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (let i = 0; i < 90; i++) {
      this.particles.push({
        path: i % 3 === 0 ? this.star : this.paper, color: colors[i % colors.length],
        x: Math.random() * this.width, y: -12 - Math.random() * 80,
        vx: (Math.random() - .5) * 65, vy: 35 + Math.random() * 80,
        angle: 0, spin: (Math.random() - .5) * 5,
      });
    }
    this.elapsed = 0;
    this.lastFrame = performance.now();
    this.canvas.hidden = false;
    this.frame = requestAnimationFrame(this.draw);
  }

  draw = time => {
    const dt = Math.max(0, Math.min((time - this.lastFrame) / 1000, .05));
    this.lastFrame = time;
    this.elapsed += dt;
    if (this.elapsed >= 4) {
      this.canvas.hidden = true;
      this.particles.length = 0;
      return;
    }
    const { ctx, canvas } = this;
    const sx = canvas.width / this.width, sy = canvas.height / this.height;
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = Math.min(1, (4 - this.elapsed) / 1.4);
    for (const p of this.particles) {
      p.vy += 22 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
      ctx.setTransform(cos * sx, sin * sy, -sin * sx, cos * sy, p.x * sx, p.y * sy);
      ctx.fillStyle = p.color;
      ctx.fill(p.path);
    }
    this.frame = requestAnimationFrame(this.draw);
  };

  destroy() {
    cancelAnimationFrame(this.frame);
    this.particles.length = 0;
    this.canvas.remove();
  }
}
