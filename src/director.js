// Scroll → scene state. Everything here is a pure function of the scroll position,
// so the whole film plays forwards and backwards exactly.
import { galleryCamera, galleryPortrait } from './world/gallery-path.js';
import { lineupX, HERO_X, GARAGE_Z, CARS, HERO } from './world/garage.js';

// After the opening on the McLaren, each lineup car gets its own three-shot pass
// (low nose, side dolly, high rear crane) before the camera returns to the McLaren.
const TOUR_AT = 0.27, TOUR_SHOT = 0.06, TOUR_CAR = TOUR_SHOT * 3;
const TOUR_END = TOUR_AT + TOUR_CAR * CARS.length;

const ORDER = ['hero', 'garage', 'launch', 'drone', 'maze', 'lock', 'work', 'about', 'contact'];
const GZ = GARAGE_Z;
const TAU = Math.PI * 2;

const DEFAULTS = {
  cam: [0.04, 1.2, 1.0], look: [-0.2, 1.1, 0], fov: 34, parallax: 1, shake: 0, roll: 0,
  light: 55, lightAngle: 0.4, lightDist: 1.5, lightLift: 0, lightYaw: 0, kick: 1.2,
  fog: 0.075, env: 0.32, exposure: 1, bloom: 0.35, aberration: 0, fade: 0, flash: 0,
  drone: [0, 1.1, 0], droneYaw: 0, dronePitch: 0, droneRoll: 0, explode: 0, spin: 0,
  grid: 0.6,
  heroYaw: 0.6, heroZ: 0, turntable: 0, carExplode: 0, strip: 0, stripX: 0,
  speed: 0, road: 0, veil: 0, rim: 0.22, analytic: 0,
  warmth: 0, haze: 1, transition: 0, sweep: 0, riso: 0, iris: 0, portal: 0, framing: 0,
  roadPos: [HERO_X, 0, GZ],
};

