// Run against a built preview or published URL. Exercises visible navigation and overlay recovery.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const [url = 'http://127.0.0.1:5192/', out = '../navigation-checks'] = process.argv.slice(2);
const chapters = [['garage', 'Multiroads'], ['drone', 'Drone'], ['work', 'Work'], ['about', 'About'], ['contact', 'Contact']];
const report = { url, checks: [], errors: [], failures: [], shots: [] };
fs.mkdirSync(out, { recursive: true });
const started = Date.now();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', timeout: 30000, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let expired = false;
const deadline = setTimeout(() => { expired = true; browser.close().catch(() => {}); }, Math.max(1, 180000 - (Date.now() - started)));
let viewport;
function check(name, pass, evidence) {
  report.checks.push({ viewport, name, pass: !!pass, evidence });
  if (!pass) throw Error(name + ': ' + JSON.stringify(evidence));
}

async function layout(page, name) {
  await page.locator('.chapter-rail > a').first().focus();
  await page.waitForTimeout(350);
  const evidence = await page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const visible = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const links = [...document.querySelectorAll('.chapter-rail > a')].map(el => {
      const label = el.querySelector('span'), box = rect(el), textBox = rect(label), style = getComputedStyle(label);
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { href: el.getAttribute('href'), label: label.innerText.trim(), visible: visible(el) && visible(label), font: parseFloat(style.fontSize), box, textBox, hit: hit?.closest('.chapter-rail > a') === el };
    });
    const tour = [...document.querySelectorAll('.tour button')].filter(visible).map(rect);
    return { links, tour, width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .5;
  check(`${name}: five readable labels and 44px targets`, evidence.links.length === 5 && !evidence.overflow && evidence.links.every((x, i) => x.href === `#${chapters[i][0]}` && x.label === chapters[i][1] && x.visible && x.hit && x.font >= 11 && x.box.width >= 43.5 && x.box.height >= 43.5 && x.box.x >= 0 && x.box.y >= 0 && x.box.x + x.box.width <= evidence.width + .5 && x.box.y + x.box.height <= evidence.height + .5 && x.textBox.x >= 0 && x.textBox.x + x.textBox.width <= evidence.width + .5), evidence);
  const targets = [...evidence.links.map(x => x.box), ...evidence.tour];
  check(`${name}: navigation targets and Tour do not overlap`, !targets.some((box, i) => targets.slice(i + 1).some(other => overlap(box, other))), { targets });
}

async function arrival(page, id, name) {
  await page.waitForFunction(id => {
    const section = document.getElementById(id), current = document.querySelectorAll('.chapter-rail a[aria-current]');
    const target = Math.min(section.getBoundingClientRect().top + scrollY, document.documentElement.scrollHeight - innerHeight);
    return location.hash === `#${id}` && Math.abs(scrollY - target) < 4 && current.length === 1 && current[0].getAttribute('href') === `#${id}`;
  }, id, { timeout: 9000 });
  const evidence = await page.evaluate(() => ({ hash: location.hash, scroll: scrollY, current: document.querySelector('.chapter-rail a[aria-current]')?.getAttribute('href'), focus: document.activeElement.id, menu: document.getElementById('menu').classList.contains('is-open'), inert: document.querySelector('main').inert || document.querySelector('.chapter-rail').inert, stopped: document.documentElement.classList.contains('lenis-stopped') }));
  check(`${name}: reaches ${id} with active state, hash and focus`, evidence.focus === id && !evidence.menu && !evidence.inert && !evidence.stopped, evidence);
}

async function navigate(page, id, name) {
  await page.locator(`.chapter-rail a[href="#${id}"]`).click();
  await arrival(page, id, name);
}

try {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
    if (expired) break;
    viewport = `${width}x${height}`;
    const phone = width < 860;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, reducedMotion: 'no-preference' });
    page.setDefaultTimeout(9000);
    page.on('pageerror', e => report.errors.push({ viewport: `${width}x${height}`, message: e.message }));
    page.on('console', m => { if (m.type() === 'error') report.errors.push({ viewport: `${width}x${height}`, message: m.text().slice(0, 500) }); });
    const shot = async name => {
      if (width === 320) return;
      const file = `navigation-${width}x${height}-${name}.jpg`;
      await page.screenshot({ path: path.join(out, file), quality: 85, timeout: 10000 });
      report.shots.push(file);
    };
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('.loader__enter:not([hidden])', { timeout: 60000 });
      await page.click('[data-enter="silent"]');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.body.matches('.is-loading, .is-intro'), null, { timeout: 15000 });
      await page.waitForFunction(() => !document.getElementById('intro').classList.contains('is-on'));
      await layout(page, 'Hero');
      await shot('hero');
      await page.locator('.tour__play').click();
      await page.waitForTimeout(100);
      check('Tour starts before manual navigation', await page.locator('.tour__play').getAttribute('aria-pressed') === 'true');
      for (const [id] of chapters) {
        await navigate(page, id, 'Click');
        await layout(page, id);
        if (id === 'about') await shot('about');
      }
      check('Manual chapter navigation stops Tour', await page.locator('.tour__play').getAttribute('aria-pressed') === 'false');

      await page.locator('.chapter-rail a').first().focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const el = document.activeElement, style = getComputedStyle(el);
        return { href: el.getAttribute('href'), visible: el.matches(':focus-visible'), outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      check('Keyboard Tab reaches Work with a visible focus outline', focus.href === '#work' && focus.visible && focus.outline !== 'none' && focus.width >= 1, focus);
      await page.keyboard.press('Enter');
      await arrival(page, 'work', 'Keyboard Enter');
      await page.goBack({ waitUntil: 'commit', timeout: 9000 });
      await arrival(page, 'contact', 'History Back');
      await page.goForward({ waitUntil: 'commit', timeout: 9000 });
      await arrival(page, 'work', 'History Forward');

      if (phone) {
        const menuButton = page.locator('.menu-btn');
        await menuButton.focus();
        await menuButton.click();
        await page.waitForSelector('#menu.is-open');
        check('Open mobile Menu hides and disables the rail', await page.locator('.chapter-rail').isHidden() && await page.locator('.chapter-rail').evaluate(el => el.inert));
        await page.keyboard.press('Escape');
        check('Escape restores Menu focus and clears page locks', await menuButton.evaluate(el => document.activeElement === el && el.getAttribute('aria-expanded') === 'false' && !document.querySelector('main').inert && !document.querySelector('.chapter-rail').inert && !document.documentElement.classList.contains('lenis-stopped')));
        await layout(page, 'After Menu Escape');
        await menuButton.click();
        await page.locator('#menu a[href="#about"]').click();
        await arrival(page, 'about', 'Mobile Menu link');
        const start = await page.evaluate(() => scrollY);
        await page.mouse.wheel(0, 500);
        await page.waitForFunction(y => scrollY > y + 3, start, { timeout: 3000 });
        check('Closing mobile Menu restores manual page scroll', await page.evaluate(y => scrollY > y + 3, start));
        await navigate(page, 'work', 'After Menu');
      }

      const project = page.locator('.gallery-access a[aria-haspopup="dialog"]').first();
      await project.focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.viewer[open]');
      check('Project viewer hides rail and keeps keyboard focus inside', await page.locator('.chapter-rail').isHidden() && await page.locator('.viewer').evaluate(el => el.contains(document.activeElement)));
      const lockedY = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(150);
      check('Project viewer prevents background page drift', Math.abs(await page.evaluate(() => scrollY) - lockedY) < 2);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.viewer').open && !document.body.classList.contains('viewer-open'));
      await layout(page, 'After viewer Escape');
      await navigate(page, 'about', 'After viewer');
      check('No runtime errors at this viewport', !report.errors.some(e => e.viewport === viewport));
    } catch (e) {
      report.failures.push({ viewport, message: e.message });
      process.exitCode = 1;
    } finally { await page.close().catch(() => {}); }
  }
} catch (e) { report.failures.push({ viewport, message: e.message }); process.exitCode = 1; }
finally {
  clearTimeout(deadline);
  if (expired) { report.failures.push({ message: 'Navigation checks exceeded the 180 second deadline' }); process.exitCode = 1; }
  fs.writeFileSync(path.join(out, 'navigation-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
