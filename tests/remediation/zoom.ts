import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {reviewFixture} from './fixtures';
async function main(){
 const dir='/workspace/odin-ui-remediation-evidence/zoom';mkdirSync(dir,{recursive:true});const results:any[]=[];
 for(const zoom of [1,2]){
   const profile=`/tmp/odin-review-native-zoom-${zoom}-${Date.now()}`;mkdirSync(profile+'/Default',{recursive:true});
   const extension=profile+'/zoom-extension';mkdirSync(extension);
   writeFileSync(extension+'/manifest.json',JSON.stringify({manifest_version:3,name:'Local UI zoom test',version:'1.0',permissions:['tabs'],background:{service_worker:'zoom.js'}}));
   writeFileSync(extension+'/zoom.js','chrome.runtime.onInstalled.addListener(()=>{});');
   const context=await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/chromium',headless:true,viewport:null,args:['--no-sandbox','--window-size=1440,900','--disable-extensions-except='+extension,'--load-extension='+extension],ignoreDefaultArgs:['--disable-extensions']});const page=context.pages()[0];await reviewFixture(page);
   for(const language of ['en','ar']){
     if(language==='ar')await context.addCookies([{name:'av8_language',value:'ar',url:'http://127.0.0.1:8180'}]);
     await page.goto('http://127.0.0.1:8180/av8/leads');await expect(page.locator('tbody tr')).toHaveCount(25);
     const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:5000});
     await worker.evaluate(async factor=>{const chrome=(globalThis as any).chrome;const tabs=await chrome.tabs.query({url:'http://127.0.0.1:8180/*'});await chrome.tabs.setZoom(tabs[0].id,factor);},zoom);
     await expect.poll(()=>page.evaluate(()=>devicePixelRatio)).toBe(zoom);
     const geometry=await page.evaluate(()=>({outerWidth,innerWidth,innerHeight,devicePixelRatio,scrollWidth:document.documentElement.scrollWidth}));
     await page.screenshot({path:`${dir}/leads-${language}-${zoom*100}.png`,fullPage:true});results.push({zoom,language,geometry});
   }
   await context.close();
 }
 writeFileSync(dir+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}main();
