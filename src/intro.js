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
const SWEEP_AT = 0.14, SWEEP_LEN = 1.0;
const SETTLE = 1.4;
const DOCK_AT = 1.55, DOCK_LEN = 0.8;

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
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
    // the sequence always runs through the dock, however short the audio is
    this.end = Math.max(duration, hit + DOCK_AT + DOCK_LEN);
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
    const scale = 5.2 - 4.2 * pull;
    const rot = (1 - pull) * -0.08;
    const pan = (1 - pull) * this.size * this.wEm * 0.28;
    return { scale, rot, pan };
  }

  // A raking glint: a soft shoulder and a thin hot core, added to the light already in the block.
  _sweep(ctx, r, p) {
    const dx = 0.92, dy = 0.39; // gradient direction, so the band leans like a "/"
    const reach = r.w + r.h * 0.5;
    const pos = r.x - r.h * 0.25 + reach * easeInOutSine(p);
    const my = r.y + r.h / 2;
    const band = (half, stops) => {
      const g = ctx.createLinearGradient(pos - dx * half, my - dy * half, pos + dx * half, my + dy * half);
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    // three nested bands (shoulder, body, core) with smooth falloff, so the glint has depth instead of one hard line
    const layers = [
      [0.17, 0.2, '255,120,100'],
      [0.05, 0.3, '255,170,150'],
      [0.012, 0.5, '255,244,238'],
    ];
    for (const [half, peak, rgb] of layers) {
      ctx.fillStyle = band(r.w * half, [
        [0, `rgba(${rgb},0)`], [0.25, `rgba(${rgb},${peak * 0.18})`], [0.4, `rgba(${rgb},${peak * 0.6})`],
        [0.5, `rgba(${rgb},${peak})`], [0.6, `rgba(${rgb},${peak * 0.6})`], [0.75, `rgba(${rgb},${peak * 0.18})`], [1, `rgba(${rgb},0)`],
      ]);
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
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
      return;
    }

    // The logo: a red block with bone-white letters, a glint, a slow settle, then it docks into the nav mark.
    const a = t - this.hit;
    if (!this._hit) { this._hit = true; this.root.classList.add('is-hit'); }
    const shake = Math.max(0, 1 - a / 0.35);
    const settled = a >= SETTLE;
    let S = this.size * (1 - 0.035 * easeOutExpo(clamp01(a / SETTLE)));
    let cx = w / 2 + (Math.random() - 0.5) * 14 * shake;
    let cy = h / 2 + (Math.random() - 0.5) * 10 * shake;
    const du = clamp01((a - DOCK_AT) / DOCK_LEN);
    if (du > 0) {
      this.dock ||= this._measureDock();
      if (this.dock) {
        const e = easeInOutQuart(du);
        S = this.size * 0.965 * Math.pow(this.dock.S / (this.size * 0.965), e);
        cx = lerp(w / 2, this.dock.cx, e);
        cy = lerp(h / 2, this.dock.cy, e);
      }
    }
    // at rest and on arrival the box sits on whole device pixels, like the DOM mark it hands over to
    const L = this._lockup(S, cx, cy, settled && (du === 0 || du === 1));
    ctx.fillStyle = RED;
    ctx.fillRect(L.x, L.y, L.w, L.h);
    this._setFont(ctx, S);
    ctx.fillStyle = BONE;
    ctx.fillText(WORD, L.tx, L.base);
    const sweep = (a - SWEEP_AT) / SWEEP_LEN;
    if (sweep > 0 && sweep < 1) this._sweep(ctx, L, sweep);
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

// Loader progress for CSS. main.js writes the percentage into #load-num; mirror it to --loader-p
// (fills the wordmark), the counter and the progressbar, and reveal the loader once its fonts are in.
const loadNum = document.getElementById('load-num');
const loader = document.getElementById('loader');
if (loadNum && loader) {
  const count = loader.querySelector('.loader__count');
  const bar = loader.querySelector('[role="progressbar"]');
  const sync = () => {
    const n = Math.min(100, parseInt(loadNum.textContent, 10) || 0);
    loader.style.setProperty('--loader-p', n / 100);
    if (count) count.dataset.n = n;
    if (bar) bar.setAttribute('aria-valuenow', n);
  };
  new MutationObserver(sync).observe(loadNum, { childList: true, characterData: true, subtree: true });
  sync();
  const show = () => loader.classList.add('is-set');
  const fonts = document.fonts?.load("900 1em 'Archivo Variable'", 'MCARKADE Abhinav Pullela Enter');
  if (fonts) Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).then(show, show);
  else show();
}
