import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const [url = 'http://127.0.0.1:5192/', out = '../portrait-checks'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const report = { url, checks: [], errors: [] };
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const deadline = setTimeout(() => browser.close(), 150000);
function check(name, pass, evidence) {
  report.checks.push({ name, pass: !!pass, evidence });
  if (!pass) throw Error(name + ': ' + JSON.stringify(evidence));
}
async function enter(page) {
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.loader__enter:not([hidden])', { timeout: 60000 });
  await page.click('[data-enter="silent"]');
  await page.waitForTimeout(500); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.matches('.is-loading,.is-intro'));
  await page.waitForTimeout(1200);
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await enter(page);
  for (const [width, height] of [[1440,900],[1280,720],[768,1024],[390,844],[320,568],[844,390]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.locator('.about__portrait img').evaluate(async img => { const box = img.parentElement.getBoundingClientRect(); scrollTo(0, scrollY + box.top - Math.max(16, (innerHeight - box.height) / 2)); await img.decode(); });
    await page.waitForTimeout(1300);
    const layout = await page.evaluate(() => {
      const img = document.querySelector('.about__portrait img'), f = img.parentElement.getBoundingClientRect(), r = img.getBoundingClientRect(), copy = document.querySelector('.about__copy').getBoundingClientRect();
      const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      const left = r.left + (r.width - img.naturalWidth * scale) / 2, top = r.top + (r.height - img.naturalHeight * scale) / 2;
      const face = { left: left + 400*scale, right: left + 710*scale, top: top + 90*scale, bottom: top + 360*scale };
      return { image: [img.naturalWidth,img.naturalHeight], fit: getComputedStyle(img).objectFit, contentTop: top, contentBottom: top + img.naturalHeight*scale, frameTop: f.top, frameBottom: f.bottom, overflow: document.documentElement.scrollWidth > innerWidth, faceCovered: face.left < copy.right && face.right > copy.left && face.top < copy.bottom && face.bottom > copy.top };
    });
    check(`Portrait contains face and drone at ${width}x${height}`, layout.image[0] === 1140 && layout.image[1] === 1066 && layout.fit === 'contain' && layout.contentTop >= layout.frameTop-1 && layout.contentBottom <= layout.frameBottom+1 && !layout.overflow && !layout.faceCovered, layout);
    await page.screenshot({ path: path.join(out, `portrait-${width}x${height}.jpg`), quality: 88 });
  }
  const matte = await page.evaluate(() => {
    const img = document.querySelector('.about__portrait img'), c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img,0,0); const sample = (x,y) => [...ctx.getImageData(x,y,1,1).data];
    return { corner: sample(0,0), wall: sample(1000,400), face: sample(550,250), drone: sample(900,900) };
  });
  check('Photograph has real transparency and intact face/drone', matte.corner[3] === 0 && matte.wall[3] === 0 && matte.face[3] === 255 && matte.drone[3] === 255, matte);
  await page.setViewportSize({ width:1440,height:900 }); await page.waitForTimeout(400);
  await page.evaluate(() => scrollTo(0,1000)); await page.waitForTimeout(1000);
  const scroll = await page.evaluate(() => new Promise(resolve => {
    const start = performance.now(), y0 = scrollY, samples = []; let previous = start, previousY = y0;
    const inputs = setInterval(() => document.documentElement.dispatchEvent(new WheelEvent('wheel', { deltaY:10000, bubbles:true, cancelable:true })), 4);
    setTimeout(() => clearInterval(inputs), 2000);
    function frame(now) {
      samples.push({ dt: now-previous, dy: scrollY-previousY }); previous = now; previousY=scrollY;
      if (now-start < 3000) requestAnimationFrame(frame);
      else resolve({ moved: scrollY-y0, vh:innerHeight, maxFrame:Math.max(...samples.map(x=>Math.abs(x.dy))), backwards:samples.some(x=>x.dy<0), speed: samples.filter(x=>x.dt>4).map(x=>Math.abs(x.dy)/x.dt*1000/innerHeight).sort((a,b)=>a-b).at(-1) });
    } requestAnimationFrame(frame);
  }));
  check('Rapid wheel bursts stay slow and smooth', scroll.moved > 100 && scroll.moved <= scroll.vh*1.02 && scroll.maxFrame < scroll.vh*.04 && !scroll.backwards, scroll);
  await page.evaluate(() => document.documentElement.dispatchEvent(new WheelEvent('wheel', { deltaY:-10000, bubbles:true, cancelable:true })));
  const reverse = await page.evaluate(() => scrollY); await page.waitForTimeout(800);
  check('Reverse wheel responds without a long tail', await page.evaluate(() => scrollY) < reverse);
  await page.close();

  const phone = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
  await enter(phone);
  await phone.evaluate(() => scrollTo(0,1500)); await phone.waitForTimeout(1000);
  const cdp = await phone.context().newCDPSession(phone), y0 = await phone.evaluate(() => scrollY);
  await cdp.send('Input.dispatchTouchEvent',{ type:'touchStart', touchPoints:[{x:195,y:690}] });
  for (let i=1;i<=18;i++) { await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y:690-i*28}]}); await phone.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent',{ type:'touchEnd',touchPoints:[] });
  const release = await phone.evaluate(() => scrollY); await phone.waitForTimeout(900);
  const end = await phone.evaluate(() => scrollY);
  check('Vertical touch scroll is capped with a short release tail', release > y0 && release-y0 < 844*.5 && end-release < 844*.035, { y0,release,end });
  await phone.locator('.menu-btn').focus();
  await phone.locator('.menu-btn').click(); const lockedY=await phone.evaluate(()=>scrollY);
  await cdp.send('Input.dispatchTouchEvent',{ type:'touchStart', touchPoints:[{x:195,y:650}] });
  await cdp.send('Input.dispatchTouchEvent',{ type:'touchMove', touchPoints:[{x:195,y:350}] });
  await cdp.send('Input.dispatchTouchEvent',{ type:'touchEnd',touchPoints:[] });
  await phone.waitForTimeout(500);
  check('Open menu prevents page drift', Math.abs(await phone.evaluate(()=>scrollY)-lockedY)<2);
  await phone.keyboard.press('Escape'); await cdp.detach();
  check('No browser runtime errors', report.errors.length===0, report.errors);
} catch(e) { report.failure=e.message;process.exitCode=1; }
finally { clearTimeout(deadline);fs.writeFileSync(path.join(out,'interactions-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close(); }
