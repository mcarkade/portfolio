import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
await page.waitForSelector('.loader__enter:not([hidden])', { timeout: 60000 });
await page.click('[data-enter="silent"]');
await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 30000 });
await page.waitForTimeout(1500);
for (const v of [3.5, 4.36]) {
  const y = await page.evaluate((v) => { const d = window.__mc.director; const i = Math.floor(v); return d.tops[i] + d.heights[i] * (v - i); }, v);
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.mouse.move(890, 360);
  await page.waitForTimeout(2600);
  console.log(v, await page.evaluate(() => { const h = document.querySelector('#garage .title'); const s = h.querySelector('.w > span'); const head = document.querySelector('.garage__head'); const r = h.getBoundingClientRect(); return [h.className, Math.round(r.top), getComputedStyle(s).transform, getComputedStyle(head).opacity, getComputedStyle(h).opacity, getComputedStyle(h).color, getComputedStyle(h).visibility]; }));
}
await page.screenshot({ path: 'C:/Users/Abhinav/AppData/Local/Temp/mcs/probe2.png', clip: { x: 0, y: 100, width: 800, height: 220 } });
await browser.close();
