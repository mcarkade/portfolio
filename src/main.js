import './style.css';
import Lenis from 'lenis';
import * as THREE from 'three';
import { Director } from './director.js';
import { Intro, loadImages } from './intro.js';
import { Audio } from './audio.js';
import { splitWords, observeReveals, Cursor, magnetic, LockGame, copyEmail, finePointer, reducedMotion } from './ui.js';

history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const $ = (s) => document.querySelector(s);
const body = document.body;

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2'); // three.js r186 renders with WebGL2 only
  } catch { return false; }
}

const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) < 4;
const small = Math.min(innerWidth, innerHeight) < 700;
const quality = lowEnd || small || !finePointer ? 'low' : 'high';
const hasGL = webglOK();

const INTRO_IMAGES = [
  'intro/drone', 'mr-tunnel', 'portrait', 'intro/rb19', 'theta-shell', 'mr-suzuka', 'intro/explode', 'mr-forest-night',
  'mesh-electronics', 'intro/mp45', 'reaper', 'theta-cart', 'intro/w11', 'mr-forest-dash', 'mesh-arena', 'intro/lift',
  'theta-hub', 'mesh-plate', 'nxp-track',
].map((n) => `/media/${n}.webp`);
if (new URLSearchParams(location.search).has('clean')) document.documentElement.classList.add('clean');

const audio = new Audio();
const loaderNum = $('#load-num');
const loaderBar = $('#load-bar');
let progress = 0;
function setProgress(p) {
  progress = Math.max(progress, p);
  loaderNum.textContent = String(Math.round(progress * 100)).padStart(3, '0');
  loaderBar.style.transform = `scaleX(${progress})`;
}

splitWords();

let world = null;
let director = null;
let lenis = null;

const withTimeout = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);

async function boot() {
  setProgress(0.04);
  const tasks = [];
  let done = 0;
  const track = (p) => { tasks.push(p); p.then(() => { done++; setProgress(0.04 + 0.9 * (done / tasks.length)); }); return p; };

  track(withTimeout(document.fonts?.ready, 4000));
  const imagesP = track(loadImages(INTRO_IMAGES, 7000));
  await withTimeout(audio.init(), 2000);
  track(withTimeout(audio.load('intro', '/audio/intro.mp3'), 6000));
  ['tick', 'whoosh', 'lock'].forEach((n) => audio.load(n, `/audio/${n}.mp3`));
  const cuesP = withTimeout(fetch('/audio/intro_cues.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})), 4000).then((c) => c || {});

  if (hasGL) {
    try {
      const { World } = await import('./world/world.js');
      world = new World($('#gl'), { quality });
      await withTimeout(document.fonts.ready, 4000);
      world.heroType.resize();
      body.classList.add('has-scene-type');
      director = new Director();
      world.director = director;
      document.fonts.ready.then(() => world?.gallery.resize());
      const galleryReady = track(withTimeout(world.gallery.prime(), 4000));
      // warm up shaders behind the loader
      world.render(director.update(0, 0));
      await withTimeout(world.warm(), 8000);
      await galleryReady;
      // Exercise the gallery's real vertex buffers and composer draw behind the loader.
      world.render(director.update(director.tops[6], 0));
      world.render(director.update(0, 0));
      // phones fetch the cars (about 15 MB) once the visitor heads past the drone
      if (quality === 'high') { loadCars(); track(withTimeout(carsP, 6000)); }
      window.__mc = { world, director };
    } catch (e) {
      console.warn('3D disabled', e);
      world = null; director = null;
      body.classList.remove('has-scene-type');
    }
  }
  if (!world) body.classList.add('no-webgl');

  // hard deadline: whatever has arrived by now is enough to enter
  await withTimeout(Promise.all(tasks), 12000);
  const images = (await withTimeout(imagesP, 10)) || [];
  const cues = await cuesP;
  setProgress(1);
  startLoop();
  showEnter(images, cues);
}

function showEnter(images, cues) {
  const enter = $('.loader__enter');
  enter.hidden = false;
  enter.querySelector('[data-enter="sound"]').focus({ preventScroll: true });
  enter.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-enter]');
    if (!btn) return;
    const withSound = btn.dataset.enter === 'sound';
    setSound(withSound);
    $('#loader').classList.add('is-done');
    $('#loader').inert = true;
    introAssets = { images, cues };
    await playIntro(images, cues, withSound);
    begin();
  });
}

