import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

// Read-only final-domain acceptance. Never submits credentials, forms or business mutations; anonymous refresh may be denied normally.
// The release operator must explicitly confirm promotion before any network/browser activity.
const origin=process.env.AV8_PRODUCTION_SMOKE_ORIGIN;
if(origin!=='https://av8.odin-ltd.com'||process.env.AV8_PRODUCTION_ROUTE_PROMOTED!=='true')throw new Error('Run only after the exact AV8 production HTTPS route has been promoted');
if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Error('Certificate verification must remain enabled');
const output='output/playwright/production-smoke';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
const results=[],diagnostics=[],blockedRequests=[],anonymousRefreshChecks=[];
const safePath=value=>{try{return new URL(value).pathname;}catch{return '[invalid URL]';}};
const noStore=(response,label)=>{
  const headers=response.headers();assert.match(headers['cache-control']||'',/(?:^|[,\s])no-store(?:$|[,\s])/i,`${label} must not be cached`);
  assert.ok(!headers.age||Number(headers.age)===0,`${label} cannot be an aged cached response`);
  for(const name of ['x-cache','cf-cache-status','x-vercel-cache'])assert.ok(!/\bHIT\b/i.test(headers[name]||''),`${label} unexpectedly returned a shared cache HIT`);
};
const scriptNonce=response=>{
  const policy=response.headers()['content-security-policy']||'',scripts=policy.split(';').find(value=>value.trim().startsWith('script-src '))||'';
  assert.ok(scripts.includes("'strict-dynamic'"));assert.ok(!scripts.includes("'unsafe-inline'"));assert.ok(!scripts.includes("'unsafe-eval'"));
  const nonce=scripts.match(/'nonce-([^']+)'/)?.[1];assert.ok(nonce,'A real per-document script nonce is required');return nonce;
};
try{
  for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
    const context=await browser.newContext({baseURL:origin,viewport:{width:viewport.width,height:viewport.height},ignoreHTTPSErrors:false,serviceWorkers:'block'});
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin===origin&&url.pathname==='/api/auth/refresh'&&!url.search&&request.method()==='POST'){
        // The anonymous login shell may probe refresh. Never forward any session credential.
        const headers=await request.allHeaders();
        if(headers.authorization||request.postData()||(headers.cookie||'').split(';').some(cookie=>cookie.trim()&&!cookie.trim().startsWith('av8_language='))){blockedRequests.push({path:url.pathname,method:'POST',reason:'Unexpected credential or body on anonymous refresh'});await route.abort('blockedbyclient');return;}
        headers.cookie='';
        const actual=await route.fetch({headers,maxRedirects:0});assert.equal(actual.status(),401);noStore(actual,'Anonymous refresh response');
        const payload=await actual.json();assert.ok(!payload.user&&!payload.accessToken&&!payload.token,'Anonymous refresh cannot grant a session');
        anonymousRefreshChecks.push({status:401,noStore:true,credentialsForwarded:false});await route.fulfill({response:actual});return;
      }
      if(url.origin!==origin||!['GET','HEAD'].includes(request.method())){blockedRequests.push({path:url.pathname,method:request.method(),sameOrigin:url.origin===origin});await route.abort('blockedbyclient');return;}
      await route.continue();
    });
    await context.addCookies([{name:'av8_language',value:'en',url:origin,secure:true}]);
    await context.addInitScript(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('av8_language','en');localStorage.setItem('odin-theme','light');window.__av8CspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.__av8CspViolations.push({directive:event.effectiveDirective,blockedURI:event.blockedURI}));});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('requestfailed',request=>diagnostics.push({kind:'requestfailed',path:safePath(request.url()),message:request.failure()?.errorText}));
    const response=await page.goto('/login',{waitUntil:'domcontentloaded',timeout:60000});
    assert.ok(response);assert.equal(response.status(),200);assert.equal(new URL(page.url()).origin,origin);noStore(response,'Login document');
    const tls=await response.securityDetails();assert.ok(tls,'Browser must establish verified TLS');assert.ok(/^TLS\s*1\.[23]$/.test(tls.protocol),`Unexpected TLS protocol: ${tls.protocol}`);
    assert.ok(tls.validFrom*1000<=Date.now()&&tls.validTo*1000>Date.now(),'Certificate must be currently valid');
    const nonce=scriptNonce(response);
    await page.getByTestId('login-email').waitFor();assert.equal(await page.locator('html').getAttribute('dir'),'ltr');assert.equal(await page.locator('html').getAttribute('lang'),'en');
    await page.getByTestId('login-email').focus();assert.equal(await page.getByTestId('login-email').evaluate(element=>element===document.activeElement),true);
    assert.equal(await page.getByTestId('login-email').inputValue(),'');assert.equal(await page.getByTestId('login-password').inputValue(),'');
    await page.getByTestId('show-password').click();assert.equal(await page.getByTestId('login-password').getAttribute('type'),'text');
    await page.getByTestId('show-password').click();assert.equal(await page.getByTestId('login-password').getAttribute('type'),'password');
    const remember=page.getByRole('checkbox',{name:'Remember me',exact:true});await remember.uncheck();assert.equal(await remember.isChecked(),false);await remember.check();assert.equal(await remember.isChecked(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:`${output}/${viewport.name}-login-en.png`,fullPage:true});
    await page.getByTestId('language-toggle').click();await page.waitForFunction(()=>document.documentElement.lang==='ar'&&document.documentElement.dir==='rtl');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.getByTestId('show-password').click();assert.equal(await page.getByTestId('login-password').getAttribute('type'),'text');await page.getByTestId('show-password').click();
    await page.screenshot({path:`${output}/${viewport.name}-login-ar.png`,fullPage:true});
    if(viewport.name==='desktop'){
      // Explicit probes use GET only. An automatic empty anonymous refresh is separately checked above.
      const health=await context.request.get(`${origin}/api/health`,{maxRedirects:0});assert.equal(health.status(),200);noStore(health,'Health response');
      const anonymous=await context.request.get(`${origin}/api/auth/me`,{maxRedirects:0});assert.equal(anonymous.status(),401);noStore(anonymous,'Anonymous authentication response');
      const forged=await context.request.get(`${origin}/api/auth/me`,{maxRedirects:0,headers:{authorization:'Bearer av8-read-only-smoke-invalid-token','x-forwarded-for':'127.0.0.1','x-real-ip':'127.0.0.1','x-vercel-forwarded-for':'127.0.0.1','x-vercel-trusted-oidc-idp-token':'av8-read-only-smoke-forged-identity','cache-control':'max-age=31536000'}});
      assert.equal(forged.status(),401);noStore(forged,'Forged-header authentication response');
      const payload=await forged.json();assert.ok(!payload.user&&!payload.accessToken&&!payload.token&&!payload.permissions,'Unauthorized response must not expose an authenticated payload');
      const anonymousAgain=await context.request.get(`${origin}/api/auth/me`,{maxRedirects:0});assert.equal(anonymousAgain.status(),401);noStore(anonymousAgain,'Repeated anonymous authentication response');
      // Alter only this browser's intercepted response. No server content is modified.
      await page.route(`${origin}/login`,async route=>{assert.equal(route.request().method(),'GET');const actual=await route.fetch({maxRedirects:0});assert.equal(actual.status(),200);const html=await actual.text();assert.ok(html.includes('</head>'));await route.fulfill({response:actual,body:html.replace('</head>','<script>window.__av8UnsafeProductionProbe=true</script></head>')});},{times:1});
      const reloaded=await page.reload({waitUntil:'domcontentloaded'});assert.ok(reloaded);await page.getByTestId('login-email').waitFor();
      assert.equal(await page.evaluate(()=>window.__av8UnsafeProductionProbe),undefined);
      await page.waitForFunction(()=>window.__av8CspViolations.some(event=>event.blockedURI==='inline'&&event.directive.startsWith('script-src')));
      assert.notEqual(scriptNonce(reloaded),nonce);noStore(reloaded,'Reloaded login document');
      results.push({healthStatus:200,anonymousAuthStatus:401,forgedHeaderAuthStatus:401,repeatedAnonymousAuthStatus:401,apiResponsesNoStore:true,uniqueCspNonce:true,unsafeInlineProbeBlocked:true,forwardedHeaderClaim:'Forged forwarding/workload headers did not authenticate; internal IP forwarding and rate-limit attribution require server-side evidence.'});
    }
    assert.deepEqual(errors,[]);results.push({viewport:viewport.name,english:'PASS',arabic:'PASS',interactiveEmptyForm:true,overflow:false,pageErrors:errors,tls:{protocol:tls.protocol,issuer:tls.issuer,subjectName:tls.subjectName,validFrom:new Date(tls.validFrom*1000).toISOString(),validTo:new Date(tls.validTo*1000).toISOString(),browserCertificateValidation:true}});
    await context.close();
  }
  assert.deepEqual(blockedRequests,[],'Login shell attempted an external or unauthorized mutating request');
  const evidence={status:'PASS',capturedAt:new Date().toISOString(),origin,scope:'Read-only final HTTPS login shell, EN/AR desktop/mobile interactions, public API health, anonymous/forged-header denial, no-store responses and actual browser CSP enforcement. Authenticated business workflows, owner credentials, production money and provider delivery are not inferred.',credentialsSubmitted:false,formSubmitted:false,businessMutations:false,allowedRequestMethods:['GET','HEAD','POST /api/auth/refresh only, empty and without credentials'],anonymousRefreshChecks,results};
  await writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:'PASS',resultFile:`${output}/results.json`,credentialsSubmitted:false,businessMutations:false}));
}catch(error){await writeFile(`${output}/failure.json`,JSON.stringify({status:'FAIL',capturedAt:new Date().toISOString(),origin,message:error.message,diagnostics,blockedRequests},null,2)+'\n');throw error;}finally{await browser.close();}
