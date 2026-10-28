import {test,expect} from '@playwright/test';
import {reviewFixture} from './fixtures';
for(const language of ['en','ar'] as const)test(`narrow tables and charts scroll with keyboard ${language}`,async({page})=>{
 await reviewFixture(page,language);await page.setViewportSize({width:360,height:800});
 for(const [url,selector] of [['/av8/affairs','.table-region'],['/dashboard','.glass-revenue-plot']]){
  await page.goto(url);const region=page.locator(selector).first();await expect(region).toBeVisible();await region.focus();await expect(region).toBeFocused();
  expect(await region.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
  const start=await region.evaluate(e=>e.scrollLeft);await region.press(language==='ar'?'ArrowLeft':'ArrowRight');await expect.poll(()=>region.evaluate(e=>e.scrollLeft)).not.toBe(start);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
