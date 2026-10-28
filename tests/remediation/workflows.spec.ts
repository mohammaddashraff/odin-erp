import {test,expect} from '@playwright/test';
import {reviewFixture,leads} from './fixtures';
import {fixture,actor} from '../glass/fixtures';
import {countTicks,formSnapshot,leadEvents,statusTone} from '../../apps/web/src/core/ui-presentation';
const root='/workspace/odin-ui-remediation-evidence/after';
test.beforeEach(async({page})=>{await reviewFixture(page);});
test('queue semantics, filtered-empty reset, exact sizes and count chart',async({page})=>{
 await page.goto('/av8/affairs');await expect(page.locator('tbody tr')).toHaveCount(25);
 await expect(page.getByRole('columnheader',{name:'Status',exact:true})).toBeVisible();await expect(page.getByRole('columnheader',{name:'Amount',exact:true})).toBeVisible();
 expect(await page.locator('tbody tr').first().locator('td').allTextContents()).toEqual(['AV8-REVIEW-1','UI Review student 01','Passport','2026-10-28','Pending','—']);
 await expect(page.locator('tbody tr').nth(1)).toContainText('USD 100.00');
 const heights=await page.locator('.av8-toolbar .search-field,.av8-toolbar select,.av8-toolbar .btn').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));expect(heights.every(h=>h===44)).toBe(true);
 await page.getByRole('searchbox').fill('no result');await expect(page.getByText('No matching records')).toBeVisible();await page.getByRole('button',{name:'Reset filters'}).first().click();await expect(page.locator('tbody tr')).toHaveCount(25);
 await page.goto('/dashboard?view=daily');await expect(page.locator('.glass-metric')).toHaveCount(4);const sizes=await page.locator('.glass-metric').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));expect(sizes.every(h=>h>=145&&h<=180)).toBe(true);
 expect(await page.locator('.glass-chart-grid span').allTextContents()).toEqual(['3','2','1','0']);expect(await page.locator('.glass-spark').count()).toBe(0);
 await page.screenshot({path:root+'/daily-en-1440.png',fullPage:true});
});
test('AV8 dirty Cancel, Escape, clean dismissal, defaults, field errors and duplicate submit',async({page})=>{
 await page.goto('/av8/leads');const capture=page.getByRole('button',{name:'Capture lead',exact:true});await capture.click();let prompts=0;
 page.on('dialog',async d=>{prompts++;await d.dismiss();});
 await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(prompts).toBe(0);await capture.click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('Branch',{exact:false})).toHaveValue('');await expect(dialog.getByLabel('Owner',{exact:false})).toHaveValue('1');
 await dialog.getByLabel('Name',{exact:false}).first().fill('Disposable input');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toBeVisible();await page.keyboard.press('Escape');expect(prompts).toBe(2);
 await dialog.getByLabel('Name',{exact:false}).first().fill('');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);expect(prompts).toBe(2);
 await capture.click();await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog.getByLabel('Name',{exact:false}).first()).toHaveAttribute('aria-invalid','true');await expect(dialog.getByLabel('Name',{exact:false}).first()).toBeFocused();
 const name=dialog.getByLabel('Name',{exact:false}).first();const ids=await name.getAttribute('aria-describedby');expect(ids).toContain('error');
 await name.fill('Disposable input');await dialog.getByLabel('Phone',{exact:false}).fill('+20000000099');await dialog.getByLabel('Source / platform',{exact:false}).fill('facebook');await dialog.getByLabel('Branch',{exact:false}).selectOption('2');
 let writes=0;await page.route('**/api/av8/leads',async r=>{writes++;expect(r.request().postDataJSON()).toMatchObject({source:'Facebook',branchId:'2',ownerId:'1'});await new Promise(resolve=>setTimeout(resolve,350));await r.fulfill({json:{id:'100'}});});
 await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog.getByRole('button',{name:'Save',exact:true})).toBeDisabled();await expect(dialog).toHaveCount(0);expect(writes).toBe(1);
});
test('lead drawer, timeline order, focus, filtering, pagination, Back and refresh',async({page})=>{
 await page.goto('/av8/leads');await page.getByRole('searchbox').fill('UI Review');await page.getByRole('button',{name:'Next page'}).click();await expect(page.locator('tbody tr')).toHaveCount(6);
 const row=page.getByRole('button',{name:'UI Review lead 26',exact:true});await row.click();await expect(page.getByRole('dialog',{name:'Lead details'})).toBeVisible();await expect(page.getByRole('dialog')).toContainText('UI Review lead 26');
 expect(await page.locator('[data-event-id]').evaluateAll(es=>es.map(e=>e.getAttribute('data-event-id')))).toEqual(['audit:audit-2','record:event-1','audit:audit-1']);
 await page.screenshot({path:root+'/lead-detail-en-1440.png'});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(row).toBeFocused();await expect(page.getByRole('searchbox')).toHaveValue('UI Review');expect(new URL(page.url()).searchParams.get('page')).toBe('2');
 await row.click();await expect(page.getByRole('dialog')).toBeVisible();await page.goBack();await expect(row).toBeVisible();await page.reload();await expect(page.locator('tbody tr')).toHaveCount(6);await expect(page.getByRole('searchbox')).toHaveValue('UI Review');
 await page.goto('/av8/leads?lead=1');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('full-dataset sort precedes pagination, filtering resets page and nullable dates retain headers',async({page})=>{
 await page.goto('/av8/leads');await page.getByRole('columnheader',{name:'Name',exact:true}).getByRole('button').click();await page.getByRole('columnheader',{name:'Name',exact:true}).getByRole('button').click();await expect(page.locator('tbody tr').first()).toContainText('UI Review lead 31');await expect(page.getByRole('columnheader',{name:'Name',exact:true})).toHaveAttribute('aria-sort','descending');
 await page.getByRole('button',{name:'Next page'}).click();await expect(page.locator('tbody tr').first()).toContainText('UI Review lead 06');await page.getByLabel('Status',{exact:true}).selectOption('NEW');await expect(page.locator('tbody tr')).toHaveCount(16);expect(new URL(page.url()).searchParams.get('page')).toBeNull();
 await page.goto('/av8/reports');await expect(page.getByRole('columnheader',{name:'Academy',exact:true})).toBeVisible();await page.getByLabel('Report',{exact:true}).selectOption('student-balances');await expect(page.getByRole('columnheader',{name:'Remaining',exact:true})).toBeVisible();await expect(page.locator('tbody')).toContainText('No records are available for this report yet.');
 await page.screenshot({path:root+'/reports-empty-en-1440.png'});
});
test('CSV import stages enforce preview and duplicate review, normalize new input and report count',async({page})=>{
 await page.route('**/api/av8/leads/import/preview',r=>r.fulfill({json:{rows:[{row:2,data:{name:'Disposable import',phone:'+20000000099',source:'facebook'},duplicates:[{name:'Existing fixture'}],duplicateInFile:null,error:''}]}}));
 let commits=0;await page.route('**/api/av8/leads/import/commit',r=>{commits++;expect(r.request().postDataJSON().rows[0]).toMatchObject({source:'Facebook',duplicateReviewed:true});return r.fulfill({json:{count:1,rows:[]}});});
 await page.goto('/av8/leads');await page.getByRole('button',{name:'Import leads',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Import validated leads',exact:true})).toBeDisabled();
 await dialog.getByLabel('CSV file',{exact:true}).setInputFiles({name:'disposable.csv',mimeType:'text/csv',buffer:Buffer.from('name,phone,source\nDisposable import,+20000000099,facebook')});
 await dialog.getByRole('button',{name:'Preview CSV',exact:true}).click();await expect(dialog.getByText('Existing fixture')).toBeVisible();await expect(dialog.getByRole('button',{name:'Import validated leads',exact:true})).toBeDisabled();await dialog.getByRole('checkbox').check();await dialog.getByLabel('Branch',{exact:false}).selectOption('1');
 await page.screenshot({path:root+'/import-reviewed-en-1440.png'});await dialog.getByRole('button',{name:'Import validated leads',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('status')).toContainText('Imported leads: 1');expect(commits).toBe(1);
});
test('admin active destination, group context, dangerous final actions and account sections',async({page})=>{
 await page.goto('/settings/access/roles');await expect(page.locator('.admin-links [aria-current=page]')).toHaveText('Access Groups');await page.getByRole('link',{name:'Assign users',exact:true}).click();await expect(page.getByText('Group assignment')).toBeVisible();await expect(page.getByLabel('Access group',{exact:false}).first()).toHaveValue('1');
 await page.goto('/settings/access/roles');await page.getByRole('button',{name:'Archive',exact:true}).click();const confirm=page.getByRole('dialog');await expect(confirm.getByRole('button',{name:'Archive access group',exact:true})).toHaveClass(/danger/);await page.keyboard.press('Escape');
 await page.goto('/settings/access/users/1');await expect(page.locator('.admin-links [aria-current=page]')).toHaveText('Users');await page.getByRole('button',{name:'Account & Security',exact:true}).click();await expect(page.locator('.admin-sensitive')).toContainText('Account availability');await page.getByRole('button',{name:'Deactivate account',exact:true}).click();await expect(confirm.getByRole('button',{name:'Deactivate account',exact:true})).toHaveClass(/danger/);await page.screenshot({path:root+'/deactivate-confirm-en-1440.png'});await page.keyboard.press('Escape');
});
test('bilingual page search, no results, keyboard navigation, bounded menus and focus return',async({page})=>{
 await page.goto('/dashboard');await page.getByRole('button',{name:'Search pages',exact:true}).click();const search=page.getByRole('dialog').getByRole('searchbox');await search.fill('المستخدمون');await expect(page.getByRole('dialog').getByRole('link').first()).toBeVisible();await search.fill('xyznotapage');await expect(page.getByRole('dialog').getByText('No matching records')).toBeVisible();await page.getByRole('button',{name:'Clear search',exact:true}).click();await search.fill('Leads');await search.press('ArrowDown');await expect(page.getByRole('dialog').getByRole('link').first()).toBeFocused();await page.keyboard.press('Enter');await expect(page).toHaveURL(/av8\/leads/);
 await page.setViewportSize({width:1024,height:768});await page.getByRole('button',{name:'More',exact:true}).click();const menu=page.locator('#glass-more-pages');await expect(menu).toBeVisible();const box=await menu.boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(768);await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'More',exact:true})).toBeFocused();
});
test('pure display semantics and form snapshots retain unknown and missing information',()=>{
 expect(statusTone('CLOSED')).toBe('neutral');expect(statusTone('PAID')).toBe('success');expect(statusTone('OVERDUE')).toBe('danger');expect(statusTone('UNKNOWN')).toBe('neutral');expect(countTicks(0)).toEqual([0]);expect(new Set(countTicks(2)).size).toBe(countTicks(2).length);expect(formSnapshot({name:''})).toBe(formSnapshot({}));expect(formSnapshot({amount:0})).not.toBe(formSnapshot({}));
 expect(leadEvents([{id:1,kind:'note'},{id:1,kind:'note'}],[])).toHaveLength(1);
});
test('restricted menus and denied routes retain authorization boundaries',async({page})=>{
 await page.route('**/api/auth/me',r=>r.fulfill({json:{...actor,permissions:['av8.workspace.view','av8.leads.view'],branchIds:['1']}}));await page.goto('/av8/leads');await expect(page.getByRole('button',{name:'Capture lead',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Search pages',exact:true}).click();await page.getByRole('dialog').getByRole('searchbox').fill('Users');await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(0);await page.keyboard.press('Escape');await page.goto('/settings/access/users');await expect(page.getByRole('heading',{name:'Access Denied'})).toBeVisible();
});
test('session restoration, refresh expiry and language switching use existing authentication rules',async({page})=>{
 await page.goto('/av8/leads?lead=1');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await page.getByTestId('language-toggle').click();await expect(page.locator('html')).toHaveAttribute('lang','ar');await expect(page.locator('.loading')).toHaveCount(0);await page.reload();await expect(page.locator('.glass-header')).toBeVisible();await expect(page.locator('html')).toHaveAttribute('lang','ar');
 await page.route('**/api/auth/me',r=>r.fulfill({status:401,json:{message:'Invalid session'}}));await page.route('**/api/auth/refresh',r=>r.fulfill({status:401,json:{message:'Session expired'}}));await page.reload();await expect(page.locator('.glass-header')).toHaveCount(0);await expect(page.locator('input[type=password]').first()).toBeVisible();
});
