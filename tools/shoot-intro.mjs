// Captures the title sequence at fixed times: node tools/shoot-intro.mjs <outDir> [w]x[h]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [out = 'shots', size = '1440x900'] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
await page.waitForSelector('.loader__enter:not([hidden])', { timeout: 60000 });
await page.screenshot({ path: `${out}/loader.png` });
await page.click('[data-enter="silent"]');
const t0 = Date.now();
for (const t of [0.6, 1.6, 2.6, 3.5, 4.2, 4.55, 5.2, 6.2]) {
  const wait = t * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/intro-${t}.png` });
}
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/after.png` });
await browser.close();
