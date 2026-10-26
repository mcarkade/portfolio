// DOM-side behaviour: text reveals, cursor, magnetic buttons, the lock-on game, previews.
export const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function splitWords(root = document) {
  root.querySelectorAll('.split').forEach((el) => {
    if (el.dataset.split) return;
    el.dataset.split = '1';
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', el.textContent.trim());
    const nodes = [];
    words.forEach((w, i) => {
      const outer = document.createElement('span');
      outer.className = 'w';
      outer.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('span');
      inner.style.setProperty('--i', i);
      inner.textContent = w;
      outer.appendChild(inner);
      if (i) nodes.push(document.createTextNode(' '));
      nodes.push(outer);
    });
    el.replaceChildren(...nodes);
  });
}

export function observeReveals() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
  document.querySelectorAll('.split, .reveal').forEach((el) => io.observe(el));
}

export class Cursor {
  constructor(audio) {
    this.el = document.getElementById('cursor');
    this.label = this.el.querySelector('.cursor__label');
    this.ring = this.el.querySelector('.cursor__ring');
    this.dot = this.el.querySelector('.cursor__dot');
    this.x = innerWidth / 2; this.y = innerHeight / 2;
    this.rx = this.x; this.ry = this.y;
    this.audio = audio;
    if (!finePointer) return;
    addEventListener('pointermove', (e) => { this.x = e.clientX; this.y = e.clientY; this.el.classList.remove('is-hidden'); }, { passive: true });
    document.addEventListener('pointerleave', () => this.el.classList.add('is-hidden'));
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest('a, button, summary, [data-cursor]');
      this.el.classList.toggle('is-hover', !!t);
      this.label.textContent = t?.dataset.cursor || '';
      if (t && t !== this._last) audio?.play('tick', 0.5);
      this._last = t;
    });
  }

  // Hide the system cursor only once the replacement is actually being drawn.
  enable() {
    if (!finePointer || this.enabled) return;
    this.enabled = true;
    document.body.style.cursor = 'none';
    const style = document.createElement('style');
    style.textContent = 'a, button, summary { cursor: none; }';
    document.head.appendChild(style);
  }

  update(dt) {
    if (!finePointer) return;
    const k = 1 - Math.exp(-dt * 18);
    this.rx += (this.x - this.rx) * k;
    this.ry += (this.y - this.ry) * k;
    this.dot.style.transform = `translate(${this.x}px, ${this.y}px) translate(-50%, -50%)`;
    this.ring.style.transform = `translate(${this.rx}px, ${this.ry}px) translate(-50%, -50%)`;
    this.label.style.transform = `translate(${this.rx}px, ${this.ry}px)`;
  }
}

export function magnetic() {
  if (!finePointer || reducedMotion) return;
  document.querySelectorAll('.magnetic').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.28;
      const y = (e.clientY - r.top - r.height / 2) * 0.35;
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transition = 'transform .7s cubic-bezier(.22,1,.36,1), color .5s, border-color .5s';
      el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; }, 700);
    });
  });
}