let introAssets = null;
// onCovered runs once the title sequence fills the screen, to change the page behind it unseen
async function playIntro(images, cues, withSound, onCovered) {
  const root = $('#intro');
  if (reducedMotion || images.length < 4) { onCovered?.(); return; }
  root.getAnimations().forEach((a) => a.cancel());
  root.classList.remove('is-hit');
  body.classList.add('is-intro');
  const hit = cues.hitTime ?? 4.4;
  const intro = new Intro(root, images, { hit, duration: hit + 2.1 });
  const audioClock = withSound ? audio.playIntro() : null;
  const t0 = performance.now();
  const wall = () => (performance.now() - t0) / 1000;
  // follow the audio clock for sync, but never fall far behind the wall clock (suspended audio, muted tab)
  const clockFn = audioClock ? () => Math.max(audioClock(), wall() - 0.25) : wall;
  const skip = root.querySelector('.intro__skip');
  skip.focus({ preventScroll: true });
  const listen = new AbortController();
  const onSkip = () => { intro.skip(); audio.stopIntro(); };
  skip.addEventListener('click', onSkip, { signal: listen.signal });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') onSkip(); }, { signal: listen.signal });
  const played = intro.play(clockFn);
  onCovered?.();
  await played;
  listen.abort();
  const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
  fade.finished.then(() => { root.classList.remove('is-on', 'is-hit'); fade.cancel(); }, () => {});
}

// The nav mark plays the title sequence again, landing back at the top of the page.
let replaying = false;
async function replayIntro() {
  if (replaying || !introAssets || reducedMotion) return false;
  replaying = true;
  closeMenu();
  lenis?.stop();
  setInert(true);
  audio.duckLoop(true);
  await playIntro(introAssets.images, introAssets.cues, audio.enabled, () => {
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true }); else window.scrollTo(0, 0);
    body.classList.remove('hud-away');
    if (location.hash) history.pushState(null, '', location.pathname);
  });
  body.classList.remove('is-intro');
  setInert(false);
  audio.duckLoop(false);
  lenis?.start();
  assembleStart = performance.now() - 250;
  $('#hero').focus({ preventScroll: true });
  replaying = false;
  return true;
}

// The drone flies together out of its parts as the title sequence clears.
let assembleStart = -1;
const ASSEMBLE = 2.6;
function assembleAt(now) {
  if (reducedMotion) return 0;
  if (assembleStart < 0) return 1;
  const u = Math.min(1, (now - assembleStart) / (ASSEMBLE * 1000));
  return 1 - (1 - Math.pow(1 - u, 3));
}

function begin() {
  assembleStart = performance.now() - 250;
  body.classList.remove('is-loading', 'is-intro');
  setInert(false);
  $('#loader').setAttribute('aria-hidden', 'true');
  $('#hero').focus({ preventScroll: true });
  if (audio.enabled) loadLoop();
  director?.measure();
  // the hero's own reveal, staged after the title sequence
  document.querySelectorAll('.hero .split, .hero .reveal').forEach((el, i) => setTimeout(() => el.classList.add('is-in'), 350 + i * 160));
  if (!reducedMotion) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, touchMultiplier: 1.4, smoothWheel: true });
    lenis.on('scroll', () => {});
  }
  observeReveals();
  // Back and Forward move between sections visited through the menu
  addEventListener('popstate', () => {
    const el = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    const to = el || 0;
    if (lenis) lenis.scrollTo(to, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
    else window.scrollTo({ top: el ? el.offsetTop : 0 });
    (el || $('#hero')).focus({ preventScroll: true });
  });
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (a.classList.contains('mark') && introAssets && !reducedMotion) { e.preventDefault(); replayIntro(); return; }
      const id = a.getAttribute('href').slice(1);
      const target = id === 'top' ? 0 : document.getElementById(id);
      if (target === null) return;
      e.preventDefault();
      closeMenu();
      const arrive = () => {
        const url = id === 'top' ? location.pathname : `#${id}`;
        if (url !== location.hash && !(id === 'top' && !location.hash)) history.pushState(null, '', url);
        (target === 0 ? $('#hero') : target).focus({ preventScroll: true });
      };
      if (lenis) lenis.scrollTo(target, { duration: 2.2, easing: (t) => 1 - Math.pow(1 - t, 4), onComplete: arrive });
      else { if (target === 0) window.scrollTo({ top: 0 }); else target.scrollIntoView(); arrive(); }
    });
  });
}

