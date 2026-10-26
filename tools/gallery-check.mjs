import { chromium } from 'playwright-core';
import fs from 'node:fs';
const out='C:/Abhinav/Projects/_scratch/gallery-shots';
const watchdog=setTimeout(()=>{console.error('Gallery verification exceeded 120 seconds');process.exit(1)},120000);watchdog.unref();
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const mobile=process.argv.includes('--mobile'), reduced=process.argv.includes('--reduced');
const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile,reducedMotion:reduced?'reduce':'no-preference'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto('http://127.0.0.1:5185',{waitUntil:'load',timeout:60000});
await page.waitForSelector('.loader__enter:not([hidden])',{timeout:60000});await page.click('[data-enter="silent"]');
await page.waitForFunction(()=>!document.body.classList.contains('is-loading'),null,{timeout:30000});
await page.waitForTimeout(1500);
if(process.argv.includes('--cold-baseline')) await page.evaluate(()=>{const g=window.__mc.world.gallery,update=g.update.bind(g);g.update=(...args)=>{update(...args);g.group.visible=false}});
if(process.argv.includes('--no-video')) await page.evaluate(()=>window.__mc.world.gallery.loadVideo=()=>{});
const coldArrival=await page.evaluate(()=>new Promise(resolve=>{
 const d=window.__mc.director,w=window.__mc.world,frames=[],render=[],prepare=[],uploads=[],longTasks=[];
 const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});
 const uploadOriginal=w.gallery.upload.bind(w.gallery);w.gallery.upload=(...args)=>{const t=performance.now();uploadOriginal(...args);uploads.push(performance.now()-t)};
 const renderOriginal=w.render.bind(w),prepareOriginal=w.gallery.prepare.bind(w.gallery);
 w.render=(...args)=>{const t=performance.now();renderOriginal(...args);render.push(performance.now()-t)};
 w.gallery.prepare=(...args)=>{const t=performance.now();prepareOriginal(...args);prepare.push(performance.now()-t)};
 let previous=performance.now(),n=0;
 scrollTo(0,d.tops[6]+d.heights[6]*.04);
 const f=now=>{frames.push(now-previous);previous=now;if(++n<160)requestAnimationFrame(f);else{w.render=renderOriginal;w.gallery.prepare=prepareOriginal;w.gallery.upload=uploadOriginal;observer.disconnect();frames.sort((a,b)=>a-b);resolve({median:frames[80],p95:frames[152],max:frames[159],renderMax:Math.max(...render),prepareMax:Math.max(...prepare),uploadMax:Math.max(0,...uploads),longTasks})}};requestAnimationFrame(f);
}));
if(process.argv.includes('--cold-only')) { console.log(JSON.stringify(coldArrival));await browser.close();process.exit(0); }
const jump=async s=>{await page.evaluate(s=>{const d=window.__mc.director;scrollTo(0,d.tops[6]+d.heights[6]*(s-6))},s);await page.waitForTimeout(1800)};
const name=mobile?'phone':reduced?'reduced':'desktop';fs.mkdirSync(`${out}/${name}`,{recursive:true});
for(const s of [6.04,6.18,6.36,6.54,6.72,6.90]){await jump(s);await page.mouse.move(mobile?190:650,mobile?390:450);await page.waitForTimeout(500);await page.screenshot({path:`${out}/${name}/hover-${s}.png`});}
const lifecycle=await page.evaluate(()=>({motion:window.__mc.world.gallery.panels.map(p=>p.mesh.rotation.toArray().slice(0,3)),panels:window.__mc.world.gallery.panels.map(p=>({name:p.link.dataset.gallery,loaded:p.loaded,video:p.video?{paused:p.video.paused,ready:p.video.readyState,playing:p.playing}:null})),overflow:document.documentElement.scrollWidth>innerWidth}));
// Tab focus must move the camera before Enter activates the canonical link.
await page.locator('[data-gallery="ThetaShift"]').focus();await page.waitForTimeout(700);
const keyboard=await page.evaluate(()=>({focus:document.activeElement.dataset.gallery,s:window.__mc.director.sNow,outline:window.__mc.world.gallery.panels[2].hit.style.outline}));
await page.screenshot({path:`${out}/${name}/keyboard.png`});
const popupPromise=page.waitForEvent('popup',{timeout:10000});
await page.keyboard.press('Enter');
const popup=await popupPromise;await popup.waitForURL('**/media/theta-cart.webp',{timeout:10000});const enterURL=popup.url();await popup.close();
await jump(6.18);
if(mobile) await page.touchscreen.tap(195,420);else await page.mouse.click(720,450);
await page.waitForTimeout(2800);
const click=await page.evaluate(()=>({hash:location.hash,s:window.__mc.director.sNow}));
await jump(6.36);
const reverse=[];for(const s of [6.36,6.72,6.36]){await jump(s);reverse.push(await page.evaluate(()=>window.__mc.world.camera.position.toArray()))}
const perf=await page.evaluate(async()=>{
 const w=window.__mc.world,g=w.renderer.getContext(),ext=g.getExtension('EXT_disjoint_timer_query_webgl2'),debug=g.getExtension('WEBGL_debug_renderer_info');
 const gpu=debug?g.getParameter(debug.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER);
 const old=w.render.bind(w),update=w.gallery.update.bind(w.gallery),adapt=w.adapt;w.adapt=()=>{};
 const result={gpu,extension:!!ext,dpr:w.renderer.getPixelRatio(),size:w.renderer.getSize(new (w.camera.position.constructor)(0,0,0)).toArray(),runs:[]};
 for(let run=0;run<4;run++){
  const enabled=run%2===0,queries=[],cpu=[],raf=[];let last=performance.now();
  w.gallery.update=(...args)=>{update(...args);if(!enabled)w.gallery.group.visible=false;};
  w.render=state=>{const q=ext?g.createQuery():null;if(q)g.beginQuery(ext.TIME_ELAPSED_EXT,q);const t=performance.now();old(state);cpu.push(performance.now()-t);if(q){g.endQuery(ext.TIME_ELAPSED_EXT);queries.push(q)};};
  await new Promise(resolve=>{let n=0;const f=now=>{raf.push(now-last);last=now;const d=window.__mc.director;scrollTo(0,d.tops[6]+d.heights[6]*(.01+.91*n/180));if(++n<180)requestAnimationFrame(f);else resolve()};requestAnimationFrame(f)});
  w.render=old;
  await new Promise(resolve=>setTimeout(resolve,150));
  const values=queries.filter(q=>g.getQueryParameter(q,g.QUERY_RESULT_AVAILABLE)).map(q=>g.getQueryParameter(q,g.QUERY_RESULT)/1e6);queries.forEach(q=>g.deleteQuery(q));
  const stat=a=>{a=a.slice(8).sort((a,b)=>a-b);return {median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],n:a.length}};
  result.runs.push({gallery:enabled,gpu:stat(values),cpu:stat(cpu),raf:stat(raf),disjoint:ext?g.getParameter(ext.GPU_DISJOINT_EXT):null});
 }
 w.render=old;w.gallery.update=update;w.adapt=adapt;return result;
});
await jump(7.1);
const exit=await page.evaluate(()=>({active:window.__mc.world.gallery.active,paused:window.__mc.world.gallery.panels.every(p=>!p.video||p.video.paused),overlayHidden:window.__mc.world.gallery.overlay.hidden}));
const report={name,coldArrival,lifecycle,keyboard,enterURL,click,reverse,perf,exit,errors};fs.writeFileSync(`${out}/${name}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(errors.length || click.hash !== '#lock' || !exit.paused || !exit.overlayHidden || lifecycle.overflow || JSON.stringify(reverse[0]) !== JSON.stringify(reverse[2])) throw new Error('Gallery behavior check failed');
if(reduced && lifecycle.motion.some(r=>r.some(v=>v!==0))) throw new Error('Reduced motion still tilts a panel');
await browser.close();
