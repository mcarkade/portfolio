// Usage: node tools/shoot.mjs <url> <outDir> <w>x<h> <y1,y2,...|s:selector@p,...> [--sound]
// Captures the page at scroll positions (px, or "#id@0.5" = 50% through a section).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [url = 'http://127.0.0.1:5173/', out = 'shots', size = '1440x900', list = '0'] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.loader__enter:not([hidden])', { timeout: 60000 });
await page.click('[data-enter="silent"]');
await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 30000 });
await page.waitForTimeout(1500);
const t0 = Date.now();
for (const item of list.split(',')) {
  let y = Number(item);
  if (item.startsWith('s:')) {
    // director coordinate: section index + progress, e.g. s:4.52
    y = await page.evaluate((v) => { const d = window.__mc.director; const i = Math.floor(v); return d.tops[i] + d.heights[i] * (v - i); }, Number(item.slice(2)));
  } else if (Number.isNaN(y)) {
    const [sel, p] = item.split('@');
    y = await page.evaluate(([sel, p]) => { const el = document.querySelector(sel); return el.offsetTop + (el.offsetHeight - (el.classList.contains('lock') || el.classList.contains('work') || el.classList.contains('about') || el.classList.contains('contact') ? 0 : innerHeight)) * Number(p); }, [sel, p || '0']);
  }
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.mouse.move(w * 0.62, h * 0.4);
  await page.waitForTimeout(2600);
  const name = `${out}/${String(item).replace(/[^a-z0-9@.]/gi, '_')}.png`;
  await page.waitForTimeout(Number(process.env.EXTRA_WAIT || 0));
  await page.screenshot({ path: name });
  console.log('shot', name, Math.round(y));
}
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
console.log('fps', fps);
console.log(logs.slice(0, 25).join('\n'));
await browser.close();
