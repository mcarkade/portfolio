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
    const w = window.__mc?.world;
    const meshes = root => { let count = 0; root?.traverse(o => { if (o.isMesh && o.geometry?.attributes.position?.count > 0) count++; }); return count; };
    return { value: Number(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')), p: Number(document.getElementById('loader').style.getPropertyValue('--loader-p')), samples: samples.length, maxJump: Math.max(0, ...deltas), backwards: deltas.some(x => x < -.00001), cars: w ? [...w.garage.prepared] : [], ready: w ? [...w.garage.ready] : [], models: w ? { mp45: meshes(w.garage.hero), ...Object.fromEntries(w.garage.slots.map(s => [s.car.id, meshes(s.model)])), drone: meshes(w.drone.group), turret: meshes(w.turret.root), maze: meshes(w.maze.group), robot: meshes(w.maze.robot) } : {}, bytes: performance.getEntriesByType('resource').reduce((n, r) => n + r.transferSize, 0) };
  });
  check('Loader fills smoothly and finishes before Enter', loader.value === 100 && loader.p === 1 && !loader.backwards && loader.maxJump < .085, loader);
  if (!fallback) {
    check('All three cars prepared before Enter', loader.cars.length === 3 && loader.ready.length === 3 && ['mp45', 'rb19', 'w11'].every(x => loader.cars.includes(x) && loader.ready.includes(x)), { prepared: loader.cars, ready: loader.ready });
    check('Every scene model has geometry before Enter', ['mp45', 'rb19', 'w11', 'drone', 'turret', 'maze', 'robot'].every(x => loader.models[x] > 0), loader.models);
  }
  const removed = await page.evaluate(() => ({ elements: document.querySelectorAll('#vision, #vision-box, .vision, .hudframe, [class*="aruco"], [id*="aruco"], [class*="thermal"], [id*="thermal"]').length, labels: /\b(?:ArUco|thermal|person\s+0\.\d+)\b/i.test(document.body.textContent), person: !!window.__mc?.world.person }));
  check('Vision subject and detection UI are removed', removed.elements === 0 && !removed.labels && !removed.person, removed);
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
    const jump = async s => {
      await page.evaluate(s => { const d = window.__mc.director, i = Math.floor(s); scrollTo(0, d.tops[i] + d.heights[i] * (s - i)); }, s);
      await page.waitForTimeout(1700);
    };
    const maze = await page.evaluate(() => {
      const { world: w, director: d } = window.__mc, m = w.maze;
      const saved = structuredClone(d.state), savedS = d.sNow;
      const sample = s => {
        const st = d.update(d.tops[4] + d.heights[4] * (s - 4), 0);
        m.update(st); m.group.updateWorldMatrix(true, true);
        const bounds = [Infinity, -Infinity, Infinity, -Infinity], v = w.camera.position.clone();
        m.robot.traverse(o => {
          if (!o.isMesh) return;
          o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox;
          for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
            m.group.worldToLocal(v.set(x, y, z).applyMatrix4(o.matrixWorld));
            bounds[0] = Math.min(bounds[0], v.x); bounds[1] = Math.max(bounds[1], v.x);
            bounds[2] = Math.min(bounds[2], v.z); bounds[3] = Math.max(bounds[3], v.z);
          }
        });
        return { s, progress: st.mazeProgress, visible: st.mazeVisible && m.group.visible, position: m.robot.position.toArray(), yaw: m.robot.rotation.y, wheels: m.wheels.map(x => x.rotation.x), route: m.routeMaterial.uniforms.uDistance.value, bounds };
      };
      try {
        const steps = Array.from({ length: 81 }, (_, i) => 4.14 + .68 * i / 80);
        const forward = steps.map(sample), reverse = [...steps].reverse().map(sample).reverse();
        return { origin: m.group.position.toArray(), forward, deterministic: JSON.stringify(forward) === JSON.stringify(reverse) };
      } finally { Object.assign(d.state, saved); d.sNow = savedS; m.update(saved); m.group.updateWorldMatrix(true, true); }
    });
    check('Maze robot stays inside its board throughout the route', maze.origin.every((v, i) => Math.abs(v - [0, .006, -3.5][i]) < 1e-9) && maze.forward.every(x => x.visible && x.bounds.every(Number.isFinite) && x.bounds[0] >= -1.155 && x.bounds[1] <= 1.155 && x.bounds[2] >= -1.155 && x.bounds[3] <= 1.155), maze);
    check('Maze advances with scroll and reverses without drift', maze.forward[0].progress < .001 && maze.forward.at(-1).progress > .999 && maze.forward.every((x, i, a) => !i || x.progress > a[i - 1].progress) && new Set(maze.forward.map(x => x.position.join(','))).size > 10 && maze.forward.at(-1).route > maze.forward[0].route && maze.deterministic, { samples: maze.forward.length, start: maze.forward[0], end: maze.forward.at(-1), deterministic: maze.deterministic });
    for (const s of [4.18, 4.46, 4.78]) {
      await jump(s);
      const board = await page.evaluate(() => {
        const w = window.__mc.world;
        const corners = [-1.15, 1.15].flatMap(x => [-1.15, 1.15].map(z => w.project(w.maze.group.localToWorld(w.camera.position.clone().set(x, 0, z)))));
        return { visible: w.maze.group.visible, progress: window.__mc.director.state.mazeProgress, corners, width: innerWidth, height: innerHeight };
      });
      check(`Maze board stays in frame at ${s}`, board.visible && board.corners.every(p => p && p.x > 0 && p.x < board.width && p.y > 0 && p.y < board.height), board);
      if (s === 4.46) await shot('maze');
    }
    for (const s of [4.94, 4.99, 5.03, 5.08]) {
      await jump(s); await shot(`iris-${s}`);
      const effect = await page.evaluate(() => ({ iris: window.__mc.world.final.uniforms.uIris.value, state: window.__mc.director.state.iris }));
      check(`${reduced ? 'Reduced motion suppresses' : 'Maze handoff drives'} iris at ${s}`, (reduced ? effect.iris === 0 : Math.abs(effect.iris - effect.state) < 1e-6 && (s < 5.06 ? effect.iris > 0 : effect.iris === 0)), effect);
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
    for (const s of [5.9, 5.96, 6.02, 6.08]) {
      await jump(s); await shot(`aperture-${s}`);
      const effect = await page.evaluate(() => ({ iris: window.__mc.world.final.uniforms.uIris.value, state: window.__mc.director.state.iris }));
      check(`${reduced ? 'Reduced motion suppresses' : 'Lens dive drives'} aperture at ${s}`, reduced ? effect.iris === 0 : Math.abs(effect.iris - effect.state) < 1e-6 && ([5.96, 6.02].includes(s) ? effect.iris > 0 : effect.iris === 0), effect);
    }
    const dive = await page.evaluate(() => {
      const d = window.__mc.director, saved = structuredClone(d.state), savedS = d.sNow;
      try { return [5.81, 5.9, 5.95, 5.99].map(s => { const st = d.update(d.tops[5] + d.heights[5] * (s - 5), 0); return { s, fade: st.fade, iris: st.iris, pilot: st.pilot }; }); }
      finally { Object.assign(d.state, saved); d.sNow = savedS; }
    });
    check('Lens dive closes its aperture without fade or pilot input', dive.every(x => x.fade === 0 && !x.pilot && (x.s < 5.94 ? x.iris === 0 : x.iris > 0)), dive);
    for (const s of [6.08, 6.225, 6.45, 6.675, 6.9]) {
      await jump(s);
      const panels = await page.evaluate(() => window.__mc.world.gallery.panels.map(x => ({ name: x.link.dataset.gallery, playing: x.playing, paused: x.video?.paused ?? true })));
      check(`At most one focused video at ${s}`, panels.filter(x => x.playing && !x.paused).length <= 1, panels);
      if ([6.08, 6.45, 6.9].includes(s)) await shot(`gallery-${s}`);
    }
    const links = page.locator('.gallery-access [data-gallery]');
    const projects = await links.evaluateAll(els => els.map(el => el.dataset.gallery));
    check('All five projects remain available', projects.length === 5 && ['Multiroads', 'Counter-drone turret', 'Meshmerize', 'Reaper', 'NXP Cup'].every(x => projects.includes(x)), projects);
    check('Gallery has five panels and no ThetaShift project', await page.evaluate(() => window.__mc.world.gallery.panels.length === 5 && ![...document.querySelectorAll('[data-gallery]')].some(el => /theta\s*shift/i.test(el.dataset.gallery))));
    for (let i = 0; i < projects.length; i++) {
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
