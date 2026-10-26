// The score leads; vehicle textures and interface sounds sit behind it.
export class Audio {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.buffers = {};
    this.lastPlayed = {};
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -5;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.85;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.4;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4500;
    lp.Q.value = 0.5;
    this.sfx.connect(lp).connect(this.master);
    this._synths();
    // Keep attribution discoverable in the site's existing credits list.
    const credits = document.querySelector('.footer .credits');
    if (credits && !credits.querySelector('[data-audio-credit]')) {
      const item = document.createElement('li');
      item.dataset.audioCredit = '';
      item.append('Music: ');
      const link = document.createElement('a');
      link.href = '/audio/CREDITS.md';
      link.textContent = 'Save Us Now by Shane Ivers and Cylinder Seven by Chris Zabriskie, CC BY 4.0. Edited for this site.';
      item.append(link);
      credits.append(item);
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else if (this.enabled) this.ctx.resume().catch(() => {});
    });
  }

  async load(name, url) {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(res.status);
      this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) {
      console.warn('audio', name, e);
    }
    return this.buffers[name];
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    if (!on) {
      this.engine.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
      this.prop.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    }
    if (on && !document.hidden) this.ctx.resume().catch(() => {});
    const g = this.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.12);
  }

  playIntro() {
    const b = this.buffers.intro;
    if (!b || !this.ctx) return null;
    this.stopIntro();
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    src.connect(g).connect(this.music);
    const t0 = this.ctx.currentTime + 0.05;
    src.start(t0);
    this.introSrc = src;
    this.introGain = g;
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      if (this.introSrc === src) this.introSrc = null;
    };
    return () => this.ctx.currentTime - t0;
  }

  stopIntro() {
    if (!this.introSrc) return;
    const now = this.ctx.currentTime;
    this.introGain.gain.cancelScheduledValues(now);
    this.introGain.gain.setTargetAtTime(0, now, 0.008);
    try { this.introSrc.stop(now + 0.04); } catch { /* already stopped */ }
  }

  // the score steps aside while the title sequence replays
  duckLoop(on) {
    if (!this.loopGain) return;
    this.loopGain.gain.setTargetAtTime(on ? 0 : 0.64, this.ctx.currentTime, on ? 0.08 : 1);
  }

  startLoop(fade = 3) {
    const b = this.buffers.loop;
    if (!b || !this.ctx || this.loopSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.64, this.ctx.currentTime, Math.max(0.01, fade / 3));
    src.connect(g).connect(this.music);
    src.start();
    this.loopSrc = src;
    this.loopGain = g;
  }

  play(name, gain = 1) {
    const b = this.buffers[name];
    if (!b || !this.ctx || !this.enabled || this.ctx.state !== 'running' || this.introSrc) return;
    const now = this.ctx.currentTime;
    const cooldown = { tick: 0.09, whoosh: 0.7, lock: 0.3 }[name] ?? 0;
    if (now - (this.lastPlayed[name] ?? -Infinity) < cooldown) return;
    this.lastPlayed[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, Number.isFinite(gain) ? gain : 0));
    src.connect(g).connect(this.sfx);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    src.start();
  }

  _synths() {
    const ctx = this.ctx;
    // A limited harmonic series gives body without the old square-wave buzz.
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.65;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 1.1) / Math.tanh(1.1); }
    shaper.curve = curve;
    shaper.oversample = '2x';
    const real = new Float32Array(17);
    const imag = new Float32Array(17);
    for (let h = 1; h < imag.length; h++) imag[h] = Math.exp(-h / 4) / Math.sqrt(h);
    const wave = ctx.createPeriodicWave(real, imag);
    this.engineOsc = [1, 1.006, 0.5].map((mult, i) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = 60 * mult;
      o.detune.value = (i - 1) * 7;
      const g = ctx.createGain();
      g.gain.value = [0.48, 0.24, 0.16][i];
      o.connect(g).connect(shaper);
      o.start();
      o.userData = { mult };
      return o;
    });
    shaper.connect(lp).connect(eg).connect(this.sfx);
    this.engine = { gain: eg, lp };

    // Soft rotor air, with a quiet sine component for blade rotation.
    const len = ctx.sampleRate * 2;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const k = Math.floor(ctx.sampleRate * 0.02);
    for (let i = 0; i < k; i++) {
      const a = 0.5 - 0.5 * Math.cos(Math.PI * i / k);
      d[i] = d[len - k + i] * (1 - a) + d[i] * a;
    }
    d[len - 1] = d[0];
    const noise = ctx.createBufferSource();
    noise.buffer = nb;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    bp.Q.value = 0.65;
    const pg = ctx.createGain();
    pg.gain.value = 0;
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    whine.frequency.value = 180;
    const wg = ctx.createGain();
    wg.gain.value = 0.055;
    noise.connect(bp).connect(pg);
    whine.connect(wg).connect(pg);
    pg.connect(this.sfx);
    noise.start();
    whine.start();
    this.prop = { gain: pg, bp, whine };
  }

  // Called every frame with the scene state.
  drive(state, dt) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const sp = Math.max(0, Math.min(1.4, Number.isFinite(state.speed) ? state.speed : 0));
    // fake gearbox: rpm climbs, drops a little at each shift
    const gears = 6;
    const g = Math.min(gears - 1, Math.floor((sp / 1.4) * gears));
    const within = (sp / 1.4) * gears - g;
    const rpm = 0.35 + within * 0.6 + g * 0.02;
    const f = 48 + rpm * 210;
    this.engineOsc.forEach((o) => o.frequency.setTargetAtTime(f * o.userData.mult, now, 0.05));
    this.engine.lp.frequency.setTargetAtTime(450 + rpm * 1000, now, 0.12);
    const eVol = !this.introSrc && sp > 0.01 ? 0.012 + Math.min(1, sp) * 0.085 : 0;
    this.engine.gain.gain.setTargetAtTime(eVol, now, 0.12);

    const spin = !this.introSrc && state.droneVisible ? Math.max(0, Math.min(1, Number.isFinite(state.spin) ? state.spin : 0)) : 0;
    this.prop.gain.gain.setTargetAtTime(spin * 0.055, now, 0.22);
    this.prop.bp.frequency.setTargetAtTime(300 + spin * 650, now, 0.16);
    this.prop.whine.frequency.setTargetAtTime(110 + spin * 180, now, 0.16);

    if (this.loopGain) {
      this.loopGain.gain.setTargetAtTime(0.64 - Math.min(0.12, sp * 0.1), now, 0.4);
    }
  }
}
