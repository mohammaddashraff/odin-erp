import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseProviderConfiguration,loadProviderConfiguration,providerReplyTo,providerSender} from './provider-config.mjs';

test('provider file permits only literal sender/key and cannot enable email or alter application configuration',()=>{
 const values=parseProviderConfiguration('# Private fixture\nAV8_ACADEMIC_EMAIL_API_KEY="synthetic-key"\nexport AV8_ACADEMIC_EMAIL_FROM=sender@example.invalid # fixture\n');assert.deepEqual(values,{AV8_ACADEMIC_EMAIL_API_KEY:'synthetic-key',AV8_ACADEMIC_EMAIL_FROM:'sender@example.invalid'});
 for(const key of ['AV8_ACADEMIC_EMAIL_ENABLED','AV8_ALERT_EMAIL_TO','DATABASE_URL','NODE_OPTIONS'])assert.throws(()=>parseProviderConfiguration(`${key}=private-synthetic-value`),error=>!error.message.includes('private-synthetic-value'));
 assert.throws(()=>parseProviderConfiguration('AV8_ACADEMIC_EMAIL_API_KEY=${OTHER_SECRET}'));
});
test('duplicate or malformed values fail without disclosing the supplied secret',()=>{
 for(const value of ['AV8_ACADEMIC_EMAIL_API_KEY=TOP_SECRET\nAV8_ACADEMIC_EMAIL_API_KEY=OTHER_SECRET','AV8_ACADEMIC_EMAIL_API_KEY="TOP_SECRET','invalid TOP_SECRET','AV8_ACADEMIC_EMAIL_FROM="sender@example.invalid" trailing'])assert.throws(()=>parseProviderConfiguration(value),error=>!error.message.includes('TOP_SECRET')&&!error.message.includes('OTHER_SECRET')&&!error.message.includes('sender@'));
});
test('absent/empty provider file preserves existing configuration and disabled switches',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'av8-provider-test-')),file=path.join(directory,'provider.env'),environment={AV8_ACADEMIC_EMAIL_ENABLED:'false',AV8_ALERT_EMAIL_ENABLED:'false',AV8_ACADEMIC_EMAIL_FROM:'existing@example.invalid'};
 try{assert.equal(loadProviderConfiguration(file,environment),environment);fs.writeFileSync(file,'AV8_ACADEMIC_EMAIL_API_KEY=\nAV8_ACADEMIC_EMAIL_FROM=\n',{mode:0o600});loadProviderConfiguration(file,environment);assert.equal(environment.AV8_ACADEMIC_EMAIL_FROM,'existing@example.invalid');assert.equal(environment.AV8_ACADEMIC_EMAIL_ENABLED,'false');assert.equal(environment.AV8_ALERT_EMAIL_ENABLED,'false');fs.writeFileSync(file,'AV8_ACADEMIC_EMAIL_API_KEY=synthetic-new-key\n');loadProviderConfiguration(file,environment);assert.equal(environment.AV8_ACADEMIC_EMAIL_API_KEY,'synthetic-new-key');assert.equal(environment.AV8_ACADEMIC_EMAIL_ENABLED,'false');}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('named sender and optional Reply-To are single validated mailboxes without control characters',()=>{
 const values=parseProviderConfiguration('AV8_ACADEMIC_EMAIL_FROM=Example Flight Academy <sender@example.invalid>\nAV8_ACADEMIC_EMAIL_REPLY_TO=Replies@example.invalid\n');assert.equal(values.AV8_ACADEMIC_EMAIL_FROM,'Example Flight Academy <sender@example.invalid>');assert.equal(values.AV8_ACADEMIC_EMAIL_REPLY_TO,'replies@example.invalid');
 for(const value of ['one@example.invalid,two@example.invalid','Person <one@example.invalid>','one@example.invalid\r\nBcc: other@example.invalid','one@example.invalid\n','a..b@example.invalid'])assert.throws(()=>providerReplyTo(value));
 for(const value of ['One <one@example.invalid>, Two <two@example.invalid>','Name\nBcc <one@example.invalid>','Name;Other <one@example.invalid>'])assert.throws(()=>providerSender(value));
 assert.throws(()=>parseProviderConfiguration('AV8_ACADEMIC_EMAIL_REPLY_TO=one@example.invalid\nAV8_ACADEMIC_EMAIL_REPLY_TO=two@example.invalid'));assert.deepEqual(parseProviderConfiguration('AV8_ACADEMIC_EMAIL_REPLY_TO=\n'),{});
});
