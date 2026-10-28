import {test,expect} from '@playwright/test';
import {reviewFixture,branches} from './fixtures';
import {bootstrap} from '../glass/fixtures';
test.beforeEach(async({page})=>reviewFixture(page));
test('new sales and purchasing documents leave unrelated counterparties, products and salespeople unselected',async({page})=>{
 await page.route('**/api/bootstrap',r=>r.fulfill({json:{...bootstrap,branches,customers:[{id:'1',name:'Unrelated customer'}],suppliers:[{id:'1',name:'Unrelated supplier'}],items:[{id:'1',name:'Unrelated product',sku:'UI-01',active:true}],salesEmployees:[{id:'10',name:'Unrelated salesperson',userId:'99'}]}}));
 await page.route('**/api/references/sales-employees?**',r=>r.fulfill({json:[{id:'10',name:'Unrelated salesperson',userId:'99'}]}));
 await page.goto('/sales/quotations');await page.getByRole('button',{name:'New quotation',exact:true}).click();await expect(page.getByLabel('Customer',{exact:false}).first()).toBeVisible();
 await page.screenshot({path:'/workspace/odin-ui-remediation-evidence/after/document-defaults.png',fullPage:true});
 await expect(page.getByLabel('Customer',{exact:false}).first()).toHaveValue('');await expect(page.getByLabel('Branch',{exact:false}).first()).toHaveValue('');await expect(page.getByLabel('Salesperson',{exact:false}).first()).toHaveValue('');await expect(page.getByLabel('Product 1',{exact:true})).toHaveValue('');
 await page.goto('/purchasing/orders');await page.getByRole('button',{name:'New purchase order',exact:true}).click();await expect(page.getByLabel('Supplier',{exact:false}).first()).toHaveValue('');
});
test('configuration shows missing amounts as unconfigured, preserving explicit zero',async({page})=>{
 await page.route('**/api/av8/policies',r=>r.fulfill({json:[{id:'missing',kind:'PLAN',key:'CASH',status:'DRAFT',data:{name:'Disposable missing amount'},usable:false,previews:[]},{id:'zero',kind:'PLAN',key:'CASH',status:'DRAFT',data:{name:'Disposable zero amount'},usable:false,previews:[{totalMinor:'0'}]}]}));
 await page.goto('/av8/settings');await expect(page.getByText('Disposable missing amount')).toBeVisible();await page.screenshot({path:'/workspace/odin-ui-remediation-evidence/after/policy-missing-amount.png'});
 await expect(page.locator('article').filter({hasText:'Disposable missing amount'})).toContainText('Not configured');await expect(page.locator('article').filter({hasText:'Disposable zero amount'})).toContainText('USD 0.00');await expect(page.locator('main')).not.toContainText('USD 54,000.00');
});
test('zero dashboard, error detail and loading states do not masquerade as initial empty records',async({page})=>{
 await page.route('**/api/av8/queues?**',r=>r.fulfill({json:{rows:[],total:0,page:1,size:25,counts:{documents:0,visa:0,progress:0,departures:0,arrears:0,academy:0,applications:0,uncontacted:0}}}));
 await page.goto('/dashboard?view=daily');await expect(page.locator('.glass-analytics')).toContainText('No follow-up requirements in your current scope.');await expect(page.locator('.glass-chart-bars')).toHaveCount(0);
 await page.route('**/api/av8/leads/1',async r=>{await new Promise(resolve=>setTimeout(resolve,600));await r.fulfill({status:503,json:{message:'Disposable service failure'}});});await page.goto('/av8/leads?lead=1');await expect(page.getByRole('dialog').locator('.loading')).toBeVisible();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Disposable service failure');await expect(page.getByRole('dialog')).not.toContainText('Nothing here yet');
});
test('unsaved nested AV8 form protects browser Back and preserves the lead when cancelled',async({page})=>{
 await page.goto('/av8/leads');await page.getByRole('button',{name:'UI Review lead 01',exact:true}).click();await page.getByRole('button',{name:'Record activity',exact:true}).click();const form=page.getByRole('dialog',{name:'Record activity'});await form.getByLabel('Reason / notes',{exact:false}).fill('Unsaved disposable activity');let prompts=0;page.on('dialog',async d=>{prompts++;await d.dismiss();});await page.evaluate(()=>history.back());await expect.poll(()=>prompts).toBe(1);await expect(form).toBeVisible();expect(new URL(page.url()).searchParams.get('lead')).toBe('1');
});
test('batch-remittance allocation protects unsaved splits and notes',async({page})=>{
 await page.route('**/api/av8/funds?**',r=>r.fulfill({json:{rows:[{id:'1',kind:'REMITTANCE',status:'APPROVED',reference:'DISPOSABLE-REMITTANCE',usdMinor:'10000',academyId:'1',branchId:'1'}],total:1,page:1,obligations:[],applications:[]}}));
 await page.goto('/av8/finance');await page.getByRole('button',{name:'Confirm cleared funds',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByLabel('Reason / notes',{exact:false}).fill('Unsaved allocation note');let prompts=0;page.on('dialog',async d=>{prompts++;await d.dismiss();});await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();expect(prompts).toBe(1);
});
