// Real-browser regression checks. Run against a built preview or the published URL.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const [url = 'http://127.0.0.1:5192/', out = '../verification', mode = 'desktop'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const mobile = mode === 'phone', reduced = mode === 'reduced', fallback = mode === 'fallback';
const report = { url, mode, checks: [], errors: [], warnings: [], shots: [] };
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const deadline = setTimeout(() => browser.close(), 180000);
const check = (name, pass, evidence) => { report.checks.push({ name, pass: !!pass, evidence }); if (!pass) throw new Error(name + ': ' + JSON.stringify(evidence)); };
try {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); else if (m.type() === 'warning') report.warnings.push(m.text().slice(0, 350)); });
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  if (fallback) await page.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : get.call(this, type, ...args); }; });
  await page.addInitScript(() => {
    window.__loadingSamples = [];
    const sample = () => { const el = document.getElementById('loader'); if (el) window.__loadingSamples.push({ t: performance.now(), p: Number(el.style.getPropertyValue('--loader-p')) }); if (window.__loadingSamples.length < 5000 && !document.querySelector('.loader__enter:not([hidden])')) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  const started = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.loader__enter:not([hidden])', { timeout: 60000 });
  report.entryMs = Date.now() - started;
  const loader = await page.evaluate(() => {
    const samples = window.__loadingSamples.map(x => x.p), deltas = samples.slice(1).map((x, i) => x - samples[i]);
    return { value: Number(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')), p: Number(document.getElementById('loader').style.getPropertyValue('--loader-p')), samples: samples.length, maxJump: Math.max(0, ...deltas), backwards: deltas.some(x => x < -.00001), cars: window.__mc ? [...window.__mc.world.garage.prepared] : [], bytes: performance.getEntriesByType('resource').reduce((n, r) => n + r.transferSize, 0) };
  });
  check('Loader fills smoothly and finishes before Enter', loader.value === 100 && loader.p === 1 && !loader.backwards && loader.maxJump < .085, loader);
  if (!fallback) check('All three cars ready before Enter', ['mp45', 'rb19', 'w11'].every(x => loader.cars.includes(x)), loader.cars);
  await page.click('[data-enter="silent"]');
  if (!reduced) { await page.waitForTimeout(1000); await page.keyboard.press('Escape'); }
  await page.waitForFunction(() => !document.body.matches('.is-loading, .is-intro'), null, { timeout: 20000 });
  await page.waitForTimeout(1400);
  const shot = async name => { await page.screenshot({ path: path.join(out, `${mode}-${name}.jpg`), quality: 85 }); report.shots.push(name); };
  await shot('hero');
  check('Page fits viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (!fallback) {
    const opening = await page.evaluate(() => { const s = window.__mc.director.state; return { shake: s.shake, roll: s.roll, cars: window.__mc.world.garage.ready.size }; });
    check('Opening remains steady', opening.shake === 0 && opening.roll === 0, opening);
    const jump = async (s, pinned = false) => {
      await page.evaluate(([s, pinned]) => { const d = window.__mc.director, i = Math.floor(s); scrollTo(0, d.tops[i] + (d.heights[i] - (pinned ? innerHeight : 0)) * (s - i)); }, [s, pinned]);
      await page.waitForTimeout(1700);
    };
    for (const p of [.28, .45, .64]) {
      await jump(4 + p, true);
      const person = await page.evaluate(() => { const w = window.__mc.world; const head = w.person.children.at(-1).getWorldPosition(w.camera.position.clone()); const foot = w.person.position.clone(); foot.y = .05; return { head: w.project(head), foot: w.project(foot), h: innerHeight, width: innerWidth }; });
      check(`Thermal subject stays visible at ${p}`, person.head && person.foot && person.head.y > 0 && person.foot.y < person.h && person.head.x > 0 && person.head.x < person.width, person);
      if (p === .45) await shot('thermal');
    }
    await jump(5.4);
    if (mobile) {
      const cdp = await page.context().newCDPSession(page);
      for (const [type, x] of [['touchStart', 130], ['touchMove', 200], ['touchMove', 280], ['touchEnd', 280]]) {
        await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 360 }] });
        await page.waitForTimeout(100);
      }
      await cdp.detach();
    } else await page.mouse.move(1100, 350, { steps: 12 });
    await page.waitForTimeout(700);
    await shot('lock');
    check('Game reports a readable state', ['Locked', 'Escaped'].includes(await page.locator('#lock-time').innerText()));
    for (const s of [5.88, 5.95, 6.02]) {
      await jump(s); await shot(`iris-${s}`);
      if (reduced) check(`Reduced motion suppresses iris at ${s}`, await page.evaluate(() => window.__mc.world.final.uniforms.uIris.value === 0));
    }
    const dive = await page.evaluate(() => { const d = window.__mc.director; return [5.8, 5.88, 5.95, 5.99].map(s => { const st = d.update(d.tops[5] + d.heights[5] * (s - 5), 0); return { s, fade: st.fade, iris: st.iris, pilot: st.pilot }; }); });
    check('Lens dive has no leftover fade or pilot input', dive.every(x => x.fade === 0 && !x.pilot), dive);
    for (const s of [6.04, 6.18, 6.36, 6.54, 6.72, 6.9]) {
      await jump(s);
      const panels = await page.evaluate(() => window.__mc.world.gallery.panels.map(x => ({ name: x.link.dataset.gallery, playing: x.playing, paused: x.video?.paused ?? true })));
      check(`At most one focused video at ${s}`, panels.filter(x => x.playing && !x.paused).length <= 1, panels);
      if ([6.04, 6.54, 6.9].includes(s)) await shot(`gallery-${s}`);
    }
    const links = page.locator('.gallery-access [data-gallery]');
    check('All six projects remain available', await links.count() === 6);
    for (let i = 0; i < 6; i++) {
      if ((await links.nth(i).getAttribute('href')).startsWith('#')) continue;
      await links.nth(i).focus();
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.viewer[open]');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.viewer').open);
    }
    await jump(7.2); await shot('about');
    if (!reduced) {
      await jump(0);
      await page.locator('.tour__play').click();
      await page.waitForTimeout(1200);
      check('Tour advances', await page.evaluate(() => scrollY > 30));
      await page.locator('.tour__speed').click();
      check('Tour speed toggles', await page.locator('.tour__speed').getAttribute('aria-pressed') === 'true');
      await page.mouse.wheel(0, 50);
      check('Manual input stops Tour', await page.locator('.tour__play').getAttribute('aria-pressed') === 'false');
      await page.locator('.mark').evaluate(el => el.click());
      await page.waitForTimeout(800);
      check('Logo replays intro', await page.evaluate(() => document.body.classList.contains('is-intro')));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.body.classList.contains('is-intro'));
      check('Replay restores focus and scroll', await page.evaluate(() => scrollY < 2 && !document.querySelector('main').inert));
    } else check('Reduced motion hides Tour', await page.locator('.tour').isHidden());
  }
  if (mobile) {
    await page.locator('.menu-btn').click();
    await page.locator('#menu a[href="#contact"]').click();
    await page.waitForTimeout(2600);
    check('Phone menu closes and reaches Contact', await page.evaluate(() => !document.getElementById('menu').classList.contains('is-open') && location.hash === '#contact'));
    await shot('contact');
  }
  await page.locator('.sound').evaluate(el => el.click());
  check('Sound toggle works', await page.locator('.sound').getAttribute('aria-pressed') === 'true');
  await page.locator('.sound').evaluate(el => el.click());
  check('No runtime or network errors', report.errors.length === 0, report.errors);
} catch (e) { report.failure = e.message; process.exitCode = 1; }
finally {
  clearTimeout(deadline);
  fs.writeFileSync(path.join(out, `${mode}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
