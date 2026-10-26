import assert from 'node:assert/strict';
import { createManualScroll } from '../src/scroll.js';

const RATE = .90; // Viewports per second.
const BURST_PIXELS = 45; // .045 viewport at the fixture's 1000 px height.

// Exercise installed Lenis handlers with a small DOM substitute, without a browser.
class ElementStub extends EventTarget {
  classList = new Set();
  scrollHeight = 30000;
  scrollWidth = 1000;
  constructor(selector = '') { super(); this.selector = selector; this.classList.remove = this.classList.delete; }
  matches(selectors) { return selectors.split(', ').includes(this.selector); }
  hasAttribute(name) { return this.selector === `[${name}]`; }
}
const element = new ElementStub();
class WindowStub extends EventTarget {
  innerHeight = 1000;
  innerWidth = 1000;
  scrollY = 0;
  scrollX = 0;
  matchMedia = () => ({ matches: false });
  quantize = false;
  scrollTo({ top }) { this.scrollY = this.quantize ? Math.round(top) : top; }
}
const browser = new WindowStub();
globalThis.Window = WindowStub;
globalThis.Element = globalThis.HTMLElement = ElementStub;
globalThis.window = browser;
globalThis.document = { documentElement: element };
let callbacks = [];
globalThis.requestAnimationFrame = fn => { callbacks.push(fn); return callbacks.length; };
const { default: Lenis } = await import('lenis');

function fixture({ quantize = false } = {}) {
  browser.scrollY = 5000;
  browser.quantize = quantize;
  callbacks = [];
  let time = 0, lenis, notifiedScroll = browser.scrollY;
  const policy = createManualScroll(() => lenis, { height: () => 1000, now: () => time });
  lenis = new Lenis({ autoResize: false, wheelMultiplier: .55, touchMultiplier: .9, lerp: .045, virtualScroll: policy.virtualScroll });
  lenis.on('scroll', policy.onScroll);
  function event(type, extra = {}) {
    return { type, cancelable: true, ctrlKey: false, defaultPrevented: false,
      composedPath: () => [element, browser], preventDefault() { this.defaultPrevented = true; }, ...extra };
  }
  return {
    lenis, policy,
    get y() { return lenis.animatedScroll; },
    at(value) { time = value; },
    wheel(deltaY = 100000, extra = {}) {
      const e = event('wheel', { deltaX: 0, deltaY, deltaMode: 0, ...extra });
      lenis.virtualScroll.onWheel(e);
      return e;
    },
    touch(type, x = 0, y = 0, count = 1, extra = {}) {
      const e = event(type, { targetTouches: Array.from({ length: count }, () => ({ clientX: x, clientY: y })), changedTouches: [{ clientX: x, clientY: y }], ...extra });
      lenis.virtualScroll[{ touchstart: 'onTouchStart', touchmove: 'onTouchMove', touchend: 'onTouchEnd' }[type]](e);
      return e;
    },
    frame(value) {
      time = value;
      lenis.raf(value);
      policy.raf(value);
      if (browser.scrollY !== notifiedScroll) {
        notifiedScroll = browser.scrollY;
        lenis.onNativeScroll();
      }
      const work = callbacks;
      callbacks = [];
      work.forEach(fn => fn(value));
    },
    drain(start, duration = 2000, hz = 60) {
      for (let i = 1; i <= duration * hz / 1000; i++) this.frame(start + i * 1000 / hz);
    },
    close() { lenis.destroy(); },
  };
}

for (const hz of [30, 60, 120, 240]) {
  const f = fixture({ quantize: true });
  for (let i = 0; i <= hz * 6; i++) {
    f.at(i * 1000 / hz);
    f.wheel();
    f.frame(i * 1000 / hz);
    assert.ok(f.y - 5000 <= i * RATE * 1000 / hz + 1, 'pixel rounding bypasses speed cap');
  }
  const start = f.y;
  for (let i = hz * 6 + 1; i <= hz * 9; i++) {
    f.at(i * 1000 / hz);
    f.wheel();
    f.frame(i * 1000 / hz);
  }
  assert.ok(Math.abs(f.y - start - RATE * 3 * 1000) <= 1, `${hz} Hz rounded positions change sustained speed`);
  f.close();
}

const rates = [];
{
  const f = fixture();
  f.touch('touchstart', 0, 1000);
  f.at(16.5); // An input callback can run just after the frame timestamp was sampled.
  f.touch('touchmove', 0, 900);
  f.frame(16);
  f.frame(32);
  assert.ok(f.y > 5000, 'slightly older frame timestamp drops manual input');
  f.at(33);
  assert.equal(f.touch('touchmove', 0, 800).defaultPrevented, true, 'frame timestamp skew releases touch to native scrolling');
  f.close();
}

