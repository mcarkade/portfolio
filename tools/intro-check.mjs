import {chromium} from 'playwright-core';
import fs from 'node:fs';
const [url,out,size='1440x900']=process.argv.slice(2),[width,height]=size.split('x').map(Number);
fs.mkdirSync(out,{recursive:true});
const report={url,size,checks:[],errors:[]};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const deadline=setTimeout(()=>browser.close(),90000);
const check=(name,pass,data)=>{report.checks.push({name,pass:!!pass,data});if(!pass)throw Error(name);};
try{
 const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{
  window.__audioSources=[];
  const make=AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource=function(...args){const node=make.apply(this,args),connect=node.connect.bind(node),start=node.start.bind(node);node.connect=function(to,...a){node.__gain=to;return connect(to,...a);};node.start=function(...a){window.__audioSources.push(node);return start(...a);};return node;};
 });
 await page.goto(url,{waitUntil:'load',timeout:60000});await page.waitForSelector('.loader__enter:not([hidden])',{timeout:60000});
 const t0=Date.now();await page.click('[data-enter="sound"]');
 for(const at of [500,1500,2500,3500,4450,4850,5500,6200,6800]){
  await page.waitForTimeout(Math.max(0,at-(Date.now()-t0)));await page.screenshot({path:`${out}/intro-${at}.jpg`,quality:82});
 }
 await page.waitForFunction(()=>!document.body.matches('.is-loading,.is-intro'));
 const elapsed=Date.now()-t0;check('Natural intro finishes through docking',elapsed>=6700&&elapsed<9500,{elapsed});
 await page.waitForTimeout(2200);
 const loop=await page.evaluate(()=>{const n=window.__audioSources.findLast(n=>n.loop&&n.buffer.duration>3);return n&&{duration:n.buffer.duration,gain:n.__gain.gain.value};});check('Background loop plays after sound entry',loop?.gain>.4,loop);
 await page.locator('.mark').evaluate(el=>el.click());await page.waitForTimeout(1000);
 const duck=await page.evaluate(()=>{const n=window.__audioSources.findLast(n=>n.loop&&n.buffer.duration>3);return{intro:document.body.classList.contains('is-intro'),gain:n?.__gain.gain.value};});check('Replay keeps music ducked across live drive frames',duck.intro&&duck.gain<.01,duck);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.body.classList.contains('is-intro'));await page.waitForTimeout(2200);
 const released=await page.evaluate(()=>{const n=window.__audioSources.findLast(n=>n.loop&&n.buffer.duration>3);return{gain:n?.__gain.gain.value,inert:document.querySelector('main').inert,y:scrollY};});check('Replay skip restores music and page',released.gain>.5&&!released.inert&&released.y<2,released);
 await page.locator('.sound').evaluate(el=>el.click());check('Sound toggles off',await page.locator('.sound').getAttribute('aria-pressed')==='false');check('No runtime errors',!report.errors.length,report.errors);
}catch(e){report.failure=e.message;process.exitCode=1;}finally{clearTimeout(deadline);fs.writeFileSync(`${out}/intro-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
