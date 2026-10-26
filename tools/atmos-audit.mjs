import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [mode = 'perf', out = '../atmos-shots/current'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
// Pin the comparison shader to the checkout's original parent, even after committing.
const baselineSource = mode === 'paired' ? execFileSync('git', ['show', '09be043:src/world/world.js'], { encoding: 'utf8' }) : null;
const baselineShader = baselineSource ? new Function(`return (${baselineSource.match(/const FinalShader = ([\s\S]*?\r?\n});/)[1]})`)() : null;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const deadline = setTimeout(() => { console.error('Audit exceeded 180 seconds'); browser.close(); }, 180000);
try {
  const mobile = mode === 'mobile';
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: mobile || mode === 'dpr2' ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 600)); });
  if (mode === 'reference') {
    await page.goto('https://activetheory.net', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(12000);
    console.log((await page.locator('body').innerText()).slice(0, 3000));
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(300 + i * 130, 250 + Math.sin(i) * 200, { steps: 12 });
      if (i > 2) await page.mouse.wheel(0, 350);
      await page.waitForTimeout(180);
      await page.screenshot({ path: `${out}/reference-${i}.png` });
    }
  } else {
    await page.goto('http://127.0.0.1:5186/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('.loader__enter:not([hidden])', { timeout: 60000 });
    await page.click('[data-enter="silent"]');
    await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 30000 });
    if (mobile) { await page.evaluate(() => scrollTo(0, innerHeight * 3)); await page.waitForTimeout(1000); }
    await page.waitForFunction(() => window.__mc?.world.garage.loaded === 3, null, { timeout: 60000 });
    const adapter = await page.evaluate(mode => {
      const w = window.__mc.world;
      if (mode !== 'fps') w.adapt = () => {};
      const gl = w.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), dpr: w.renderer.getPixelRatio(), bloom: !!w.bloom, mirror: !!w.reflector };
    }, mode);
    const results = [];
    if (mode === 'paired') await page.evaluate(base => {
      const w = window.__mc.world;
      const floor = w.floor.material.clone();
      floor.onBeforeCompile = () => {};
      floor.color.setHex(0x080809); floor.roughness = .5; floor.metalness = 0; floor.envMapIntensity = .12;
      window.__atmosPair = { floor, currentFloor: w.floor.material, currentPost: w.final.material,
        originalPost: new w.final.material.constructor({ uniforms: w.final.uniforms, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader }) };
    }, baselineShader);
    for (const s of (['perf', 'paired', 'fps'].includes(mode) ? [0.05, 1.3, 3.5, 4.15, 4.62, 5.5] : [0.05, 1.3, 3.5, 4.015, 4.15, 4.72, 5.5])) {
      await page.evaluate(s => { const d = window.__mc.director, i = Math.floor(s); scrollTo(0, d.tops[i] + d.heights[i] * (s - i)); }, s);
      await page.mouse.move(893, 360);
      await page.waitForTimeout(2800);
      if (mode === 'fps') {
        const pacing = await page.evaluate(() => new Promise(resolve => {
          const ticks = []; let last = performance.now(); const start = last;
          const frame = now => { ticks.push(now-last); last=now; if(ticks.length<200) requestAnimationFrame(frame);
            else { ticks.sort((a,b)=>a-b); const w=window.__mc.world; resolve({fps:200000/(now-start),medianMs:ticks[100],p95Ms:ticks[190],dpr:w.renderer.getPixelRatio(),bloom:!!w.bloom,mirror:!!w.reflector}); } };
          requestAnimationFrame(frame);
        }));
        results.push({s,...pacing}); console.log(JSON.stringify(results.at(-1))); continue;
      }
      if (!['perf', 'paired'].includes(mode)) {
        await page.screenshot({ path: `${out}/${s}.png` });
        results.push(await page.evaluate(() => {
          const { world: w, director: d } = window.__mc;
          return { s: d.sNow, quality: w.quality, explode: d.state.explode, carExplode: d.state.carExplode,
            cars: [...w.garage.ready], fluid: w.fluid.enabled, transition: w.final.uniforms.uTransition.value,
            dustTime: w.dust.material.uniforms.uTime.value, ring: w.heroType.glass.visible,
            hero: w.heroType.plane.visible, h1: document.querySelector('h1').textContent,
            overflow: document.documentElement.scrollWidth > innerWidth, lock: document.querySelector('#lock-state').textContent,
            mirror: !!w.reflector, bloom: !!w.bloom };
        }));
        continue;
      }
      for (const variant of (mode === 'paired' ? ['base', 'new', 'new', 'base', 'base', 'new'] : ['new'])) {
      const timing = await page.evaluate(variant => new Promise(resolve => {
        const w = window.__mc.world, gl = w.renderer.getContext();
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const original = w.composer.render;
        const samples = [], pending = [], cpu = [];
        let frames = 0;
        const started = performance.now();
        w.composer.render = function (...args) {
          const pair = window.__atmosPair;
          if (pair) {
            const base = variant === 'base';
            w.floor.material = base ? pair.floor : pair.currentFloor;
            w.final.material = base ? pair.originalPost : pair.currentPost;
            w.atmosphere.back.visible = !base;
            w.heroType.plane.visible = w.heroType.glass.visible = !base && window.__mc.director.state.heroType > .001;
            if (base) { w.scene.fog.color.setHex(0); w.spot.color.setHex(0xfff1e2); }
          }
          const t = performance.now();
          while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
            const q = pending.shift();
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(q);
          }
          const q = ext && frames >= 12 && frames < 112 ? gl.createQuery() : null;
          if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
          original.apply(this, args);
          if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
          cpu.push(performance.now() - t);
          frames++;
          if (frames >= 137 || performance.now() - started > 12000) {
            w.composer.render = original;
            pending.forEach(q => gl.deleteQuery(q));
            const stats = a => { a.sort((a,b) => a-b); return { median: a[a.length >> 1] ?? null, p95: a[Math.floor(a.length * .95)] ?? null, n: a.length }; };
            resolve({ gpuMs: stats(samples), cpuSubmitMs: stats(cpu), fps: frames * 1000 / (performance.now() - started) });
          }
        };
      }), variant);
      results.push({ s, variant, ...timing });
      console.log(JSON.stringify(results.at(-1)));
      }
    }
    let interaction = null;
    if (!['perf', 'paired', 'fps'].includes(mode)) {
      await page.mouse.move(110, 180);
      await page.waitForTimeout(900);
      await page.mouse.move(1260, 650, { steps: 6 });
      const early = await page.evaluate(() => ({ mouse: window.__mc.world.mouse.x, smooth: window.__mc.world.mouseSmooth.x, flow: window.__mc.world.final.uniforms.uFlowStrength.value }));
      await page.waitForTimeout(1400);
      const late = await page.evaluate(() => ({ mouse: window.__mc.world.mouse.x, smooth: window.__mc.world.mouseSmooth.x, glError: window.__mc.world.renderer.getContext().getError() }));
      const reversible = await page.evaluate(() => {
        const d = window.__mc.director;
        const a = JSON.stringify(d.sample(4.015)); d.sample(5.5); return a === JSON.stringify(d.sample(4.015));
      });
      interaction = { early, late, reversible };
      if (late.glError || !reversible) errors.push('GL state or reversible director check failed');
      if (mode === 'reduced' && results.some(r => r.dustTime !== 0 || r.fluid || r.transition !== 0)) errors.push('Reduced motion check failed');
      if (results.some(r => r.overflow || r.cars.length !== 3)) errors.push('Layout or car loading check failed');
    }
    fs.writeFileSync(`${out}/performance.json`, JSON.stringify({ adapter, results, interaction, errors }, null, 2));
    console.log(adapter);
  }
  console.log('errors', errors);
  if (errors.length) process.exitCode = 1;
} finally { clearTimeout(deadline); await browser.close(); }