for (const frameHz of [30, 60, 120, 240]) {
  for (const inputHz of [30, 60, 120, 240, 1000]) {
    const f = fixture();
    const start = f.y;
    let last = start, steadyStart, input = 0, frame = 0;
    while (frame <= frameHz * 6) {
      if (input / inputHz <= frame / frameHz + 1e-10) {
        f.at(input * 1000 / inputHz);
        assert.equal(f.wheel().defaultPrevented, true);
        input++;
      } else {
        f.frame(frame * 1000 / frameHz);
        assert.ok(f.y - last <= RATE * 1000 / frameHz + 1e-7, `${inputHz}/${frameHz} Hz exceeds frame speed`);
        assert.ok(f.y >= last);
        if (frame === frameHz * 3) steadyStart = f.y;
        last = f.y;
        frame++;
      }
    }
    assert.ok(f.y - start <= RATE * 6 * 1000 + BURST_PIXELS + 1e-7, 'six-second travel exceeds rate plus burst');
    const speed = (f.y - steadyStart) / 3000;
    assert.ok(speed > RATE - .01 && speed <= RATE + 1e-8, `sustained ${inputHz}/${frameHz} Hz speed ${speed}`);
    rates.push(speed);
    f.at(6001);
    f.wheel(-100000);
    const reverse = f.y;
    f.frame(6000 + 1000 / frameHz);
    assert.ok(f.y <= reverse, 'reversal plays old forward travel');
    f.drain(6100);
    assert.ok(f.y >= reverse - BURST_PIXELS - 1e-7, 'reversal mints a new input budget');
    f.close();
  }
}

for (const deltaMode of [0, 1, 2]) {
  const f = fixture();
  const start = f.y;
  for (let i = 0; i < 1000; i++) f.wheel(1e12, { deltaMode });
  f.drain(0);
  assert.ok(f.y - start <= BURST_PIXELS + 1e-7, 'same-time bursts or large wheel modes exceed the burst');
  f.close();
}

{
  const f = fixture();
  const start = f.y;
  f.wheel(10);
  f.drain(0);
  assert.ok(f.y > start + 5.4 && f.y <= start + 5.5, 'wheel sensitivity no longer matches the .55 Lenis multiplier');
  f.close();
}

for (const hz of [30, 60, 120, 240]) {
  const f = fixture();
  f.touch('touchstart', 0, 10000);
  for (let i = 1; i <= hz * 3; i++) {
    f.at(i * 1000 / hz);
    const e = f.touch('touchmove', 0, 10000 - i * 100);
    assert.equal(e.defaultPrevented, true, 'vertical touch moves natively');
    const before = f.y;
    f.frame(i * 1000 / hz);
    assert.ok(f.y - before <= RATE * 1000 / hz + 1e-7);
  }
  const released = f.y;
  assert.equal(f.touch('touchend', 0, 0, 0).defaultPrevented, true);
  for (let i = 0; i < 100; i++) f.touch('touchend', 0, 0, 0);
  f.drain(3000);
  assert.ok(f.y - released <= BURST_PIXELS + 1e-7, 'touchend repeats velocity or exceeds the burst');
  assert.ok(f.y > released, 'touch has no eased release');
  f.close();
}

{
  const f = fixture();
  f.touch('touchstart', 100, 100);
  assert.equal(f.touch('touchmove', 200, 110).defaultPrevented, false, 'horizontal pilot gesture claimed');
  f.drain(0);
  assert.equal(f.y, 5000);
  f.touch('touchend', 0, 0, 0);
  f.touch('touchstart', 100, 100);
  f.touch('touchmove', 100, 50);
  assert.equal(f.touch('touchstart', 100, 50, 2).defaultPrevented, false);
  assert.equal(f.touch('touchmove', 100, 0, 2).defaultPrevented, false);
  assert.equal(f.touch('touchend', 0, 0, 1).defaultPrevented, false);
  assert.equal(f.touch('touchmove', 100, -100, 1).defaultPrevented, false);
  f.drain(2100);
  assert.equal(f.y, 5000, 'pinch or its remaining finger scrolls');
  f.touch('touchend', 0, 0, 0);
  f.touch('touchstart', 100, 100);
  assert.equal(f.touch('touchmove', 100, 0).defaultPrevented, true, 'fresh gesture after pinch lost');
  f.close();
}

{
  const f = fixture();
  f.touch('touchstart', 0, 100);
  assert.equal(f.touch('touchstart', 0, 100, 1, { touches: [{}, {}] }).defaultPrevented, false);
  assert.equal(f.touch('touchmove', 0, 0, 1, { touches: [{}, {}] }).defaultPrevented, false, 'pinch across different elements claimed');
  f.drain(0);
  assert.equal(f.y, 5000);
  f.touch('touchend', 0, 0, 0, { touches: [] });
  f.lenis.isIos = true;
  f.lenis.isTouchOnSelectionHandle = () => true;
  f.touch('touchstart', 0, 100);
  assert.equal(f.touch('touchmove', 0, 0).defaultPrevented, false, 'iOS selection handle claimed');
  f.close();
}

