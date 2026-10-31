import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deploymentConfiguration,writeConfiguration} from './generate-config.mjs';

test('staging and production have distinct data identities, secrets and loopback ports',()=>{
 const options={directory:'/private/tmp/synthetic-av8',imageTag:'candidate-tested'},stage=deploymentConfiguration({...options,mode:'staging'}),prod=deploymentConfiguration({...options,mode:'production'});
 assert.equal(stage.compose.AV8_WEB_PORT,'18180');assert.equal(prod.compose.AV8_WEB_PORT,'18181');assert.notEqual(stage.api.DATABASE_URL,prod.api.DATABASE_URL);assert.notEqual(stage.api.ODIN_TOKEN_SECRET,prod.api.ODIN_TOKEN_SECRET);assert.notEqual(stage.api.AV8_HETZNER_RESOURCE,prod.api.AV8_HETZNER_RESOURCE);assert.equal(stage.api.AV8_SCHEDULER_ENABLED,'false');assert.equal(prod.api.AV8_ALERT_EMAIL_ENABLED,'false');assert.equal(new URL(prod.api.DATABASE_URL).hostname,'av8-postgres');assert.equal(prod.api.ODIN_PUBLIC_ORIGIN,'https://av8.odin-ltd.com');assert.equal(stage.web.DATABASE_URL,undefined);
 assert.equal(stage.compose.AV8_PROVIDER_CONFIG_FILE,'/srv/av8-erp-final/private/resend.env');assert.equal(prod.compose.AV8_PROVIDER_CONFIG_FILE,path.join(options.directory,'provider.env'));
});
test('new production provider file is empty and cannot inherit a staging credential',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'av8-provider-separation-')),stage=path.join(root,'staging.env'),directory=path.join(root,'production');fs.writeFileSync(stage,'AV8_ACADEMIC_EMAIL_API_KEY=synthetic-staging-key\n');
 try{assert.throws(()=>deploymentConfiguration({mode:'production',directory,imageTag:'candidate-tested',providerConfigFile:stage}));writeConfiguration({mode:'production',directory,imageTag:'candidate-tested'});const provider=fs.readFileSync(path.join(directory,'provider.env'),'utf8');assert.doesNotMatch(provider,/synthetic-staging-key|AV8_ACADEMIC_EMAIL_API_KEY=/);const api=JSON.parse(fs.readFileSync(path.join(directory,'api.json'),'utf8'));assert.equal(api.AV8_ACADEMIC_EMAIL_API_KEY,'');assert.equal(api.AV8_ACADEMIC_EMAIL_ENABLED,'false');assert.equal(api.AV8_ALERT_EMAIL_ENABLED,'false');}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unapproved public origin, privileged port and unsafe directory are rejected',()=>{
 const options={mode:'production',directory:'/private/tmp/synthetic-av8',imageTag:'candidate-tested'};
 for(const change of [{origin:'http://av8.odin-ltd.com'},{origin:'https://wrong.example.invalid'},{webPort:80},{directory:'relative'},{directory:'/tmp/unsafe$path'},{imageTag:'bad tag'}])assert.throws(()=>deploymentConfiguration({...options,...change}));
 assert.throws(()=>deploymentConfiguration({...options,mode:'staging',origin:'https://av8.odin-ltd.com'}));
});
test('private configuration generation never overwrites credentials or prints secrets',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'av8-deployment-config-')),directory=path.join(root,'private');
 try{const result=writeConfiguration({mode:'staging',directory,imageTag:'candidate-tested'});assert.equal(result.secretsPrinted,false);assert.equal(fs.statSync(directory).mode&0o777,0o700);assert.equal(fs.statSync(path.join(directory,'api.json')).mode&0o777,0o600);assert.throws(()=>writeConfiguration({mode:'staging',directory,imageTag:'candidate-tested'}));assert.doesNotMatch(JSON.stringify(result),/postgresql|ODIN_TOKEN|temporaryPassword/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