let carsP = null;
function loadCars() {
  carsP ||= world.garage.loadAll();
}

// ---------- Sound toggle ----------
const soundBtn = $('.sound');
let loopP = null;
// The ambient score only downloads once someone asks for sound, and never plays over the intro.
function loadLoop() {
  if (!loopP) {
    const ogg = new window.Audio().canPlayType('audio/ogg; codecs=vorbis');
    loopP = audio.load('loop', ogg ? '/audio/loop.ogg' : '/audio/loop.mp3');
  }
  loopP.then(() => { if (audio.enabled && !body.classList.contains('is-loading') && !body.classList.contains('is-intro')) audio.startLoop(); });
}
function setSound(on) {
  audio.setEnabled(on);
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Sound on. Turn sound off' : 'Sound off. Turn sound on');
  if (on) loadLoop();
}

// While the loader and intro run, nothing behind them can take focus.
function setInert(on) {
  document.querySelectorAll('main, .hud, footer').forEach((el) => { el.inert = on; });
}
setInert(true);

// Small-screen menu
const menuBtn = $('.menu-btn');
const menu = $('#menu');
// while the menu is open, the page behind it can't take focus
function menuInert(on) { document.querySelectorAll('main, footer').forEach((el) => { el.inert = on; }); }
function closeMenu() { menu.classList.remove('is-open'); menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.textContent = 'Menu'; menuInert(false); }
menuBtn.addEventListener('click', () => {
  const open = !menu.classList.contains('is-open');
  menu.classList.toggle('is-open', open);
  menuInert(open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.textContent = open ? 'Close' : 'Menu';
  if (open) menu.querySelector('a').focus();
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('is-open')) { closeMenu(); menuBtn.focus(); } });
soundBtn.addEventListener('click', () => setSound(!audio.enabled));
// a keyboard user tabbing into the header brings it back into view
$('.hud--top').addEventListener('focusin', () => body.classList.remove('hud-away'));

addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.key === 'l' || e.key === 'L') { if (world) world.lightsTarget = world.lightsTarget ? 0 : 1; }
  if (e.key === 'm' || e.key === 'M') setSound(!audio.enabled);
});

