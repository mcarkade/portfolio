// DOM-side behaviour: text reveals, cursor, magnetic buttons, the lock-on game.
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
    this.vx = 0; this.vy = 0;
    this.morph = 0;
    this.width = 28; this.height = 28;
    this.angle = 0;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.el.classList.add('is-hidden');
    this.audio = audio;
    if (!finePointer) return;
    const hide = () => { this.el.classList.add('is-hidden'); this.el.classList.remove('is-pressed', 'is-hover', 'is-label'); this.target = this._last = null; this.vx = this.vy = 0; this.seen = false; };
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') { hide(); return; }
      this.x = e.clientX; this.y = e.clientY;
      this.dot.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) translate(-50%, -50%)`;
      hover(e.target);
      if (!this.seen) { this.rx = this.x; this.ry = this.y; this.morph = 0; this.width = this.height = 28; this.seen = true; }
      this.el.classList.remove('is-hidden');
    }, { passive: true });
    document.addEventListener('pointerleave', hide);
    addEventListener('blur', hide);
    document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
    addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') this.el.classList.add('is-pressed'); });
    addEventListener('pointerup', () => this.el.classList.remove('is-pressed'));
    addEventListener('pointercancel', hide);
    const hover = (node) => {
      const candidate = node instanceof Element ? node.closest('a, button, summary, [data-cursor]') : null;
      const t = candidate?.matches(':disabled, [aria-disabled="true"]') ? null : candidate;
      this.target = t;
      if (t === this._last) return;
      this.el.classList.toggle('is-hover', !!t);
      this.label.textContent = t?.dataset.cursor?.trim().split(/\s+/)[0] || '';
      this.labelWidth = this.label.textContent ? this.label.offsetWidth : 0;
      this.el.classList.toggle('is-label', !!this.label.textContent);
      if (t && t !== this._last) audio?.play('tick', 0.5);
      this._last = t;
    };
    document.addEventListener('pointerover', (e) => hover(e.target));
    document.addEventListener('pointerout', (e) => hover(e.relatedTarget));
    addEventListener('scroll', () => { if (this.seen) hover(document.elementFromPoint(this.x, this.y)); }, { passive: true });
  }

  // Hide the system cursor only once the replacement is actually being drawn.
  enable() {
    if (!finePointer || this.enabled) return;
    this.enabled = true;
    const style = document.createElement('style');
    style.textContent = '@media (hover: hover) and (pointer: fine) { body, a, button, summary, [data-cursor] { cursor: none; } }';
    document.head.appendChild(style);
  }

  update(dt) {
    if (!finePointer || !this.seen) return;
    dt = Math.max(1 / 240, Math.min(dt, 0.05));
    const reduce = this.motion.matches;
    const k = reduce ? 1 : 1 - Math.exp(-dt * 24);
    let tx = this.x, ty = this.y;
    const box = this.target?.isConnected && !this.target.closest('[inert], [hidden]') ? this.target.getBoundingClientRect() : null;
    const locked = box && box.width > 0 && box.height > 0;
    if (locked) {
      tx = box.left + box.width / 2;
      ty = box.top + box.height / 2;
    }
    if (reduce) {
      this.rx = tx; this.ry = ty; this.vx = this.vy = 0;
    } else {
      // Substeps keep the underdamped spring stable on slow frames.
      const steps = Math.ceil(dt * 240), h = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.vx += (420 * (tx - this.rx) - 27 * this.vx) * h;
        this.vy += (420 * (ty - this.ry) - 27 * this.vy) * h;
        this.rx += this.vx * h; this.ry += this.vy * h;
      }
    }
    this.morph += ((locked ? 1 : 0) - this.morph) * k;
    this.width += ((locked ? box.width + 10 : 28) - this.width) * k;
    this.height += ((locked ? box.height + 10 : 28) - this.height) * k;
    const stretch = reduce ? 0 : Math.min(.65, Math.hypot(this.vx, this.vy) / 2200) * (1 - this.morph);
    const a = locked || reduce ? 0 : Math.hypot(this.vx, this.vy) > 8 ? Math.atan2(this.vy, this.vx) : this.angle;
    this.angle += Math.atan2(Math.sin(a - this.angle), Math.cos(a - this.angle)) * k;
    const pressed = this.el.classList.contains('is-pressed') ? 0.86 : 1;
    this.ring.style.width = `${this.width}px`;
    this.ring.style.height = `${this.height}px`;
    this.ring.style.setProperty('--corner', `${14 - this.morph * 6}px`);
    this.ring.style.setProperty('--radius', `${14 * (1 - this.morph)}px`);
    this.dot.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) translate(-50%, -50%) scale(${pressed})`;
    this.ring.style.transform = `translate3d(${this.rx}px, ${this.ry}px, 0) translate(-50%, -50%) rotate(${this.angle * (1 - this.morph)}rad) scale(${(1 + stretch) * (locked ? 1 : pressed)}, ${(locked ? 1 : pressed) / (1 + stretch * .45)})`;
    const halfLabel = (this.labelWidth || 0) / 2;
    const lx = Math.max(halfLabel + 8, Math.min(innerWidth - halfLabel - 8, this.rx));
    const below = this.ry + this.height / 2 + 16;
    const ly = Math.max(12, Math.min(innerHeight - 12, below > innerHeight - 20 ? this.ry - this.height / 2 - 16 : below));
    this.label.style.transform = `translate3d(${lx}px, ${ly}px, 0) translate(-50%, -50%)`;
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

// The counter-drone turret, played with your cursor as the drone.
export class LockGame {
  constructor(audio) {
    this.section = document.getElementById('lock');
    this.reticle = document.getElementById('reticle');
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

  update(dt, enabled = true) {
    dt = Math.max(0, Math.min(dt, .05));
    const on = enabled && this.active && !document.body.matches('.is-loading, .is-intro, .viewer-open') && !document.querySelector('.nav.is-open');
    this.reticle.classList.toggle('is-on', on);
    if (!on) {
      this.lockedFor = this.freeFor = 0;
      this.locked = false;
      this.vx = this.vy = 0;
      this.reticle.classList.remove('is-locked');
      this.timeEl.classList.remove('is-locked');
      if (this.timeEl.textContent !== 'Escaped') this.timeEl.textContent = 'Escaped';
      return;
    }
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
    const status = nowLocked ? 'Locked' : 'Escaped';
    if (this.timeEl.textContent !== status) this.timeEl.textContent = status;
    this.timeEl.classList.toggle('is-locked', nowLocked);
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
