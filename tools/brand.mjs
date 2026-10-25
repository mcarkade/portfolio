// Renders icons and the OG image from tools/brand.html (needs the dev server on :5173).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1300 } });
await page.goto('http://127.0.0.1:5173/tools/brand.html', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.locator('#icon').screenshot({ path: 'tools/.icon-512.png' });
await page.locator('#og').screenshot({ path: 'public/og.jpg', type: 'jpeg', quality: 88 });
await browser.close();
