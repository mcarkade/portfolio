import './style.css';
import Lenis from 'lenis';
import * as THREE from 'three';
import { Director } from './director.js';
import { Intro, loadImages } from './intro.js';
import { Audio } from './audio.js';
import { splitWords, observeReveals, Cursor, magnetic, LockGame, copyEmail, finePointer, reducedMotion } from './ui.js';
import { initViewer } from './viewer.js';
import { initTour, initChapterRail } from './tour.js';
import { initTouchPilot } from './touch-pilot.js';
import { createManualScroll } from './scroll.js';

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
  'intro/drone', 'mr-tunnel', 'portrait', 'intro/rb19', 'mr-suzuka', 'intro/explode', 'mr-forest-night',
  'mesh-electronics', 'intro/mp45', 'reaper', 'intro/w11', 'mr-forest-dash', 'mesh-arena', 'intro/lift',
  'mesh-plate', 'nxp-track',
].map((n) => `/media/${n}.webp`);
if (new URLSearchParams(location.search).has('clean')) document.documentElement.classList.add('clean');

const audio = new Audio();
const loaderNum = $('#load-num');
const loaderBar = $('#load-bar');
const loaderRoot = $('#loader');
const loaderCount = loaderRoot.querySelector('.loader__count');
const loaderProgress = loaderRoot.querySelector('[role="progressbar"]');
let progress = 0;
let shownProgress = 0;
let loaderFrame = 0;
let loaderLast = performance.now();
function setProgress(p) {
  progress = Math.max(progress, Math.min(1, p));
  if (!loaderFrame) loaderFrame = requestAnimationFrame(paintProgress);
}
function paintProgress(now) {
  const dt = Math.min(.05, Math.max(0, (now - loaderLast) / 1000));
  loaderLast = now;
  shownProgress += Math.min(dt * .38, (progress - shownProgress) * (1 - Math.exp(-dt * 4)));
  if (progress === 1 && 1 - shownProgress < .001) shownProgress = 1;
  const n = Math.round(shownProgress * 100);
  const label = String(n).padStart(3, '0');
  if (loaderNum.textContent !== label) loaderNum.textContent = label;
  loaderCount.dataset.n = n;
  loaderProgress.setAttribute('aria-valuenow', n);
  loaderBar.style.transform = `scaleX(${shownProgress})`;
  loaderRoot.style.setProperty('--loader-p', shownProgress.toFixed(5));
  loaderFrame = shownProgress < progress ? requestAnimationFrame(paintProgress) : 0;
}
async function finishProgress() {
  setProgress(1);
  const deadline = performance.now() + 5000;
  while (shownProgress < .999 && performance.now() < deadline) await new Promise(r => setTimeout(r, 30));
  shownProgress = 1;
  paintProgress(performance.now());
}
const loaderFonts = document.fonts?.load("900 1em 'Archivo Variable'", 'MCARKADE Enter');
Promise.race([loaderFonts, new Promise(r => setTimeout(r, 1500))]).then(() => loaderRoot.classList.add('is-set'), () => loaderRoot.classList.add('is-set'));

splitWords();

let world = null;
let director = null;
let lenis = null;
let manualScroll = null;

