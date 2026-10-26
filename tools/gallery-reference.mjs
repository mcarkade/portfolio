import { chromium } from 'playwright-core';
import fs from 'node:fs';
setTimeout(()=>process.exit(1),90000).unref();
const out='C:/Abhinav/Projects/_scratch/gallery-shots';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.goto('https://activetheory.net/work',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(12000);
console.log((await page.locator('body').innerText()).slice(0,2500));
for(let i=0;i<7;i++){await page.mouse.move(300+i*130,300+(i%3)*120);await page.mouse.wheel(0,i?650:0);await page.waitForTimeout(750);await page.screenshot({path:`${out}/reference-${i}.png`});}
await browser.close();