// ---------- Pointer ----------
addEventListener('pointermove', (e) => {
  world?.setMouse((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
}, { passive: true });

// ---------- Per-frame DOM ----------
const cursor = new Cursor(audio);
const lock = new LockGame(audio);
magnetic();
copyEmail();

const progressEl = $('#readout-bar');
const navLinks = [...document.querySelectorAll('.nav a')];
const visionSection = $('#vision');
const visionBox = $('#vision-box');
const carName = $('#car-name');
const speedEl = $('#speed');
const launchTitle = $('.launch__title');
const portrait = $('.about__portrait img');
const veil = $('.veil');
const heroEl = $('#hero');
const garageEl = $('#garage');
let maxScroll = 1;
function measureDom() {
  maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
}

const tmpV = new THREE.Vector3();
const tmpBox = new THREE.Box3();
const P = { x: 0, y: 0, z: 0 };

function projectBox(obj) {
  tmpBox.setFromObject(obj);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    tmpV.set(i & 1 ? tmpBox.max.x : tmpBox.min.x, i & 2 ? tmpBox.max.y : tmpBox.min.y, i & 4 ? tmpBox.max.z : tmpBox.min.z);
    const p = world.project(tmpV, P);
    if (!p) return null;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

let lastChapter = -1;
let lastCar = null;
let lastY = 0;
let lastTarget = null;

function domFrame(st, y, dt) {
  const vh = innerHeight;
  veil.style.setProperty('--veil', st.veil.toFixed(3));
  // hero copy fades out before it slides under the header
  if (y < vh) heroEl.style.opacity = (1 - Math.min(1, y / (vh * 0.5)) ** 1.5).toFixed(3);

  // chapter readout + nav
  if (st.chapter !== lastChapter) {
    lastChapter = st.chapter;
    const id = director.ids[st.chapter];
    navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${id}` || (id === 'launch' && a.getAttribute('href') === '#garage') || (id === 'vision' && a.getAttribute('href') === '#drone')));
    if (lenis && audio.enabled) audio.play('whoosh', 0.35);
    // pinned headings can sit outside the reveal observer's band after a jump; show them on arrival
    document.querySelectorAll(`#${id} .sticky .split`).forEach((el) => el.classList.add('is-in'));
  }
  body.classList.toggle('is-scrolled', st.chapter >= 6);
  // the header gets out of the way on the way down and comes back on the way up
  const dy = y - lastY;
  lastY = y;
  if (Math.abs(dy) > 2) body.classList.toggle('hud-away', dy > 0 && y > vh * 0.8 && !menu.classList.contains('is-open') && !document.querySelector('.hud--top:focus-within'));
  if ((st.chapter >= 1 && st.chapter <= 5 && y > vh * 2) || st.chapter >= 7) loadCars();
  progressEl.style.transform = `scaleX(${Math.min(1, y / maxScroll)})`;

  // vision HUD
  const pv = director.pinned('vision', y);
  const inVision = st.chapter === 2;
  visionSection.classList.toggle('is-active', inVision && pv > 0.02 && pv < 0.99);
  visionSection.classList.toggle('is-pov', st.thermal > 0.5);
  if (inVision) {
    let target = null, tag = '';
    if (pv > 0.22 && pv < 0.66) { target = world.person; tag = pv < 0.33 ? 'person 0.71' : 'person 0.94'; }
    else if (pv > 0.78 && pv < 0.96) { target = world.marker; tag = 'aruco id 23'; }
    if (target !== lastTarget) { lastTarget = target; if (target && audio.enabled) audio.play('lock', 0.4); }
    const b = target && projectBox(target);
    visionBox.classList.toggle('is-on', !!b);
    if (b) {
      visionBox.style.transform = `translate(${b.x0}px, ${b.y0}px)`;
      visionBox.style.width = `${b.x1 - b.x0}px`;
      visionBox.style.height = `${b.y1 - b.y0}px`;
      setText(visionBox.firstElementChild, tag);
    }
  }

  // the plate and the play button wait until the swarm has become the car
  garageEl.classList.toggle('is-formed', st.morph > 0.95);

  // garage name plate
  if (st.chapter === 4 || st.chapter === 5) {
    const car = director.carAt(y);
    if (car !== lastCar) {
      lastCar = car;
      carName.animate([{ opacity: 0, transform: 'translateY(0.6rem)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.22,1,.36,1)' });
      carName.textContent = car.name;
    }
  }

  // launch
  if (st.chapter === 5 || st.chapter === 4) {
    setText(speedEl, String(Math.round(Math.min(1.4, st.speed) * 245)));
    // the line has been said by the time the car is flat out; let the light gates have the frame
    launchTitle.style.opacity = (1 - Math.min(1, Math.max(0, (st.speed - 0.45) / 0.35))).toFixed(3);
  }

  // portrait parallax
  if (st.chapter >= 6) {
    const r = portrait.parentElement.getBoundingClientRect();
    if (r.bottom > 0 && r.top < vh) portrait.style.transform = `translateY(${((r.top + r.height / 2 - vh / 2) / vh) * -8}%)`;
  }

  // the turret always chases the 3D drone (flown by the cursor on desktop, by itself on touch)
  if (st.chapter === 3 && st.droneVisible) {
    world.drone.group.getWorldPosition(tmpV);
    const p = world.project(tmpV, P);
    if (p) lock.setTarget(p.x, p.y);
  }

  cursor.update(dt);
  lock.update(dt);
  // the 3D turret aims along the reticle's line of sight, out to the drone's depth
  const turretOn = st.chapter === 3 && st.droneVisible && st.morph < 0.02;
  if (turretOn) world.drone.group.getWorldPosition(tmpV);
  world.turret.update(dt, turretOn, (lock.x / innerWidth) * 2 - 1, -(lock.y / innerHeight) * 2 + 1, turretOn ? world.camera.position.distanceTo(tmpV) : 0, lock.locked);
}

function setText(el, v) { if (el.textContent !== v) el.textContent = v; }

// ---------- Main loop ----------
// Lock chapter on desktop: the cursor flies the drone, with inertia and banking.
const pilot = { w: 0, x: 0, y: 0 };
function flyDrone(st, dt) {
  const on = finePointer && !reducedMotion && st.chapter === 3;
  pilot.w += ((on ? 1 : 0) - pilot.w) * (1 - Math.exp(-dt * 2.5));
  if (pilot.w < 0.001) return;
  const k = 1 - Math.exp(-dt * 2.4);
  const px = pilot.x;
  pilot.x += (world.mouse.x * 1.7 - pilot.x) * k;
  pilot.y += (world.mouse.y * 0.75 - pilot.y) * k;
  st.drone[0] += pilot.x * pilot.w;
  st.drone[1] += pilot.y * pilot.w;
  // bank into the turn: a roll about world Z, expressed in the yawed body frame
  const bank = Math.max(-0.5, Math.min(0.5, -(pilot.x - px) / Math.max(dt, 1e-3) * 0.12)) * pilot.w;
  st.dronePitch -= bank * Math.sin(st.droneYaw);
  st.droneRoll += bank * Math.cos(st.droneYaw);
}

let last = performance.now();
let running = false;
function startLoop() {
  if (running) return;
  running = true;
  cursor.enable();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    lenis?.raf(now);
    const y = lenis ? lenis.animatedScroll : window.scrollY;
    if (world && director) {
      const st = director.update(y, reducedMotion ? 0 : now / 1000);
      const asm = assembleAt(now);
      if (asm > 0) { st.explode = Math.max(st.explode, asm); st.droneYaw += asm * 1.4; }
      // fast scrolling smears the colour channels a little
      if (lenis) st.aberration += Math.min(0.0035, Math.abs(lenis.velocity) * 0.00006);
      st.scrollVelocity = lenis?.velocity || 0;
      world.gallery.prepare(director.sNow);
      flyDrone(st, dt);
      if (reducedMotion) { st.shake = 0; st.aberration = 0; st.roll = 0; st.speed = 0; st.spin = Math.min(st.spin, 0.2); }
      if (st.fade < 0.999) { world.render(st); world.blank = false; if (!document.hidden) world.adapt(dt); }
      else {
        world.timer.update();
        if (!world.blank) { world.renderer.setRenderTarget(null); world.renderer.clear(); world.blank = true; }
      }
      audio.drive(st, dt);
      domFrame(st, y, dt);
    } else {
      const y = window.scrollY;
      progressEl.style.transform = `scaleX(${Math.min(1, y / maxScroll)})`;
      cursor.update(dt);
      lock.update(dt);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

let resizeT;
function remeasure() { director?.measure(); measureDom(); lenis?.resize(); }
addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(remeasure, 150);
});
document.fonts?.ready.then(remeasure);
new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(remeasure, 150); }).observe(document.querySelector('main'));
measureDom();

boot().catch((e) => {
  console.error(e);
  setProgress(1);
  startLoop();
  showEnter([], {});
});