const withTimeout = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
async function requireBeforeEnter(p, ms) {
  let timer;
  try { await Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Car preparation timed out')), ms); })]); }
  finally { clearTimeout(timer); }
}

async function boot() {
  setProgress(0.04);
  const tasks = [];
  let done = 0;
  // Fixed weights keep late registration from moving the target backwards or finishing early.
  const track = (p) => { tasks.push(p); p.then(() => { done++; setProgress(0.04 + 0.87 * Math.min(1, done / 5)); }); return p; };

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
      director = new Director();
      world.director = director;
      document.fonts.ready.then(() => world?.gallery.resize());
      const galleryReady = track(withTimeout(world.gallery.prime(), 4000));
      // warm up shaders behind the loader
      world.render(director.update(0, 0));
      await withTimeout(world.warm(), 8000);
      await galleryReady;
      // Exercise the gallery's real vertex buffers and composer draw behind the loader.
      world.render(director.update(director.tops[4] + director.heights[4] * .5, 0));
      world.render(director.update(director.tops[6], 0));
      world.render(director.update(0, 0));
      // the film opens on the cars, so they load behind the loader on every device
      world.garage.loadHero(p => setProgress(.48 + p * .22));
      await requireBeforeEnter(loadCars(p => setProgress(.70 + p * .20)), 45000);
      if (world.garage.prepared.size !== 3) throw new Error('Car preparation incomplete');
      track(Promise.resolve());
      window.__mc = { world, director };
    } catch (e) {
      console.warn('3D disabled', e);
      world = null; director = null;
    }
  }
  if (!world) body.classList.add('no-webgl');

  // Optional media has a deadline. The car preparation gate above must finish first.
  await withTimeout(Promise.all(tasks), 12000);
  if (world && director) {
    // Draw the actual car shots into the compositor before entry, including their textures.
    for (const p of [.27, .45]) world.render(director.update(director.tops[1] + director.heights[1] * p, 0));
    world.render(director.update(0, 0));
  }
  const images = (await withTimeout(imagesP, 10)) || [];
  const cues = await cuesP;
  await finishProgress();
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
  $('#hero').focus({ preventScroll: true });
  replaying = false;
  return true;
}