// Hover a project name and its picture follows the cursor.
export class Preview {
  constructor() {
    if (!finePointer) return;
    this.el = document.createElement('div');
    this.el.className = 'preview';
    this.el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.el);
    this.cache = new Map();
    this.x = 0; this.y = 0; this.px = 0; this.py = 0;
    addEventListener('pointermove', (e) => { this.x = e.clientX; this.y = e.clientY; }, { passive: true });
    document.querySelectorAll('.work__item').forEach((li) => {
      li.addEventListener('pointerenter', () => { this.el.classList.toggle('is-invert', li.hasAttribute('data-invert')); this.show(li.dataset.preview); });
      li.addEventListener('pointerleave', () => this.el.classList.remove('is-on'));
    });
  }

  show(src) {
    if (!src) return;
    let img = this.cache.get(src);
    if (!img) {
      img = new Image();
      img.src = src;
      img.alt = '';
      this.cache.set(src, img);
    }
    this.el.replaceChildren(img);
    this.el.classList.add('is-on');
  }

  update(dt) {
    if (!this.el) return;
    const k = 1 - Math.exp(-dt * 9);
    const vx = this.x - this.px;
    this.px += (this.x - this.px) * k;
    this.py += (this.y - this.py) * k;
    const rot = Math.max(-8, Math.min(8, vx * 0.05));
    // sit right of the cursor, flipping left near the edge, and stay inside the viewport vertically
    const w = this.w || (this.w = this.el.offsetWidth), h = this.h || (this.h = this.el.offsetHeight);
    const x = this.px + 24 + w > innerWidth - 8 ? this.px - 24 - w : this.px + 24;
    const y = Math.max(8, Math.min(innerHeight - h - 8, this.py - 140));
    this.el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${this.el.classList.contains('is-on') ? 1 : 0.85})`;
  }
}

// The counter-drone turret, played with your cursor as the drone.
export class LockGame {
  constructor(audio) {
    this.section = document.getElementById('lock');
    this.reticle = document.getElementById('reticle');
    this.stateEl = document.getElementById('lock-state');
    this.timeEl = document.getElementById('lock-time');
    this.audio = audio;
    this.x = innerWidth / 2; this.y = innerHeight / 2;
    this.vx = 0; this.vy = 0;
    this.tx = this.x; this.ty = this.y;
    this.active = false;
    this.lockedFor = 0;
    this.freeFor = 0;
    this.locked = false;
    addEventListener('pointermove', (e) => { this.tx = e.clientX; this.ty = e.clientY; }, { passive: true });
    new IntersectionObserver(([e]) => {
      this.active = e.isIntersecting;
    }, { threshold: 0.35 }).observe(this.section);
  }

  setTarget(x, y) { this.tx = x; this.ty = y; }

  update(dt) {
    const on = this.active;
    this.reticle.classList.toggle('is-on', on);
    if (!on) return;
    // PD controller with a little lag, like a real pan-tilt servo loop
    const kp = 26, kd = 7.5;
    const ax = kp * (this.tx - this.x) - kd * this.vx;
    const ay = kp * (this.ty - this.y) - kd * this.vy;
    this.vx += ax * dt; this.vy += ay * dt;
    const maxV = 1500;
    this.vx = Math.max(-maxV, Math.min(maxV, this.vx));
    this.vy = Math.max(-maxV, Math.min(maxV, this.vy));
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.reticle.style.transform = `translate(${this.x}px, ${this.y}px)`;
    const err = Math.hypot(this.tx - this.x, this.ty - this.y);
    if (err < 26) { this.lockedFor += dt; this.freeFor = 0; } else { this.freeFor += dt; this.lockedFor = Math.max(0, this.lockedFor - dt * 2); }
    const nowLocked = this.lockedFor > 0.35;
    if (nowLocked && !this.locked) this.audio?.play('lock', 0.7);
    this.locked = nowLocked;
    this.reticle.classList.toggle('is-locked', nowLocked);
    this.stateEl.classList.toggle('is-locked', nowLocked);
    this.stateEl.textContent = nowLocked ? 'LOCKED' : err < 120 ? 'TRACKING' : 'SEARCHING';
    this.timeEl.textContent = nowLocked ? `held ${this.lockedFor.toFixed(1)} s` : `escaped ${this.freeFor.toFixed(1)} s`;
  }
}

export function copyEmail() {
  const btn = document.getElementById('copy-email');
  const toast = document.querySelector('.toast');
  btn.addEventListener('click', async () => {
    const email = btn.dataset.email;
    try {
      await navigator.clipboard.writeText(email);
      toast.textContent = `Copied ${email}`;
    } catch {
      location.href = `mailto:${email}`;
      toast.textContent = email;
    }
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { toast.textContent = ''; }, 3200);
  });
}

export function clock() {
  const el = document.getElementById('readout-clock');
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const tick = () => { el.textContent = `HYD ${fmt.format(new Date())}`; };
  tick();
  setInterval(tick, 15000);
}