// [section, progress, values]
function keys() {
  const L = (i) => lineupX(i);
  const k = [
    // grade: the warm garage first, then the cool drone room after the launch
    ['hero', 0, { warmth: 1, haze: .9, grid: .035, rim: .22 }],
    // tracks keyed first later in the film would otherwise hold their first value back to the start
    ['hero', 0, { shake: 0, roll: 0, aberration: 0, speed: 0, road: 0, heroZ: 0 }],
    ['drone', 0, { droneYaw: 0, dronePitch: 0, droneRoll: 0, spin: 0, explode: 0, analytic: 0 }],
    ['garage', .92, { warmth: 1, haze: 1.0 }],
    ['launch', .5, { warmth: .65, haze: .65 }],
    ['drone', 0, { warmth: 0, haze: .5, grid: .6, rim: 1.6 }],
    ['maze', 0, { warmth: .08, haze: .7, rim: 1.6 }],
    ['lock', .7, { warmth: .08, haze: .8, rim: .22 }],
    // Hero: the MP4/5 on its turntable, low and close, beside the headline
    ['hero', 0, { cam: [HERO_X + 3.9, 0.62, GZ + 3.4], look: [HERO_X - 0.95, 0.55, GZ + 1.1], fov: 37, parallax: 1, strip: 1, stripX: HERO_X, turntable: 1, heroYaw: 0.6, carExplode: 0, light: 35, lightDist: 3.0, lightLift: 1.8, lightAngle: 0.34, fog: 0.05, env: 0.26, bloom: 0.35, kick: 0, veil: 0, fade: 0 }],
    ['hero', 0.9, { cam: [HERO_X + 5.0, 1.3, GZ + 3.6], look: [HERO_X - 0.5, 0.65, GZ + 0.7], fov: 36 }],
    ['garage', 0.14, { cam: [HERO_X + 5.6, 1.8, GZ + 2.8], look: [HERO_X, 0.7, GZ] }],
    ['garage', 0.21, { cam: [HERO_X + 5.6, 1.8, GZ + 2.8], look: [HERO_X, 0.7, GZ], stripX: HERO_X, aberration: 0, roll: 0 }],
  ];
  CARS.forEach((_, i) => {
    const p = TOUR_AT + i * TOUR_CAR, C = L(i);
    k.push(
      // low on the nose, wide open, the front wing filling the frame
      ['garage', p, { cam: [C + 4.4, 0.42, GZ + 2.6], look: [C + 1.2, 0.42, GZ + 0.2], fov: 30, stripX: C, grid: 0.2, turntable: 0, roll: 0.035 }],
      // tracking along the sidepod
      ['garage', p + TOUR_SHOT, { cam: [C + 0.8, 0.72, GZ + 4.6], look: [C - 0.2, 0.5, GZ], fov: 30, roll: 0 }],
      // craning up over the rear wing
      ['garage', p + TOUR_SHOT * 2, { cam: [C - 3.6, 2.6, GZ + 3.4], look: [C - 0.6, 0.45, GZ], fov: 34, roll: -0.03 }],
    );
  });
  const H = TOUR_END + 0.07;
  k.push(
    ['garage', TOUR_END + 0.02, { heroYaw: 0.6, turntable: 0 }],
    ['garage', H, { cam: [HERO_X + 4.4, 1.6, GZ + 5.3], look: [HERO_X, 0.7, GZ], stripX: HERO_X, turntable: 1, fov: 36, roll: 0 }],
    ['garage', H + 0.05, { cam: [HERO_X + 5.2, 2.6, GZ + 6.4], look: [HERO_X, 0.9, GZ], carExplode: 0, fov: 38, heroYaw: 3.0 }],
    ['garage', H + 0.12, { cam: [HERO_X + 6.6, 4.4, GZ + 7.6], look: [HERO_X, 1.3, GZ], carExplode: 1, fov: 44, light: 80, lightDist: 4.5, lightAngle: 0.6 }],
    ['garage', H + 0.18, { cam: [HERO_X - 5.8, 3.4, GZ + 6.0], look: [HERO_X, 1.2, GZ], carExplode: 1, heroYaw: 5.2 }],
    ['garage', H + 0.25, { cam: [HERO_X - 3.8, 1.15, GZ + 4.2], look: [HERO_X, 0.6, GZ], carExplode: 0, fov: 36, light: 35, lightDist: 3.4, lightAngle: 0.4, heroYaw: 7.0 }],
    ['launch', 0, { cam: [HERO_X + 0.4, 1.05, GZ + 5.8], look: [HERO_X, 0.7, GZ - 1], heroYaw: 3 * Math.PI, turntable: 1, fov: 40, road: 0, speed: 0, strip: 1 }],
    ['launch', 0.12, { turntable: 0, road: 1, strip: 0.4, fog: 0.04 }],
    ['launch', 0.5, { speed: 1, cam: [HERO_X + 1.5, 0.95, GZ + 7.2], look: [HERO_X, 0.5, GZ - 3], fov: 60, shake: 1, roll: 0.02, strip: 0, aberration: 0.002 }],
    ['launch', 0.72, { speed: 1.15, cam: [HERO_X - 1.7, 1.05, GZ + 6.9], look: [HERO_X, 0.5, GZ - 3], roll: -0.03 }],
    ['launch', 0.84, { heroZ: 0, fade: 0, speed: 1.2 }],
    ['launch', 1, { heroZ: -48, fade: 1, speed: 1.4, fov: 66 }],
    ['work', 0, { fade: 0, speed: 0, road: 0, heroZ: 0, shake: 0, roll: 0, aberration: 0, fov: 24 }],
    // hold the garage still through the launch and the calm sections, so nothing drifts off-screen
    // After the launch fades out, the drone room opens from black.
    ['drone', 0, { fade: 1, speed: 0, road: 0, heroZ: 0, shake: 0, roll: 0, aberration: 0, strip: 0, turntable: 0, carExplode: 0, heroYaw: 3 * Math.PI, stripX: HERO_X,
      cam: [0.35, 1.32, 0.92], look: [0, 1.12, 0], fov: 36, drone: [0, 1.1, 0], light: 55, lightDist: 1.5, lightLift: 0, lightAngle: 0.4, fog: 0.075, env: 0.32, bloom: 0.35, kick: 1.2, parallax: 1, veil: 0 }],
    ['drone', 0.05, { fade: 0 }],
    // taken apart, the drone is printed as a technical sheet; it returns to the room as it reassembles
    ['drone', 0.14, { analytic: 0, bloom: 0.35 }],
    ['drone', 0.26, { analytic: 1, bloom: 0.04 }],
    ['drone', 0.52, { analytic: 1, bloom: 0.04 }],
    ['drone', 0.63, { analytic: 0, bloom: 0.35 }],
    ['drone', 0.1, { cam: [0.62, 1.45, 0.95], look: [0, 1.13, 0], explode: 0, light: 60 }],
    ['drone', 0.36, { cam: [1.05, 1.95, 1.5], look: [0, 1.22, 0], fov: 41, explode: 1, lightDist: 2.3, light: 95, lightAngle: 0.55 }],
    ['drone', 0.5, { cam: [-0.35, 1.8, 1.75], look: [0, 1.2, 0], explode: 1 }],
    ['drone', 0.64, { cam: [-0.85, 1.32, 1.0], look: [0, 1.12, 0], explode: 0, fov: 36, lightDist: 1.6, light: 60, lightAngle: 0.4, spin: 0 }],
    ['drone', 0.74, { spin: 1, drone: [0, 1.1, 0], cam: [-0.72, 0.8, 1.12], look: [0, 1.22, 0], fov: 38 }],
    ['drone', 0.9, { drone: [0, 2.35, 0], cam: [-0.5, 2.0, 1.45], look: [0, 2.3, -0.2], fov: 40, grid: 0.6 }],
    ['maze', 0, { drone: [0, 2.6, -2.2], cam: [0.35, 3.6, -0.25], look: [0, .01, -3.5], fov: 44, droneYaw: 0, dronePitch: -.08, light: 95, lightDist: 2, lightLift: 1.6, grid: 0, parallax: 0, fog: .018, env: .8, bloom: .10, veil: 0 }],
    ['lock', 0, { drone: [0, 1.45, -19], cam: [0.5, 0.4, -16.0], look: [0, 1.45, -19], fov: 40, veil: 0.45, droneYaw: 2.4, grid: 0.5 }],
    ['lock', 0.8, { drone: [0.3, 1.75, -19.4], dronePitch: 0, droneYaw: 3.6, cam: [0.8, 0.65, -16.3], look: [0.3, 1.75, -19.4], veil: 0, kick: 0, grid: 0, parallax: 0, fog: 0.025, fade: 0 }],
    ['lock', .88, { cam: [.3, 1.78, -18.2], look: [.3, 1.78, -19.32], droneYaw: Math.PI, fov: 32, parallax: 0 }],
    ['lock', 1, { cam: [.3, 1.78, -19.24], look: [.3, 1.78, -19.34], drone: [.3, 1.75, -19.4], dronePitch: 0, droneRoll: 0, droneYaw: Math.PI, fov: 24, fade: 0, light: 80 }],
    ['launch', 1, { heroYaw: 3 * Math.PI, turntable: 0, strip: 0, stripX: HERO_X, carExplode: 0 }],
    ['about', 0.8, { heroYaw: 3 * Math.PI, turntable: 0, strip: 0, stripX: HERO_X, carExplode: 0 }],
    ['about', 0.85, { fade: 1, cam: [HERO_X + 4.0, 1.25, GZ + 5.2], look: [HERO_X + 0.4, 0.95, GZ], drone: [HERO_X + 1.3, 1.5, GZ + 0.9], explode: 0, spin: 0.7, heroYaw: 5.4, turntable: 1, strip: 1, stripX: HERO_X, veil: 0.4, fog: 0.05, light: 45, lightDist: 2.8, lightLift: 0.8 }],
    ['contact', 0.15, { fade: 0 }],
    ['contact', 1, { cam: [HERO_X + 4.8, 1.7, GZ + 6.0], look: [HERO_X + 0.4, 1.0, GZ], heroYaw: 6.2, droneYaw: 0.8 }],
  );
  return k;
}