function begin() {
  body.classList.remove('is-loading', 'is-intro');
  setInert(false);
  $('#loader').setAttribute('aria-hidden', 'true');
  $('#hero').focus({ preventScroll: true });
  if (audio.enabled) loadLoop();
  director?.measure();
  // the hero's own reveal, staged after the title sequence
  document.querySelectorAll('.hero .split, .hero .reveal').forEach((el, i) => setTimeout(() => el.classList.add('is-in'), 350 + i * 160));
  if (!reducedMotion) {
    manualScroll = createManualScroll(() => lenis);
    lenis = new Lenis({
      lerp: .045, wheelMultiplier: .85, touchMultiplier: 1.1, smoothWheel: true,
      virtualScroll: manualScroll.virtualScroll,
    });
    lenis.on('scroll', manualScroll.onScroll);
    addEventListener('touchcancel', manualScroll.reset, { passive: true });
    addEventListener('blur', manualScroll.reset);
    document.addEventListener('visibilitychange', manualScroll.reset);
  }
  observeReveals();
  initChapterRail();
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
function loadCars(onProgress) {
  if (world) return carsP ||= world.garage.loadAll(onProgress);
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
function menuInert(on) { document.querySelectorAll('main, footer, .tour, .chapter-rail, .gallery-labels').forEach((el) => { el.inert = on; }); }
function closeMenu() { menu.classList.remove('is-open'); menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.textContent = 'Menu'; menuInert(false); if (!body.matches('.is-loading, .is-intro, .viewer-open')) lenis?.start(); }
menuBtn.addEventListener('click', () => {
  const open = !menu.classList.contains('is-open');
  menu.classList.toggle('is-open', open);
  menuInert(open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.textContent = open ? 'Close' : 'Menu';
  if (open) { lenis?.stop(); menu.querySelector('a').focus(); }
  else lenis?.start();
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('is-open')) { closeMenu(); menuBtn.focus(); } });
menu.addEventListener('click', e => { if (e.target === menu) { closeMenu(); menuBtn.focus(); } });
$('.hud--top').addEventListener('keydown', e => {
  if (e.key !== 'Tab' || !menu.classList.contains('is-open')) return;
  const first = $('.mark'), last = soundBtn;
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
soundBtn.addEventListener('click', () => setSound(!audio.enabled));
// a keyboard user tabbing into the header brings it back into view
$('.hud--top').addEventListener('focusin', () => body.classList.remove('hud-away'));
matchMedia('(max-width: 860px)').addEventListener('change', () => { if (menu.classList.contains('is-open')) closeMenu(); });
const tour = initTour({ getLenis: () => lenis });
initViewer({ getLenis: () => lenis, onOpen: () => { tour.stop(); closeMenu(); } });

addEventListener('keydown', (e) => {
  if (body.classList.contains('viewer-open')) return;
  if (e.target.closest('input, textarea')) return;
  if (e.key === 'l' || e.key === 'L') { if (world) world.lightsTarget = world.lightsTarget ? 0 : 1; }
  if (e.key === 'm' || e.key === 'M') setSound(!audio.enabled);
});

// ---------- Pointer ----------
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || body.classList.contains('viewer-open')) return;
  world?.setMouse((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
}, { passive: true });
const touchPilot = initTouchPilot({
  isActive: () => !!world && !body.matches('.is-loading, .is-intro, .viewer-open') && director?.state.pilot,
  setMouse: (x, y) => world?.setMouse(x, y),
});

// ---------- Per-frame DOM ----------
const cursor = new Cursor(audio);
const lock = new LockGame(audio);
magnetic();
copyEmail();

const progressEl = $('#readout-bar');
const navLinks = [...document.querySelectorAll('.nav a')];
const mazeTitle = $('.maze__title');
const carName = $('#car-name');
const speedEl = $('#speed');
const launchTitle = $('.launch__title');
const portrait = $('.about__portrait img');
const veil = $('.veil');
const heroEl = $('#hero');
const lockCopy = $('.lock__copy');
let maxScroll = 1;
function measureDom() {
  maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
}

const tmpV = new THREE.Vector3();
const P = { x: 0, y: 0, z: 0 };

let lastChapter = -1;
let lastCar = null;
let lastY = 0;

function domFrame(st, y, dt) {
  const vh = innerHeight;
  veil.style.setProperty('--veil', st.veil.toFixed(3));
  lockCopy.style.opacity = (1 - Math.min(1, Math.max(0, (director.sNow - 5.7) / .12))).toFixed(3);
  // hero copy fades out before it slides under the header
  if (y < vh) heroEl.style.opacity = (1 - Math.min(1, y / (vh * 0.5)) ** 1.5).toFixed(3);

  // chapter readout + nav
  if (st.chapter !== lastChapter) {
    lastChapter = st.chapter;
    const id = director.ids[st.chapter];
    navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${id}` || (id === 'launch' && a.getAttribute('href') === '#garage') || (id === 'maze' && a.getAttribute('href') === '#drone')));
    if (lenis && audio.enabled) audio.play('whoosh', 0.35);
    // pinned headings can sit outside the reveal observer's band after a jump; show them on arrival
    document.querySelectorAll(`#${id} .sticky .split`).forEach((el) => el.classList.add('is-in'));
  }
  body.classList.toggle('is-scrolled', st.chapter >= 6);
  // the header gets out of the way on the way down and comes back on the way up
  const dy = y - lastY;
  if (Math.abs(dy) > 12 || y < 20) {
    lastY = y;
    body.classList.toggle('hud-away', dy > 0 && y > vh * 0.8 && !menu.classList.contains('is-open') && !document.querySelector('.hud--top:focus-within'));
  }
  progressEl.style.setProperty('--progress', Math.min(1, y / maxScroll));

  const at = director.ids[st.chapter];
  mazeTitle.style.opacity = (1 - THREE.MathUtils.smoothstep(director.sNow, 4.03, 4.15)).toFixed(3);

  // garage name plate
  if (at === 'garage' || at === 'launch') {
    const car = director.carAt(y);
    if (car !== lastCar) {
      lastCar = car;
      carName.animate([{ opacity: 0, transform: 'translateY(0.6rem)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.22,1,.36,1)' });
      carName.textContent = car.name;
    }
  }

  // launch
  if (at === 'garage' || at === 'launch') {
    setText(speedEl, String(Math.round(Math.min(1.4, st.speed) * 245)));
    // the line has been said by the time the car is flat out; let the light gates have the frame
    launchTitle.style.opacity = (1 - Math.min(1, Math.max(0, (st.speed - 0.45) / 0.35))).toFixed(3);
  }

  // portrait parallax
  if (st.chapter >= 6) {
    const r = portrait.parentElement.getBoundingClientRect();
    if (r.bottom > 0 && r.top < vh) portrait.style.transform = `translateY(${((r.top + r.height / 2 - vh / 2) / vh) * -8}%)`;
  }

  // The turret chases the drone's projected position.
  if (st.pilot && st.droneVisible) {
    world.drone.group.getWorldPosition(tmpV);
    const p = world.project(tmpV, P);
    if (p) lock.setTarget(p.x, p.y);
  }

  cursor.update(dt);
  lock.update(dt, st.pilot);
  // the 3D turret aims along the reticle's line of sight, out to the drone's depth
  const turretOn = st.pilot && st.droneVisible;
  if (turretOn) world.drone.group.getWorldPosition(tmpV);
  world.turret.update(dt, turretOn, (lock.x / innerWidth) * 2 - 1, -(lock.y / innerHeight) * 2 + 1, turretOn ? world.camera.position.distanceTo(tmpV) : 0, lock.locked);
}

function setText(el, v) { if (el.textContent !== v) el.textContent = v; }

// ---------- Main loop ----------
// The cursor or a horizontal touch drag flies the drone, with inertia and banking.
const pilot = { w: 0, x: 0, y: 0 };
function flyDrone(st, dt) {
  const on = (finePointer || touchPilot.active) && !reducedMotion && !body.classList.contains('viewer-open') && st.pilot;
  pilot.w += ((on ? 1 : 0) - pilot.w) * (1 - Math.exp(-dt * 2.5));
  if (!st.pilot || pilot.w < 0.001) return;
  const k = 1 - Math.exp(-dt * 2.4);
  const px = pilot.x;
  pilot.x += (world.mouse.x * 1.7 - pilot.x) * k;
  pilot.y += (world.mouse.y * 0.75 - pilot.y) * k;
  const weight = pilot.w * (1 - THREE.MathUtils.smoothstep(director.sNow, 5.62, 5.8));
  st.drone[0] += pilot.x * weight;
  st.drone[1] += pilot.y * weight;
  // bank into the turn: a roll about world Z, expressed in the yawed body frame
  const bank = Math.max(-0.5, Math.min(0.5, -(pilot.x - px) / Math.max(dt, 1e-3) * 0.12)) * weight;
  st.dronePitch -= bank * Math.sin(st.droneYaw);
  st.droneRoll += bank * Math.cos(st.droneYaw);
}

// The film follows the scroll through a critically damped spring, so trackpad jitter, touch flicks
// and sudden reversals all arrive at the camera as smooth motion. Jumps of several screens
// (the title replay, a resize) snap instead of sweeping through every chapter.
const follow = { x: null, v: 0 };
function smoothScroll(target, dt) {
  if (follow.x === null || reducedMotion || Math.abs(target - follow.x) > innerHeight * 4) { follow.x = target; follow.v = 0; return target; }
  const w = 8;
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  for (let i = 0; i < n; i++) {
    follow.v += (w * w * (target - follow.x) - 2 * w * follow.v) * h;
    follow.x += follow.v * h;
  }
  return follow.x;
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
    manualScroll?.raf(now);
    const y = smoothScroll(lenis ? lenis.animatedScroll : window.scrollY, dt);
    if (world && director) {
      const st = director.update(y, reducedMotion ? 0 : now / 1000);
      // fast scrolling smears the colour channels a little
      const scrollVelocity = manualScroll?.velocity || lenis?.velocity || 0;
      if (lenis) st.aberration += Math.min(0.0035, Math.abs(scrollVelocity) * 0.00006);
      st.scrollVelocity = scrollVelocity;
      world.gallery.prepare(director.sNow);
      flyDrone(st, dt);
      if (reducedMotion) { st.shake = 0; st.aberration = 0; st.roll = 0; st.speed = 0; st.spin = Math.min(st.spin, 0.2); }
      if (st.fade < 0.999) { world.render(st); world.blank = false; if (!document.hidden) world.adapt(dt); }
      else {
        world.timer.update();
        if (!world.blank) { world.renderer.setRenderTarget(null); world.renderer.clear(); world.blank = true; }
      }
      audio.drive(st, dt);
      st.beat = audio.pulse(dt);
      domFrame(st, y, dt);
    } else {
      const y = window.scrollY;
      progressEl.style.setProperty('--progress', Math.min(1, y / maxScroll));
      cursor.update(dt);
      lock.update(dt);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

let resizeT;
function remeasure() { manualScroll?.reset(); director?.measure(); measureDom(); lenis?.resize(); }
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
