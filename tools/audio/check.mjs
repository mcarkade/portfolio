import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

const executablePath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5291/audio/CREDITS.md', { timeout: 15000 });
  const result = await page.evaluate(async () => {
    document.body.insertAdjacentHTML('beforeend', '<footer class="footer"><ul class="credits"></ul></footer>');
    const { Audio } = await import('/src/audio.js');
    const audio = new Audio();
    await audio.init();
    const decoded = {};
    for (const file of ['intro.mp3', 'loop.mp3', 'loop.ogg', 'tick.mp3', 'whoosh.mp3', 'lock.mp3']) {
      const buffer = await audio.load(file.split('.')[0], '/audio/' + file);
      if (!buffer) throw new Error('Decode failed: ' + file);
      decoded[file] = { seconds: buffer.duration, frames: buffer.length, rate: buffer.sampleRate };
      if (file.startsWith('loop')) {
        let jump = 0;
        const steps = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const data = buffer.getChannelData(c);
          jump = Math.max(jump, Math.abs(data[0] - data[data.length - 1]));
          for (let i = 1; i < data.length; i += 16) steps.push(Math.abs(data[i] - data[i - 1]));
        }
        steps.sort((a, b) => a - b);
        decoded[file].seamJump = jump;
        decoded[file].interiorStepP99 = steps[Math.floor(steps.length * 0.99)];
        if (jump > decoded[file].interiorStepP99) throw new Error('Browser decode loop boundary: ' + file);
      }
    }
    audio.setEnabled(true);
    await audio.ctx.resume();
    const originalCreate = audio.ctx.createBufferSource.bind(audio.ctx);
    let sources = 0;
    audio.ctx.createBufferSource = () => { sources++; return originalCreate(); };
    const clock = audio.playIntro();
    audio.drive({ speed: 1.4, spin: 1, droneVisible: true }, 1 / 60);
    audio.play('tick');
    const suppressedDuringIntro = sources === 1;
    await new Promise(r => setTimeout(r, 130));
    const clockAdvances = clock() > 0.05;
    audio.stopIntro();
    await new Promise(r => setTimeout(r, 100));
    const introReleased = audio.introSrc === null;
    audio.startLoop(0);
    const firstLoop = audio.loopSrc;
    audio.startLoop();
    const loopSingleton = audio.loopSrc === firstLoop;
    let before = sources;
    audio.play('tick', 0.5);
    audio.play('tick', 0.5);
    const hoverDebounced = sources - before === 1;
    audio.drive({ speed: 1.4, spin: 1, droneVisible: true }, 1 / 60);
    await new Promise(r => setTimeout(r, 300));
    const live = { engine: audio.engine.gain.gain.value, prop: audio.prop.gain.gain.value };
    audio.setEnabled(false);
    await new Promise(r => setTimeout(r, 350));
    const mute = { master: audio.master.gain.value, engine: audio.engine.gain.gain.value, prop: audio.prop.gain.gain.value };
    before = sources;
    audio.play('lock');
    const mutedUiSuppressed = sources === before;
    audio.drive({ speed: NaN, spin: Infinity, droneVisible: true }, 1 / 60);
    const credit = document.querySelector('[data-audio-credit] a')?.getAttribute('href');
    await audio.ctx.close();
    return { decoded, suppressedDuringIntro, clockAdvances, introReleased, loopSingleton, hoverDebounced, mutedUiSuppressed, live, mute, credit };
  });
  result.errors = errors;
  for (const key of ['suppressedDuringIntro', 'clockAdvances', 'introReleased', 'loopSingleton', 'hoverDebounced', 'mutedUiSuppressed']) {
    if (!result[key]) throw new Error('Failed: ' + key);
  }
  if (result.mute.master > 0.1 || result.mute.engine > 0.001 || result.mute.prop > 0.001) throw new Error('Mute did not settle');
  if (errors.length || result.credit !== '/audio/CREDITS.md') throw new Error('Browser error or missing attribution');
  await fs.writeFile(new URL('./browser-qa.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