const PINNED_TIMING = new Set(['drone']);
// Chapter handoffs printed as a risograph wipe: [section, centre, half-width]
const RISO = [['drone', 0.03, 0.05], ['launch', 0.04, 0.06]];
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

export class Director {
  constructor() {
    this.ids = ORDER;
    this.els = ORDER.map((id) => document.getElementById(id));
    this.tracks = {};
    this.state = structuredClone(DEFAULTS);
    this.measure();
  }

  measure() {
    const y = window.scrollY;
    this.vh = window.innerHeight;
    // Browser scroll positions use whole pixels; fractional section tops can miss a boundary.
    this.tops = this.els.map((el) => Math.round(el.getBoundingClientRect().top + y));
    this.heights = this.els.map((el) => el.offsetHeight);
    this._buildTracks();
  }

  s(id, p) { return ORDER.indexOf(id) + p; }

  // The exploded drone is timed against its pinned stretch.
  sp(id, p) {
    const i = ORDER.indexOf(id);
    return PINNED_TIMING.has(id) ? i + p * Math.max(1, this.heights[i] - this.vh) / Math.max(1, this.heights[i]) : i + p;
  }

  // continuous scroll coordinate: section index + progress through it
  sAt(y) {
    for (let i = ORDER.length - 1; i >= 0; i--) {
      if (y >= this.tops[i]) return i + Math.min(1, (y - this.tops[i]) / this.heights[i]);
    }
    return 0;
  }

