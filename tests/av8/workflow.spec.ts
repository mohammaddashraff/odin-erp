import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const password=process.env.AV8_BOOTSTRAP_PASSWORD;
const email=process.env.AV8_TEST_EMAIL||'admin@av8.local';
if(!password)throw new Error('AV8_BOOTSTRAP_PASSWORD is required');

async function login(page:Page){
 await page.goto('/av8/students');
 await page.getByTestId('login-email').fill(email);
 await page.getByTestId('login-password').fill(password!);
 await page.getByTestId('login-submit').click();
 await expect(page.locator('.context-bar')).toBeVisible();
 await expect(page.locator('.loading')).toHaveCount(0);
 if(await page.getByTestId('language-toggle').getByText('English',{exact:true}).count())await page.getByTestId('language-toggle').click();
 await expect(page.locator('html')).toHaveAttribute('dir','ltr');
}

test('AV8 one-save receipt, Arabic actions, identity and spacing',async({page})=>{
 await login(page);
 const nav=page.locator('.glass-navigation');
 await expect(nav).toBeVisible();await page.getByTestId('nav-av8').click();await expect(page.locator('#glass-module-pages')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#glass-module-pages')).toHaveCount(0);expect(await page.locator('.loading').count()).toBe(0);
 const token=await page.evaluate(()=>localStorage.getItem('av8_token'));
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()};
 const refs=await (await page.request.get('/api/av8/refs',{headers})).json();
 const leadResponse=await page.request.post('/api/av8/leads',{headers:{...headers,'Idempotency-Key':randomUUID()},data:{name:`SYNTHETIC browser receipt ${Date.now()}`,phone:`+209${String(Date.now()).slice(-9)}`,source:'Browser QA',program:'Flight training',branchId:refs.branches[0].id,ownerId:refs.users[0].id,duplicateReviewed:true}});
 expect(leadResponse.ok(),await leadResponse.text()).toBe(true);const lead=await leadResponse.json();
 let response=await page.request.post(`/api/av8/leads/${lead.id}/action`,{headers:{...headers,'Idempotency-Key':randomUUID()},data:{version:1,action:'appointment',status:'SCHEDULED',plannedAt:'2026-10-25T10:00:00+02:00',reason:'Browser journey'}});expect(response.ok(),await response.text()).toBe(true);
 let detail=await (await page.request.get(`/api/av8/leads/${lead.id}`,{headers})).json();const appointment=detail.records.find((record:any)=>record.kind==='appointment');
 response=await page.request.post(`/api/av8/leads/${lead.id}/action`,{headers:{...headers,'Idempotency-Key':randomUUID()},data:{version:detail.version,action:'appointment',recordId:appointment.id,status:'ATTENDED',actualAt:'2026-10-25T10:00:00+02:00',reason:'Browser journey attended'}});expect(response.ok(),await response.text()).toBe(true);
 response=await page.request.post(`/api/av8/leads/${lead.id}/convert`,{headers:{...headers,'Idempotency-Key':randomUUID()},data:{academyId:refs.academies[0].id,reason:'Browser journey application'}});expect(response.ok(),await response.text()).toBe(true);const app=await response.json();

 await page.goto(`/av8/students?student=${app.id}&tab=Payments`);
 await expect(page.getByRole('heading',{name:/SYNTHETIC browser receipt/})).toBeVisible();
 await page.getByRole('button',{name:'Record payment',exact:true}).last().click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await dialog.getByLabel(/Amount/).fill('2000');
 await dialog.getByLabel(/Receiving bank \/ cash account/).selectOption(refs.banks.find((bank:any)=>bank.currency==='USD').id);
 await dialog.getByLabel('1 USD = X EGP').fill('50');
 await dialog.getByLabel('Payment reference').fill(`browser-${Date.now()}`);
 const receipt=page.waitForResponse(request=>request.url().includes(`/api/av8/applications/${app.id}/receipts`)&&request.request().method()==='POST');
 await dialog.getByRole('button',{name:'Save',exact:true}).click();
 const saved=await receipt;expect(saved.ok(),await saved.text()).toBe(true);expect(await saved.json()).toMatchObject({status:'CLEARED',remainingUsdMinor:'0'});
 await expect(dialog).toHaveCount(0);await expect(page.getByText('USD 0.00',{exact:true}).first()).toBeVisible();

 await page.goto(`/av8/students?student=${app.id}`);await expect(page.locator('.av8-admissions-grid')).toBeVisible();
 const spacing=await page.locator('.av8-admissions-content').first().evaluate(element=>({padding:getComputedStyle(element).paddingTop,gap:getComputedStyle(element).gap}));expect(parseFloat(spacing.padding)).toBeGreaterThanOrEqual(20);expect(parseFloat(spacing.gap)).toBeGreaterThanOrEqual(16);
 await page.screenshot({path:'test-results/av8/student-spacing-en.png',fullPage:true});
 await page.goto('/av8/settings');await expect(page.getByRole('heading',{name:'Business configuration'})).toBeVisible();await expect(page.getByText('Approve policy')).toHaveCount(0);await page.screenshot({path:'test-results/av8/settings-en.png',fullPage:true});
 await page.getByTestId('language-toggle').click();await expect(page.locator('html')).toHaveAttribute('dir','rtl');await expect(page.getByRole('heading',{name:'إعدادات العمل'})).toBeVisible();
 await page.goto(`/av8/students?student=${app.id}&tab=Payments`);await expect(page.getByRole('button',{name:'تسجيل دفعة',exact:true}).last()).toBeVisible();await page.screenshot({path:'test-results/av8/student-payments-ar.png',fullPage:true});
 expect(await page.locator('.brand-mark').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});
