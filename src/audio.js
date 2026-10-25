// Music, UI sounds and two live synths driven by the scene: the drone's props and a V10 for the launch.
export class Audio {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.buffers = {};
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
    comp.threshold.value = -10;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.85;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.6;
    this.sfx.connect(this.master);
    this._synths();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else if (this.enabled) this.ctx.resume();
    });
  }

  async load(name, url) {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
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
    if (on) this.ctx.resume();
    const g = this.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.25);
  }

  playIntro() {
    const b = this.buffers.intro;
    if (!b || !this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.connect(this.music);
    const t0 = this.ctx.currentTime + 0.05;
    src.start(t0);
    this.introSrc = src;
    return () => this.ctx.currentTime - t0;
  }

  stopIntro() {
    try { this.introSrc?.stop(); } catch { /* already stopped */ }
  }

  startLoop(fade = 3) {
    const b = this.buffers.loop;
    if (!b || !this.ctx || this.loopSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.7, this.ctx.currentTime, fade / 3);
    src.connect(g).connect(this.music);
    src.start();
    this.loopSrc = src;
    this.loopGain = g;
  }

  play(name, gain = 1) {
    const b = this.buffers[name];
    if (!b || !this.ctx || !this.enabled) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.sfx);
    src.start();
  }

  _synths() {
    const ctx = this.ctx;
    // Engine: three detuned saws, waveshaped and low-passed. Pitch follows speed through gears.
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.4); }
    shaper.curve = curve;
    this.engineOsc = [1, 2, 0.5].map((mult, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.value = 60 * mult;
      o.detune.value = (i - 1) * 7;
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.22, 0.3][i];
      o.connect(g).connect(shaper);
      o.start();
      o.userData = { mult };
      return o;
    });
    shaper.connect(lp).connect(eg).connect(this.sfx);
    this.engine = { gain: eg, lp };

    // Props: band-passed noise plus a thin whine
    const len = ctx.sampleRate * 2;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = nb;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    bp.Q.value = 1.4;
    const pg = ctx.createGain();
    pg.gain.value = 0;
    const whine = ctx.createOscillator();
    whine.type = 'triangle';
    whine.frequency.value = 180;
    const wg = ctx.createGain();
    wg.gain.value = 0.18;
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
    const sp = Math.min(1.4, state.speed);
    // fake gearbox: rpm climbs, drops a little at each shift
    const gears = 6;
    const g = Math.min(gears - 1, Math.floor((sp / 1.4) * gears));
    const within = (sp / 1.4) * gears - g;
    const rpm = 0.35 + within * 0.6 + g * 0.02;
    const f = 48 + rpm * 210;
    this.engineOsc.forEach((o) => o.frequency.setTargetAtTime(f * o.userData.mult, now, 0.05));
    this.engine.lp.frequency.setTargetAtTime(500 + rpm * 2600, now, 0.08);
    const eVol = sp > 0.01 ? 0.05 + Math.min(1, sp) * 0.22 : 0;
    this.engine.gain.gain.setTargetAtTime(eVol, now, 0.12);

    const spin = state.droneVisible ? state.spin : 0;
    this.prop.gain.gain.setTargetAtTime(spin * 0.12, now, 0.15);
    this.prop.bp.frequency.setTargetAtTime(250 + spin * 900, now, 0.1);
    this.prop.whine.frequency.setTargetAtTime(120 + spin * 260, now, 0.1);

    if (this.loopGain) {
      // duck the music a touch while the engine screams
      this.loopGain.gain.setTargetAtTime(0.7 - Math.min(0.35, sp * 0.3), now, 0.3);
    }
  }
}