  // progress while a sticky section is pinned (0 at pin start, 1 at pin end)
  pinned(id, y) {
    const i = ORDER.indexOf(id);
    const range = Math.max(1, this.heights[i] - this.vh);
    return clamp01((y - this.tops[i]) / range);
  }

  _buildTracks() {
    const tracks = {};
    for (const [id, p, vals] of keys()) {
      const s = this.sp(id, p);
      for (const [name, v] of Object.entries(vals)) (tracks[name] ||= []).push([s, v]);
    }
    for (const t of Object.values(tracks)) t.sort((a, b) => a[0] - b[0]);
    this.tracks = tracks;
  }

  sample(s) {
    const st = this.state;
    for (const [name, def] of Object.entries(DEFAULTS)) {
      const t = this.tracks[name];
      if (!t) { st[name] = Array.isArray(def) ? def.slice() : def; continue; }
      let v;
      if (s <= t[0][0]) v = t[0][1];
      else if (s >= t[t.length - 1][0]) v = t[t.length - 1][1];
      else {
        let i = 1;
        while (t[i][0] < s) i++;
        const [s0, a] = t[i - 1], [s1, b] = t[i];
        const e = smoother(clamp01((s - s0) / (s1 - s0)));
        v = Array.isArray(a) ? a.map((x, j) => x + (b[j] - x) * e) : a + (b - a) * e;
      }
      st[name] = Array.isArray(v) ? v.slice() : v;
    }
    return st;
  }

