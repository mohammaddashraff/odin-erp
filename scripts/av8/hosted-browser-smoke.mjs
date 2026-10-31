import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

// Read-only acceptance through the approved staging SSH tunnel. No account
// credentials, MFA bypass, database setup, provider calls or business writes.
const origin=process.env.AV8_HOSTED_SMOKE_ORIGIN;
if(origin!=='http://127.0.0.1:18180')throw new Error('Use the explicitly approved staging loopback tunnel');
const output='docs/final-delivery/evidence/hosted-browser';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
const results=[];
try{
 for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
  const context=await browser.newContext({baseURL:origin,viewport});
  await context.addCookies([{name:'av8_language',value:'en',url:origin}]);
  await context.addInitScript(()=>{localStorage.setItem('av8_language','en');localStorage.setItem('odin-theme','light');});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto('/login');assert.equal(response.status(),200);await page.getByTestId('login-email').waitFor();
  assert.equal(await page.locator('html').getAttribute('dir'),'ltr');assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:`${output}/${viewport.name}-login-en.png`,fullPage:true});
  await page.getByTestId('language-toggle').click();await page.waitForFunction(()=>document.documentElement.lang==='ar'&&document.documentElement.dir==='rtl');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:`${output}/${viewport.name}-login-ar.png`,fullPage:true});
  assert.deepEqual(errors,[]);results.push({viewport:viewport.name,english:'PASS',arabic:'PASS',overflow:false,pageErrors:errors});
  if(viewport.name==='desktop'){
   const health=await page.request.get('/api/health');assert.equal(health.status(),200);
   const unauthenticated=await page.request.get('/api/auth/me');assert.equal(unauthenticated.status(),401);
   const policy=response.headers()['content-security-policy']||'',scripts=policy.split(';').find(part=>part.trim().startsWith('script-src'))||'';
   assert.ok(scripts.includes("'nonce-"));assert.ok(!scripts.includes("'unsafe-inline'"));assert.ok(!scripts.includes("'unsafe-eval'"));const nonce=scripts.match(/'nonce-([^']+)'/)[1];
   await page.route('**/login',async route=>{const actual=await route.fetch();await route.fulfill({response:actual,body:(await actual.text()).replace('</head>','<script>window.__av8ReadOnlyUnsafeProbe=true</script></head>')});},{times:1});
   const next=await page.reload();await page.getByTestId('login-email').waitFor();assert.equal(await page.evaluate(()=>window.__av8ReadOnlyUnsafeProbe),undefined);
   const nextNonce=(next.headers()['content-security-policy']||'').match(/'nonce-([^']+)'/)?.[1];assert.ok(nextNonce);assert.notEqual(nextNonce,nonce);
   results.push({healthStatus:health.status(),anonymousAuthStatus:unauthenticated.status(),uniqueCspNonce:true,unsafeInlineProbeBlocked:true,credentialsSubmitted:false,mfaBypassed:false});
  }
  await context.close();
 }
 const evidence={capturedAt:new Date().toISOString(),origin,scope:'Read-only hosted staging login shell/API health/anonymous denial/CSP. Authenticated business workflows and final production domain are not inferred.',results};
 await writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:'PASS',resultFile:`${output}/results.json`,credentialsSubmitted:false}));
}finally{await browser.close();}
