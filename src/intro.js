// Studio-style title sequence: project images flip through giant letters at an
// accelerating rate while the camera pulls back, then the word slams into a red block.
const WORD = 'MCARKADE';
const RED = '#e3262f';
const BONE = '#ede9e3';

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

export function loadImages(srcs) {
  return Promise.all(srcs.map((src) => new Promise((res) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  }))).then((list) => list.filter(Boolean));
}

export class Intro {
  constructor(root, images, { hit = 4.4, duration = 6.6 } = {}) {
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.octx = this.off.getContext('2d');
    this.images = images;
    this.hit = hit;
    this.duration = duration;
    this.flips = this._flipSchedule();
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  // Flip times accelerate from slow to a blur, the way a title sequence builds.
  _flipSchedule() {
    const times = [];
    let t = 0.15, gap = 0.34;
    while (t < this.hit - 0.05) {
      times.push(t);
      t += gap;
      gap = Math.max(0.042, gap * 0.86);
    }
    return times;
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    for (const c of [this.canvas, this.off]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.w = w; this.h = h; this.dpr = dpr;
    this._layoutType();
  }

  _font(size) {
    return `900 ${size}px 'Archivo Variable', 'Archivo', 'Arial Narrow', sans-serif`;
  }

  _setFont(ctx, size) {
    ctx.font = this._font(size);
    if ('fontStretch' in ctx) ctx.fontStretch = 'extra-condensed';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
  }

  _layoutType() {
    const ctx = this.ctx;
    const base = 200;
    this._setFont(ctx, base);
    const m = ctx.measureText(WORD);
    const target = Math.min(this.w * 0.84, this.h * 1.9);
    this.size = (base * target) / m.width;
    this._setFont(ctx, this.size);
    const mm = ctx.measureText(WORD);
    this.textW = mm.width;
    this.asc = mm.actualBoundingBoxAscent || this.size * 0.72;
    this.desc = mm.actualBoundingBoxDescent || 0;
  }

  _imageAt(t) {
    let n = 0;
    while (n < this.flips.length && this.flips[n] <= t) n++;
    const idx = Math.max(0, n - 1);
    const since = n ? t - this.flips[idx] : 0;
    const gap = (this.flips[idx + 1] ?? this.hit) - (this.flips[idx] ?? 0);
    // slow flips slide like turning pages; fast ones are hard cuts so each frame still reads
    const k = gap > 0.12 ? clamp01(since / (gap * 0.55)) : 1;
    return { cur: this.images[idx % this.images.length], prev: this.images[(idx + this.images.length - 1) % this.images.length], k, n: idx };
  }

  _cover(ctx, img, x, y, w, h, zoom = 1) {
    if (!img) return;
    ctx.filter = 'brightness(1.55) contrast(1.12) saturate(1.15)';
    const r = Math.max(w / img.width, h / img.height) * zoom;
    const iw = img.width * r, ih = img.height * r;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    ctx.filter = 'none';
  }

  _drawFlip(ctx, t, w, h, alpha) {
    const { cur, prev, k, n } = this._imageAt(t);
    ctx.save();
    ctx.globalAlpha = alpha;
    // the previous frame gets pushed off as the next slides over it, like a page turn
    const dir = n % 2 ? 1 : -1;
    const slide = easeInOut(k);
    this._cover(ctx, prev, -slide * w * 0.35 * dir, 0, w, h, 1.12);
    ctx.save();
    ctx.beginPath();
    const edge = (1 - slide) * w;
    if (dir > 0) ctx.rect(edge, 0, w, h); else ctx.rect(0, 0, w - edge, h);
    ctx.clip();
    this._cover(ctx, cur, (1 - slide) * w * 0.12 * dir, 0, w, h, 1.12 + (1 - slide) * 0.1);
    ctx.restore();
    // page edge shadow
    if (slide < 1) {
      const ex = dir > 0 ? edge : w - edge;
      const g = ctx.createLinearGradient(ex - 40, 0, ex + 40, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ex - 40, 0, 80, h);
    }
    ctx.restore();
  }

  // Scene transform: big push-in at the start, pulling back to the full word at the hit.
  _camera(t) {
    const u = clamp01(t / this.hit);
    const pull = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const scale = 5.2 - 4.2 * pull + (t > this.hit ? -0.035 * easeOutExpo(clamp01((t - this.hit) / 1.4)) : 0);
    const rot = (1 - pull) * -0.08;
    const pan = (1 - pull) * this.textW * 0.28;
    return { scale, rot, pan };
  }

  frame(t) {
    const { ctx, octx, w, h, dpr } = this;
    const cx = w / 2, cy = h / 2 + (this.asc - this.desc) / 2;
    const cam = this._camera(t);
    const after = t >= this.hit;
    const shake = after ? Math.max(0, 1 - (t - this.hit) / 0.35) : 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const applyCam = (c) => {
      c.translate(w / 2 + (Math.random() - 0.5) * 14 * shake, h / 2 + (Math.random() - 0.5) * 10 * shake);
      c.rotate(cam.rot);
      c.scale(cam.scale, cam.scale);
      c.translate(-w / 2 + cam.pan, -h / 2);
    };

    if (!after) {
      // Full-frame flipping, dimmed, fading out as the word resolves
      const bgA = 0.55 * (1 - clamp01((t - 2.2) / 1.6));
      if (bgA > 0.01) {
        ctx.save();
        this._drawFlip(ctx, t, w, h, bgA);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      // Images inside the letters
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      octx.clearRect(0, 0, w, h);
      this._drawFlip(octx, t, w, h, 1);
      octx.globalCompositeOperation = 'destination-in';
      octx.save();
      applyCam(octx);
      this._setFont(octx, this.size);
      octx.fillStyle = '#fff';
      octx.fillText(WORD, cx, cy);
      octx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.off, 0, 0);
      // thin bright edges around the letters
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      applyCam(ctx);
      this._setFont(ctx, this.size);
      ctx.lineWidth = 1.2 / cam.scale;
      ctx.strokeStyle = `rgba(237,233,227,${0.25 + 0.4 * clamp01(t / this.hit)})`;
      ctx.strokeText(WORD, cx, cy);
      ctx.restore();
    } else {
      // The logo: a red block with bone-white letters, a light sweep, then a slow settle
      const a = t - this.hit;
      ctx.save();
      applyCam(ctx);
      const padX = this.size * 0.09, padY = this.size * 0.1;
      const bx = cx - this.textW / 2 - padX, by = cy - this.asc - padY;
      const bw = this.textW + padX * 2, bh = this.asc + this.desc + padY * 2;
      ctx.fillStyle = RED;
      ctx.fillRect(bx, by, bw, bh);
      this._setFont(ctx, this.size);
      ctx.fillStyle = BONE;
      ctx.fillText(WORD, cx, cy);
      // light sweep across the face
      const sweep = clamp01((a - 0.12) / 1.1);
      if (sweep > 0 && sweep < 1) {
        const sx = bx - bw * 0.4 + sweep * bw * 1.8;
        const g = ctx.createLinearGradient(sx - bw * 0.18, by, sx + bw * 0.18, by + bh);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = g;
        ctx.fillRect(bx, by, bw, bh);
      }
      ctx.restore();
      // white flash on impact
      const flash = Math.max(0, 1 - a / 0.22);
      if (flash > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.55})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  play(clock) {
    // clock() returns seconds since the intro started (audio clock when sound is on)
    this.root.classList.add('is-on');
    return new Promise((resolve) => {
      const tick = () => {
        const t = clock();
        if (this._skip || t >= this.duration) {
          this.stop();
          resolve();
          return;
        }
        this.frame(t);
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    });
  }

  skip() { this._skip = true; }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._resize);
  }
}
