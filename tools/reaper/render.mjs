// Run from the portfolio checkout: node tools/reaper/render.mjs
// Uses the project's Three.js and playwright-core; install sharp in the external scratch folder.
// Screenshots are supersampled on the same Chrome D3D11 backend as tools/shoot.mjs.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = 'C:/Abhinav/Projects/_scratch/reaper';
const compareRaw = process.argv.includes('--raw');
const noShadows = process.argv.includes('--no-shadows');
const diagnostic = compareRaw || noShadows;
const prefix = [compareRaw && 'raw',noShadows && 'no-shadows'].filter(Boolean).join('-');
const requireScratch = createRequire(`${scratch}/package.json`);
const sharp = (await import(pathToFileURL(requireScratch.resolve('sharp')).href)).default;
await mkdir(`${root}/public/media`, { recursive: true });
await mkdir(scratch, { recursive: true });
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (pathname === '/__reaper-raw.glb') {
    res.setHeader('Content-Type','model/gltf-binary');
    res.end(await readFile(`${scratch}/reaper-raw.glb`));
    return;
  }
  const filename = path.resolve(root, `.${pathname}`);
  if (!filename.startsWith(path.resolve(root) + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(filename);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' }[path.extname(filename)];
    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    timeout: 60000,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const reports = {};
  for (const [view, width, height, filename] of [
    ['hero', 1600, 1000, 'reaper.webp'],
    ['top', 1600, 1200, 'reaper-top.webp'],
  ]) {
    if (diagnostic && view !== 'hero') continue;
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/reaper/studio.html?view=${view}${compareRaw ? '&raw=1' : ''}${noShadows ? '&shadows=0' : ''}`, {
      waitUntil: 'load', timeout: 60000,
    });
    await page.waitForFunction(() => window.reaperReady || window.reaperError, null, { timeout: 90000 });
    const result = await page.evaluate(() => ({ error: window.reaperError, report: window.reaperReport }));
    if (result.error) throw new Error(result.error);
    reports[view] = result.report;
    const png = await page.screenshot({ path: `${scratch}/${diagnostic ? prefix+'-' : ''}${view}.png`, timeout: 60000 });
    if (diagnostic) continue;
    await sharp(png).resize(width, height, { kernel: 'lanczos3' }).webp({ quality: 94, effort: 6 }).toFile(`${root}/public/media/${filename}`);
    if (view === 'hero') await sharp(png).resize(640, 400, { kernel: 'lanczos3' }).webp({ quality: 92, effort: 6 }).toFile(`${root}/public/media/reaper-sm.webp`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  if (!diagnostic) {
    const modelBytes = await readFile(`${root}/public/models/reaper.glb`);
    const gltf = JSON.parse(modelBytes.subarray(20,20+modelBytes.readUInt32LE(12)).toString());
    const packing = JSON.parse(await readFile(`${scratch}/packing.json`));
    const files = {};
    for (const name of ['reaper.webp','reaper-sm.webp','reaper-top.webp']) {
      const bytes = await readFile(`${root}/public/media/${name}`);
      const { width,height } = await sharp(bytes).metadata();
      files[name] = { bytes:bytes.length,width,height,sha256:createHash('sha256').update(bytes).digest('hex') };
    }
    const { nodes,bounds,triangles,vertices,renderer } = reports.hero;
    const views = Object.fromEntries(Object.entries(reports).map(([name,r]) => [name,{ camera:r.camera,viewport:r.viewport,calls:r.calls }]));
    const receipt = {
      model:{ bytes:modelBytes.length,sha256:createHash('sha256').update(modelBytes).digest('hex'),triangles,vertices,bounds,nodes },
      source:gltf.asset.extras,
      simplification:{before:packing.before,after:packing.after,ratio:.15,relativeError:.0005,lockBorder:true},
      validation:packing.validation.issues,
      runtime:{browser:await browser.version(),renderer,errors},
      views,files,
    };
    await writeFile(new URL('./verification.json', import.meta.url),JSON.stringify(receipt,null,2)+'\n');
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(reports).map(([view,r]) => [view,{triangles:r.triangles,bounds:r.bounds,renderer:r.renderer}]))));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
