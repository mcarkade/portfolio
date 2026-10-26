// Studio-style title sequence: project images flip through giant letters at an
// accelerating rate while the camera pulls back, then the word slams into a red block.
// The block keeps the proportions of the nav mark and docks into it, so the hand-off
// to the site is the same pixels, not a cross-fade.
const WORD = 'MCARKADE';
const RED = '#e3262f';
const BONE = '#ede9e3';

// Same box as `.mark span`: padding .18em .28em .14em, line-height 1, letter-spacing -.005em.
const PAD_X = 0.28, PAD_TOP = 0.18, PAD_BOTTOM = 0.14, SPACING = -0.005;

// Seconds after the hit.
const SWEEP_AT = 0.12, SWEEP_LEN = 1.15;
const SETTLE = 1.4;
const DOCK_AT = 1.55, DOCK_LEN = 0.8;
const IMAGE_HOLD = 0.25, FACE_FADE = 0.28, PUSH_IN = 1.04;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, k) => a + (b - a) * k;

// Each image gets its own deadline, so one slow file never holds up the title sequence.
export function loadImages(srcs, timeout = 8000) {
  return Promise.all(srcs.map((src) => new Promise((res) => {
    const img = new Image();
    img.decoding = 'async';
    const t = setTimeout(() => res(null), timeout);
    img.onload = () => { clearTimeout(t); res(img); };
    img.onerror = () => { clearTimeout(t); res(null); };
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
    const grain = document.createElement('canvas');
    grain.width = grain.height = 128;
    const gctx = grain.getContext('2d');
    const noise = gctx.createImageData(128, 128);
    for (let i = 0; i < noise.data.length; i += 4) {
      const value = Math.floor(Math.random() * 256);
      noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = value;
      noise.data[i + 3] = 255;
    }
    gctx.putImageData(noise, 0, 0);
    this.grain = this.ctx.createPattern(grain, 'repeat');
    // the sequence always runs through the dock, however short the audio is
    this.end = Math.max(duration, hit + DOCK_AT + DOCK_LEN);
    this.flips = this._flipSchedule();
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  // Keep the opening cue ticks, then cap the acceleration so later images can still read.
  _flipSchedule() {
    const times = [];
    let t = 0.15, gap = 0.34;
    while (t < this.hit + IMAGE_HOLD) {
      times.push(t);
      t += gap;
      gap = Math.max(0.08, gap * 0.86);
    }
    return times;
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // phones get up to 3x so the final lockup is as sharp as the screen allows
    const dpr = Math.min(window.devicePixelRatio || 1, w * h < 600000 ? 3 : 2);
    for (const c of [this.canvas, this.off]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.w = w; this.h = h; this.dpr = dpr;
    this.dock = null;
    this._layoutType();
  }

  _font(size) {
    return `900 ${size}px 'Archivo Variable', 'Archivo', 'Arial Narrow', sans-serif`;
  }

  _setFont(ctx, size) {
    ctx.font = this._font(size);
    if ('fontStretch' in ctx) ctx.fontStretch = 'extra-condensed';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${SPACING * size}px`;
    if ('textRendering' in ctx) ctx.textRendering = 'geometricPrecision';
    ctx.imageSmoothingQuality = 'high';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Word width and font metrics per em, so the lockup box can be built at any size.
  _layoutType() {
    const ctx = this.ctx;
    const base = 200;
    this._setFont(ctx, base);
    const m = ctx.measureText(WORD);
    this.wEm = m.width / base;
    this.fa = (m.fontBoundingBoxAscent || base * 0.878) / base;
    this.fd = (m.fontBoundingBoxDescent || base * 0.21) / base;
    const boxEm = this.wEm + PAD_X * 2;
    this.size = Math.min(this.w * 0.84, this.h * 2.1) / boxEm;
    this._setFont(ctx, this.size);
  }

  // The red block and the word's origin for a lockup of font size S centred on (cx, cy).
  _lockup(S, cx, cy, snap) {
    const q = snap ? (v) => Math.round(v * this.dpr) / this.dpr : (v) => v;
    const w = (this.wEm + PAD_X * 2) * S, h = (1 + PAD_TOP + PAD_BOTTOM) * S;
    const x = q(cx - w / 2), y = q(cy - h / 2);
    const base = q(y + (PAD_TOP + (1 - this.fa - this.fd) / 2 + this.fa) * S);
    return { x, y, w: q(cx + w / 2) - x, h: q(cy + h / 2) - y, tx: x + PAD_X * S, base, S };
  }

  // Where the nav mark sits, so the lockup can land exactly on it.
  _measureDock() {
    const el = document.querySelector('.mark span');
    const r = el && el.getBoundingClientRect();
    if (!r || !r.width) return null;
    return { S: r.width / (this.wEm + PAD_X * 2), cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  _imageAt(t) {
    let n = 0;
    while (n < this.flips.length && this.flips[n] <= t) n++;
    const idx = Math.max(0, n - 1);
    const since = n ? t - this.flips[idx] : 0;
    const gap = (this.flips[idx + 1] ?? this.hit + IMAGE_HOLD) - (this.flips[idx] ?? 0);
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
    const pull = easeInOutSine(u);
    const scale = 5.2 - 4.2 * pull;
    const rot = (1 - pull) * -0.08;
    const pan = (1 - pull) * this.size * this.wEm * 0.28;
    return { scale, rot, pan };
  }

  _grain(ctx, t, amount) {
    if (!this.grain || amount <= 0) return;
    const frame = Math.floor(t * 24);
    const x = (frame * 37) % 128, y = (frame * 53) % 128;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(-x, -y);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = amount;
    ctx.fillStyle = this.grain;
    ctx.fillRect(x, y, this.w, this.h);
    ctx.restore();
  }

  // The finished logo, lit like a physical badge: a block with a soft bloom and a lit top edge,
  // letters with depth and a bevelled rim, and a specular glint that travels through the letters.
  // p: glint progress (0..1, outside = no glint), glow: bloom strength.
  _logo(ctx, L, p, glow, t = this.hit + IMAGE_HOLD + FACE_FADE) {
    const { octx, w, h, dpr } = this;
    const S = L.S;
    ctx.save();
    // bloom: the red light spilling around the block
    if (glow > 0.01) {
      ctx.shadowColor = `rgba(227,38,47,${0.55 * glow})`;
      ctx.shadowBlur = L.h * 0.9;
      ctx.fillStyle = RED;
      ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.shadowBlur = 0;
    }
    // block: lit from above, falling off toward the bottom corners
    const g = ctx.createLinearGradient(0, L.y, 0, L.y + L.h);
    g.addColorStop(0, '#f2343c'); g.addColorStop(0.45, RED); g.addColorStop(1, '#a8171f');
    ctx.fillStyle = g;
    ctx.fillRect(L.x, L.y, L.w, L.h);
    const v = ctx.createRadialGradient(L.x + L.w * 0.5, L.y + L.h * 0.35, L.h * 0.2, L.x + L.w * 0.5, L.y + L.h * 0.5, L.w * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(40,0,4,0.38)');
    ctx.fillStyle = v;
    ctx.fillRect(L.x, L.y, L.w, L.h);
    // a hairline of light along the top edge, a shade along the bottom
    const e = Math.max(1 / dpr, S * 0.006);
    ctx.fillStyle = 'rgba(255,190,180,0.55)';
    ctx.fillRect(L.x, L.y, L.w, e);
    ctx.fillStyle = 'rgba(60,0,6,0.5)';
    ctx.fillRect(L.x, L.y + L.h - e, L.w, e);

    // letter depth: stacked dark copies below the face
    this._setFont(ctx, S);
    const depth = S * 0.022;
    for (let i = 4; i >= 1; i--) {
      ctx.fillStyle = `rgba(${70 + i * 6},${4 + i},${10 + i},${0.55 + i * 0.08})`;
      ctx.fillText(WORD, L.tx + depth * 0.35 * (i / 4), L.base + depth * (i / 4));
    }
    // face: warm bone, brighter toward the top
    const fg = ctx.createLinearGradient(0, L.base - S * this.fa * 0.8, 0, L.base);
    fg.addColorStop(0, '#fffaf2'); fg.addColorStop(0.55, BONE); fg.addColorStop(1, '#d6cfc4');
    ctx.fillStyle = fg;
    ctx.fillText(WORD, L.tx, L.base);
    ctx.restore();

    // bevel rim and glint, built in the offscreen buffer so they stay inside the letters
    const mask = (fill) => {
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      octx.clearRect(0, 0, w, h);
      fill(octx);
      this._setFont(octx, S);
      octx.globalCompositeOperation = 'destination-in';
      octx.fillStyle = '#fff';
      octx.fillText(WORD, L.tx, L.base);
    };
    const imageAlpha = 1 - easeInOutSine(clamp01((t - this.hit - IMAGE_HOLD) / FACE_FADE));
    if (imageAlpha > 0 && this.images.length) {
      mask((c) => this._drawFlip(c, Math.min(t, this.hit + IMAGE_HOLD), w, h, 1));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = imageAlpha;
      ctx.drawImage(this.off, 0, 0);
      ctx.restore();
    }
    // top rim: the face minus itself shifted down leaves a thin lit edge
    mask((c) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); });
    octx.globalCompositeOperation = 'destination-out';
    octx.fillText(WORD, L.tx, L.base + Math.max(1 / dpr, S * 0.012));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.off, 0, 0);
    ctx.restore();

    if (p > 0 && p < 1) {
      // the glint: a broad sheen with a hot core, leaning like a "/", only on the letters
      const reach = L.w + L.h;
      const pos = L.x - L.h * 0.5 + reach * easeInOutSine(p);
      const dx = 0.92, dy = 0.39, my = L.y + L.h / 2;
      const band = (c, half, stops) => {
        const gr = c.createLinearGradient(pos - dx * half, my - dy * half, pos + dx * half, my + dy * half);
        for (const [o, col] of stops) gr.addColorStop(o, col);
        return gr;
      };
      mask((c) => {
        c.fillStyle = band(c, L.w * 0.16, [
          [0, 'rgba(255,230,200,0)'], [0.3, 'rgba(255,232,206,0.22)'], [0.46, 'rgba(255,240,222,0.6)'],
          [0.5, 'rgba(255,255,255,1)'], [0.54, 'rgba(255,240,222,0.6)'], [0.7, 'rgba(255,232,206,0.22)'], [1, 'rgba(255,230,200,0)'],
        ]);
        c.fillRect(0, 0, w, h);
      });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.off, 0, 0);
      ctx.restore();
      // the block itself only catches a faint, wide sheen
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.x, L.y, L.w, L.h);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = band(ctx, L.w * 0.3, [[0, 'rgba(255,120,110,0)'], [0.5, 'rgba(255,120,110,0.16)'], [1, 'rgba(255,120,110,0)']]);
      ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.restore();

      // A thin horizontal flare follows the glint at the letters' optical centre.
      const fy = L.base - S * this.fa * 0.38;
      const fx = pos - (fy - my) * dy / dx;
      const strength = Math.pow(Math.sin(Math.PI * p), 2);
      ctx.save();
      ctx.translate(fx, fy);
      ctx.scale(L.w * 0.4, Math.max(1.5 / dpr, S * 0.024));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = strength * 0.7;
      const flare = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      flare.addColorStop(0, 'rgba(255,250,235,0.95)');
      flare.addColorStop(0.08, 'rgba(255,230,205,0.65)');
      flare.addColorStop(0.35, 'rgba(255,140,110,0.2)');
      flare.addColorStop(1, 'rgba(255,100,90,0)');
      ctx.fillStyle = flare;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
  }

  frame(t) {
    const { ctx, octx, w, h, dpr } = this;
    const after = t >= this.hit;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    if (!after) {
      const cam = this._camera(t);
      const L = this._lockup(this.size, w / 2, h / 2, false);
      const applyCam = (c) => {
        c.translate(w / 2, h / 2);
        c.rotate(cam.rot);
        c.scale(cam.scale, cam.scale);
        c.translate(-w / 2 + cam.pan, -h / 2);
      };
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
      // the frames bleed red as the hit approaches
      const tint = clamp01((t - (this.hit - 1.3)) / 1.2);
      if (tint > 0) {
        octx.globalCompositeOperation = 'multiply';
        octx.fillStyle = `rgba(227,38,47,${tint * 0.9})`;
        octx.fillRect(0, 0, w, h);
        octx.globalCompositeOperation = 'source-over';
        octx.fillStyle = `rgba(227,38,47,${tint * 0.25})`;
        octx.fillRect(0, 0, w, h);
      }
      octx.globalCompositeOperation = 'destination-in';
      octx.save();
      applyCam(octx);
      this._setFont(octx, this.size);
      octx.fillStyle = '#fff';
      octx.fillText(WORD, L.tx, L.base);
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
      ctx.strokeText(WORD, L.tx, L.base);
      ctx.restore();
      this._grain(ctx, t, 0.024);
      return;
    }

    // Images resolve to bone as the logo pushes in, then docks into the nav mark.
    const a = t - this.hit;
    if (!this._hit) { this._hit = true; this.root.classList.add('is-hit'); }
    const shake = Math.max(0, 1 - a / 0.35);
    const settled = a >= SETTLE;
    let S = this.size * lerp(1, PUSH_IN, easeInOutSine(clamp01(a / SETTLE)));
    let cx = w / 2 + (Math.random() - 0.5) * 14 * shake;
    let cy = h / 2 + (Math.random() - 0.5) * 10 * shake;
    // Compare absolute times so subtraction roundoff cannot miss the flat final frame.
    const du = t >= this.hit + DOCK_AT + DOCK_LEN ? 1 : clamp01((a - DOCK_AT) / DOCK_LEN);
    if (du > 0) {
      this.dock ||= this._measureDock();
      if (this.dock) {
        const e = easeInOutSine(du);
        S = this.size * PUSH_IN * Math.pow(this.dock.S / (this.size * PUSH_IN), e);
        cx = lerp(w / 2, this.dock.cx, e);
        cy = lerp(h / 2, this.dock.cy, e);
      }
    }
    // at rest and on arrival the box sits on whole device pixels, like the DOM mark it hands over to
    const L = this._lockup(S, cx, cy, settled && (du === 0 || du === 1));
    // the bloom swells on impact, then fades as the logo flies to the nav
    const glow = (0.55 + 0.45 * Math.max(0, 1 - a / 0.6)) * (1 - easeInOutSine(du));
    if (du < 1) this._logo(ctx, L, (a - SWEEP_AT) / SWEEP_LEN, glow, t);
    else {
      // docked: exactly the flat DOM mark it hands over to
      ctx.fillStyle = RED;
      ctx.fillRect(L.x, L.y, L.w, L.h);
      this._setFont(ctx, S);
      ctx.fillStyle = BONE;
      ctx.fillText(WORD, L.tx, L.base);
    }
    this._grain(ctx, t, 0.024 * (1 - easeInOutSine(du)));
    // white flash on impact
    const flash = Math.max(0, 1 - a / 0.22);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.55})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  play(clock) {
    // clock() returns seconds since the intro started (audio clock when sound is on)
    this.root.classList.add('is-on');
    return new Promise((resolve) => {
      const tick = () => {
        const t = clock();
        if (this._skip) {
          this.stop();
          resolve();
          return;
        }
        if (t >= this.end) {
          this.frame(this.end);
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
