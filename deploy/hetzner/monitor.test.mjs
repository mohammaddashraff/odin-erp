import {test} from 'node:test';
import assert from 'node:assert/strict';
import {monitorOnce,alertConfiguration} from './monitor.mjs';
const env={AV8_ENV:'staging',AV8_HETZNER_RESOURCE:'av8-erp-staging:synthetic-monitor',AV8_ALERT_EMAIL_ENABLED:'true',AV8_ALERT_EMAIL_TO:'operator@example.invalid',AV8_ACADEMIC_EMAIL_FROM:'sender@example.invalid',AV8_ACADEMIC_EMAIL_API_KEY:'synthetic-provider-key',AV8_ACADEMIC_EMAIL_PROVIDER:'resend',AV8_ACADEMIC_TEST_RECIPIENTS:'operator@example.invalid'};
const storage=()=>{let saved;return{load:async()=>saved,save:async value=>{saved=structuredClone(value);}};};
test('monitor validates explicit alert enablement and staging recipient allowlist',()=>{assert.deepEqual(alertConfiguration({}),{enabled:false});assert.throws(()=>alertConfiguration({...env,AV8_ACADEMIC_TEST_RECIPIENTS:''}));assert.throws(()=>alertConfiguration({...env,AV8_ACADEMIC_EMAIL_API_KEY:''}));});
test('one alert per outage and recovery; no student or credential text in body',async()=>{
 const store=storage(),calls=[];let healthy=false;const transport=async(url,options)=>{calls.push({url,options});return url.includes('resend')?{ok:true,json:async()=>({id:'synthetic-provider-reference'})}:{ok:healthy};};
 assert.equal((await monitorOnce({env,store,transport})).alert,'ACCEPTED');await monitorOnce({env,store,transport});healthy=true;assert.equal((await monitorOnce({env,store,transport})).alert,'ACCEPTED');await monitorOnce({env,store,transport});
 const sent=calls.filter(c=>c.url.includes('resend'));assert.equal(sent.length,2);for(const call of sent)assert.doesNotMatch(JSON.parse(call.options.body).text,/synthetic-provider-key|operator@/);
});
test('ambiguous send persists unknown and never auto-retries after restart',async()=>{
 const store=storage();let sends=0;const transport=async url=>{if(url.includes('resend')){sends++;throw new Error('Synthetic timeout after send');}return{ok:false};};
 assert.equal((await monitorOnce({env,store,transport})).alert,'DELIVERY_UNKNOWN');await monitorOnce({env,store,transport});assert.equal(sends,1);assert.equal(Object.values((await store.load()).alerts)[0].status,'DELIVERY_UNKNOWN');
});
test('same controlled test identity sends once and disabled monitoring cannot send tests',async()=>{
 const store=storage();let sends=0;const transport=async()=>{sends++;return{ok:true,json:async()=>({id:'synthetic-test'})};};await monitorOnce({env,store,transport,testId:'controlled-test-1'});await monitorOnce({env,store,transport,testId:'controlled-test-1'});assert.equal(sends,1);
 await assert.rejects(monitorOnce({env:{...env,AV8_ALERT_EMAIL_ENABLED:'false'},store,transport,testId:'controlled-test-2'}));
});
test('enabled scheduler failure is monitored and uses only its distinct bearer token',async()=>{
 const store=storage(),calls=[];const transport=async(url,options)=>{calls.push({url,options});if(url.includes('resend'))return{ok:true,json:async()=>({id:'synthetic-alert'})};return{ok:!url.endsWith('/tick')};};
 const result=await monitorOnce({env:{...env,AV8_SCHEDULER_ENABLED:'true',AV8_SCHEDULER_SECRET:'synthetic-distinct-scheduler'},store,transport});assert.equal(result.healthy,false);assert.equal(calls.find(c=>c.url.endsWith('/tick')).options.headers.Authorization,'Bearer synthetic-distinct-scheduler');
});
test('monitor sends the validated display sender and optional Reply-To without accepting header injection',async()=>{
 const store=storage(),calls=[],transport=async(_url,options)=>{calls.push(options);return{ok:true,json:async()=>({id:'synthetic-reply-to-alert'})};};
 await monitorOnce({env:{...env,AV8_ACADEMIC_EMAIL_FROM:'Example Flight Academy <sender@example.invalid>',AV8_ACADEMIC_EMAIL_REPLY_TO:'Replies@example.invalid'},store,transport,testId:'controlled-reply-to'});
 assert.equal(JSON.parse(calls[0].body).from,'Example Flight Academy <sender@example.invalid>');assert.equal(JSON.parse(calls[0].body).reply_to,'replies@example.invalid');
 await assert.rejects(monitorOnce({env:{...env,AV8_ACADEMIC_EMAIL_REPLY_TO:'one@example.invalid\nBcc: two@example.invalid'},store,transport,testId:'controlled-invalid'}));assert.equal(calls.length,1);
});
