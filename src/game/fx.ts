/* Particles, shockwaves, floating text, screen shake */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  grav: number;
  spin: number;
  rot: number;
}

export interface Wave {
  x: number;
  y: number;
  life: number;
  max: number;
  r0: number;
  r1: number;
  color: string;
  width: number;
}

export interface Floater {
  x: number;
  y: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
  vy: number;
}

export class FX {
  particles: Particle[] = [];
  waves: Wave[] = [];
  floaters: Floater[] = [];
  shake = 0;
  shakeX = 0;
  shakeY = 0;
  flash = 0;
  flashColor = '#ffffff';
  private seed = 1;

  private rnd() {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  reset() {
    this.particles.length = 0;
    this.waves.length = 0;
    this.floaters.length = 0;
    this.shake = 0;
    this.flash = 0;
  }

  burst(x: number, y: number, color: string, count = 16, power = 1) {
    if (this.particles.length > 420) return;
    for (let i = 0; i < count; i++) {
      const a = this.rnd() * Math.PI * 2;
      const s = (40 + this.rnd() * 200) * power;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40 * power,
        life: 0,
        max: 0.45 + this.rnd() * 0.5,
        size: 2 + this.rnd() * 4.5,
        color,
        grav: 480,
        spin: (this.rnd() - 0.5) * 14,
        rot: this.rnd() * Math.PI,
      });
    }
  }

  sparks(x: number, y: number, color: string, count = 6) {
    this.burst(x, y, color, count, 0.45);
  }

  wave(x: number, y: number, color: string, r1 = 90, width = 4, dur = 0.5) {
    this.waves.push({ x, y, life: 0, max: dur, r0: 6, r1, color, width });
  }

  float(x: number, y: number, text: string, color: string, size = 26) {
    this.floaters.push({ x, y, life: 0, max: 0.95, text, color, size, vy: -70 });
  }

  addShake(amount: number) {
    this.shake = Math.min(26, this.shake + amount);
  }

  addFlash(amount: number, color = '#ffffff') {
    this.flash = Math.min(0.6, this.flash + amount);
    this.flashColor = color;
  }

  update(dt: number) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) {
        ps.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.vx *= 1 - 1.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life += dt;
      if (w.life >= w.max) this.waves.splice(i, 1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life += dt;
      f.y += f.vy * dt;
      f.vy *= 1 - 1.5 * dt;
      if (f.life >= f.max) this.floaters.splice(i, 1);
    }
    this.shake *= Math.pow(0.0016, dt);
    if (this.shake < 0.05) this.shake = 0;
    const t = performance.now() / 1000;
    this.shakeX = Math.sin(t * 61) * this.shake;
    this.shakeY = Math.cos(t * 47) * this.shake;
    this.flash *= Math.pow(0.002, dt);
    if (this.flash < 0.002) this.flash = 0;
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const w of this.waves) {
      const k = w.life / w.max;
      const r = w.r0 + (w.r1 - w.r0) * (1 - Math.pow(1 - k, 3));
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = w.width * (1 - k) + 0.6;
      ctx.beginPath();
      ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = p.color;
      const s = p.size * (1 - k * 0.55);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const f of this.floaters) {
      const k = f.life / f.max;
      ctx.globalAlpha = Math.min(1, (1 - k) * 1.8);
      const grow = 1 + (1 - Math.min(1, k * 6)) * 0.3;
      ctx.font = `700 ${f.size * grow}px "Space Grotesk", ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(f.text, f.x, f.y);
      ctx.shadowBlur = 0;
      ctx.fillStyle = f.color;
      ctx.globalAlpha *= 0.55;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }
}