for (const selector of ['[data-lenis-prevent]', '[data-lenis-prevent-wheel]', '[data-lenis-prevent-vertical]', '.nav.is-open', 'video', 'input']) {
  const f = fixture();
  const nested = new ElementStub(selector);
  assert.equal(f.wheel(100, { composedPath: () => [nested, element, browser] }).defaultPrevented, false, selector);
  f.drain(0);
  assert.equal(f.y, 5000);
  f.close();
}

for (const extra of [{ ctrlKey: true }, { deltaX: 1000, deltaY: 0 }, { cancelable: false }, { defaultPrevented: true }, { lenisStopPropagation: true }]) {
  const f = fixture();
  const e = f.wheel(100, extra);
  assert.equal(e.defaultPrevented, !!extra.defaultPrevented);
  f.drain(0);
  assert.equal(f.y, 5000);
  f.close();
}

{
  const f = fixture();
  assert.equal(f.wheel(10000, { deltaX: 100000 }).defaultPrevented, true, 'diagonal wheel bypasses vertical speed cap');
  f.drain(0);
  assert.ok(f.y - 5000 <= BURST_PIXELS + 1e-7);
  f.close();
}

{
  const f = fixture();
  f.lenis.stop();
  assert.equal(f.wheel().defaultPrevented, true, 'stopped page is not locked');
  const menu = new ElementStub('.nav.is-open');
  assert.equal(f.wheel(100, { composedPath: () => [menu, element, browser] }).defaultPrevented, false, 'menu cannot scroll');
  f.lenis.start();
  f.drain(0);
  assert.equal(f.y, 5000, 'stopped input replays on start');
  f.lenis.isLocked = true;
  assert.equal(f.wheel().defaultPrevented, true, 'locked animation accepts manual input');
  f.lenis.isLocked = false;
  f.lenis.reducedMotionMediaQuery.matches = true;
  assert.equal(f.wheel().defaultPrevented, false, 'reduced motion suppresses native input');
  f.drain(2100);
  assert.equal(f.y, 5000);
  f.close();
}

{
  const f = fixture();
  f.touch('touchstart', 0, 1000);
  for (let i = 1; i <= 120; i++) {
    f.at(i * 1000 / 60);
    f.touch('touchmove', 0, 1000 - i * 100);
    f.frame(i * 1000 / 60);
  }
  const before = f.y;
  f.at(2001);
  f.touch('touchmove', 0, -1000);
  f.frame(2017);
  assert.ok(f.y <= before, 'touch reversal plays old forward travel');
  f.policy.reset(); // The touchcancel, blur, visibility and resize handlers share this reset.
  const cancelled = f.y;
  f.drain(2017);
  assert.equal(f.y, cancelled, 'cancelled touch inertia replays');
  f.close();
}

for (const reset of [f => f.policy.reset(), f => f.frame(3600000)]) {
  const f = fixture();
  f.wheel();
  f.frame(16);
  const before = f.y;
  reset(f);
  f.frame(3600017);
  assert.equal(f.y, before, 'pause/background replays pending travel');
  f.at(3600020);
  f.wheel();
  f.drain(3600020);
  assert.ok(f.y - before <= BURST_PIXELS + 1e-7, 'pause creates a large input allowance');
  f.close();
}

{
  const f = fixture();
  f.wheel();
  f.frame(16);
  f.lenis.scrollTo(10000, { duration: .2, easing: t => t });
  f.frame(32);
  f.drain(32, 300);
  assert.equal(f.y, 10000, 'manual limiter intercepts explicit navigation');
  for (let i = 1; i <= 60; i++) {
    f.lenis.scrollTo(10000 + i * 5, { immediate: true });
    f.frame(400 + i * 1000 / 60);
    assert.equal(f.y, 10000 + i * 5, 'manual limiter intercepts Tour');
  }
  f.lenis.scrollTo(0, { immediate: true, force: true });
  f.drain(1500);
  assert.equal(f.y, 0, 'manual travel survives replay');
  f.at(3600);
  f.wheel(-100000);
  f.drain(3600);
  assert.equal(f.y, 0, 'negative boundary exceeded');
  f.close();
}

{
  const f = fixture();
  f.lenis.scrollTo(10000, { duration: 2, easing: t => t });
  f.frame(16);
  f.frame(100);
  const before = f.y;
  f.at(101);
  f.wheel(-100000);
  f.frame(117);
  assert.ok(f.y < before, 'manual input does not interrupt navigation');
  f.drain(117);
  assert.ok(f.y >= before - BURST_PIXELS - 1e-7, 'navigation continues after manual takeover');
  f.lenis.scrollTo('bottom', { immediate: true });
  const end = f.y;
  f.at(2200);
  f.wheel();
  f.drain(2200);
  assert.equal(f.y, end, 'positive boundary exceeded');
  f.close();
}

console.log(`PASS: installed Lenis wheel/touch integration, 20 input/frame-rate combinations, sustained ${Math.min(...rates).toFixed(4)} to ${Math.max(...rates).toFixed(4)} viewport/s. Reverse, ${BURST_PIXELS}px burst, .55 wheel sensitivity, touch release/pinch/pilot, nested controls, locks, reduced motion, pauses, navigation, Tour and replay passed.`);
