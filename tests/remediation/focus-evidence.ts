import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {reviewFixture} from './fixtures';
async function main(){
 const dir='/workspace/odin-ui-remediation-evidence/focus-final';mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const samples:any[]=[];
 for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width:1440,height:900}});await reviewFixture(page);await page.addInitScript(value=>localStorage.setItem('odin-theme',value),theme);
  await page.goto('http://127.0.0.1:8180/av8/leads');await expect(page.locator('tbody tr')).toHaveCount(25);
  const nav=page.locator('.glass-nav-items .glass-nav-item.selected').first();await page.keyboard.press('Tab');await nav.focus();await expect(nav).toBeFocused();
  const metrics=await nav.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,color:s.outlineColor,widthCss:s.outlineWidth,offset:s.outlineOffset,visible:e.matches(':focus-visible')};});
  expect(metrics.visible).toBe(true);expect(metrics.offset).toBe('-4px');await page.screenshot({path:`${dir}/navigation-${theme}.png`});samples.push({theme,state:'navigation-focus',metrics,screenshot:`navigation-${theme}.png`});
  await page.getByRole('button',{name:'Import leads',exact:true}).click();const disabled=page.getByRole('button',{name:'Import validated leads',exact:true});await expect(disabled).toBeDisabled();await expect(page.getByText('Upload and preview 1–500 rows, resolve errors and review duplicates first.')).toBeVisible();
  await page.screenshot({path:`${dir}/disabled-import-${theme}.png`});samples.push({theme,state:'disabled-import',disabled:true,explanationVisible:true,screenshot:`disabled-import-${theme}.png`});await page.close();
 }
 await browser.close();writeFileSync(dir+'/metrics.json',JSON.stringify(samples,null,2));
}main();