  update(y, time) {
    const s = this.sAt(y);
    const st = this.sample(s);
    this.sNow = s;

    // On portrait screens the opening centres the car instead of framing it beside the headline.
    if (window.innerWidth < window.innerHeight) {
      const k = clamp01(1 - (s - 1.0) / 0.3);
      st.look[0] += (HERO_X - st.look[0]) * k;
      st.look[2] += (GZ - st.look[2]) * k;
      // and in the closing shot the whole frame rises, so the car sits below the contact buttons.
      // (world.js pulls the camera back about 1.5/aspect times, so the lift scales the same way)
      const lift = clamp01((s - this.s('about', 0.85)) * 6) * Math.min(3.2, 1.5 * window.innerHeight / window.innerWidth) * 0.95;
      st.look[1] += lift;
      st.cam[1] += lift;
    }

    // Layered motion that keyframes can't express
    const heroIdle = s < this.s('drone', 0) ? 0 : 1 - clamp01((s - this.sp('drone', 0.6)) * 4);
    st.drone[1] += Math.sin(time * 1.3) * 0.012 * heroIdle;
    st.droneYaw += time * 0.12 * heroIdle * (1 - st.explode);
    if (s > this.s('lock', .06) && s < this.s('lock', .8)) {
      const settle = 1 - smoother(clamp01((s - 5.65) / .15));
      st.drone[0] += Math.sin(time * 0.9) * 0.15 * settle;
      st.drone[1] += Math.sin(time * 1.4) * 0.06 * settle;
    }
    if (s >= this.sp('drone', 0.72) && s < this.s('work', 0)) st.spin = Math.max(st.spin, 0.85);
    if (s > this.s('about', 0.8)) {
      st.spin = 0.85;
      st.drone[1] += Math.sin(time * 1.2) * 0.05;
    }
    st.garage = s < this.s('drone', 0) || s > this.s('about', 0.8);
    st.lineup = !(s > this.s('launch', 0.1) && s < this.s('about', 0.8));
    st.droneVisible = (s > this.s('drone', 0) && s < this.s('work', 0)) || s > this.s('about', 0.8);
    st.mazeVisible = s >= this.sp('drone', .82) && s < 5;
    st.framing = s >= 3.8 && s < 5 ? smoother(clamp01((s - 3.8) / .2))
      : s >= 5.8 && s < 6 ? smoother(clamp01((s - 5.8) / .08)) : 0;
    st.mazeProgress = clamp01((s - 4.14) / .68);
    st.pilot = s >= 5.06 && s < 5.8;
    st.iris = s >= 4.9 && s < 5 ? smoother(clamp01((s - 4.9) / .08))
      : s >= 5 && s < 5.06 ? 1 - smoother(clamp01((s - 5) / .06)) : 0;
    st.portal = s >= 5.88 && s < 6 ? smoother(clamp01((s - 5.88) / .10)) : 0;
    if (s >= 4 && s < 5) {
      const p = s - 4, enter = smoother(clamp01(p / .14));
      const portrait = window.innerWidth < window.innerHeight;
      const height = portrait ? 3.4 / (window.innerWidth / window.innerHeight) : 4.0;
      const targetCam = [portrait ? 0 : .05, height, -3.1];
      st.cam = st.cam.map((v, i) => v + (targetCam[i] - v) * enter);
      st.look = [0, .01, -3.5];
      st.fov = 44; st.parallax = 0; st.grid = 0; st.analytic = 0;
      st.drone = [0, 2.6 + enter * 4, -2.2 - enter * 3.0];
      st.droneVisible = p < .14;
      st.light = 95; st.lightDist = 2; st.lightLift = 1.6;
      st.env = .8; st.fog = .018; st.bloom = .10; st.veil = 0;
    }
    st.gallery = s >= 6 && s < 7;
    st.galleryProgress = Math.max(0, Math.min(1, s - 6));
    if (st.gallery) {
      const p = st.galleryProgress;
      Object.assign(st, galleryCamera(p, galleryPortrait(window.innerWidth, window.innerHeight)));
      st.fade = clamp01((p - 0.94) / 0.055);
      st.portal = p < .055 ? 1 + smoother(clamp01(p / .055)) : 0;
      st.speed = 0; st.road = 0; st.shake = 0; st.roll = 0;
      st.aberration = 0; st.parallax = 0; st.veil = 0;
      st.fog = 0.018; st.bloom = 0.14; st.light = 0; st.kick = 0;
      st.garage = false; st.droneVisible = false; st.mazeVisible = false;
    }
    st.riso = 0;
    for (const [id, c, w] of RISO) {
      const s0 = this.sp(id, c - w), s1 = this.sp(id, c + w);
      if (s > s0 && s < s1) st.riso = (s - s0) / (s1 - s0);
    }
    st.stripOnHero = false;
    st.chapter = Math.min(ORDER.length - 1, Math.floor(s));
    return st;
  }

  // which car the name plate should show in the garage
  carAt(y) {
    const p = (this.sAt(y) - ORDER.indexOf('garage'));
    if (p < TOUR_AT - 0.03 || p >= TOUR_END + 0.04) return HERO;
    return CARS[Math.max(0, Math.min(CARS.length - 1, Math.floor((p - TOUR_AT + 0.03) / TOUR_CAR)))];
  }
}
