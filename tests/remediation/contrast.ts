import {chromium,expect} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';
import {reviewFixture} from './fixtures';
async function main(){
 const dir='/workspace/odin-ui-remediation-evidence/contrast'+(process.env.REVIEW_THEME==='light'?'-light':'');mkdirSync(dir,{recursive:true});const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:900}});await reviewFixture(page);await page.goto('http://127.0.0.1:8180/av8/leads');await expect(page.locator('tbody tr')).toHaveCount(25);const results:any[]=[];
 for(const [selector,name] of [['.page-heading .primary','primary'],['.av8-toolbar .btn:last-child','secondary'],['.glass-nav-item.selected','selected-navigation'],['.av8-toolbar select','select'],['tbody tr:first-child .link','table-link'],['tbody tr:first-child .status','status']]){
   const element=page.locator(selector).first();await element.scrollIntoViewIfNeeded();
   for(const state of ['default','hover','focus']){
     await page.mouse.move(0,0);if(state==='hover')await element.hover();if(state==='focus')await element.focus();await page.waitForTimeout(120);
     const metrics=await element.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,color:s.color,bg:s.backgroundColor,font:s.fontSize,weight:s.fontWeight,opacity:s.opacity,outline:s.outlineColor,outlineWidth:s.outlineWidth,border:s.borderColor};});
     const screenshot=`${name}-${state}.png`;await page.screenshot({path:dir+'/'+screenshot});results.push({name,state,metrics,screenshot});
   }
 }
 await page.getByRole('button',{name:'Capture lead',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('[aria-invalid=true]').first()).toBeVisible();await page.screenshot({path:dir+'/invalid-fields.png'});
 writeFileSync(dir+'/metrics.json',JSON.stringify(results,null,2));await browser.close();
}main();
