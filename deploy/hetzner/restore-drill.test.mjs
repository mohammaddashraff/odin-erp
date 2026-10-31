import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {deploymentConfiguration} from './generate-config.mjs';
import {restorePlan,parseCompose,assertContainer,freshTargetProvisionSql,failureClassification} from './restore-drill.mjs';

function fixture(directory='/tmp/av8-restore-guard/private'){
  const configuration=deploymentConfiguration({mode:'staging',directory,imageTag:'synthetic-restore',origin:'http://127.0.0.1:18180'});
  return {...configuration,options:{privateDirectory:directory,backupDirectory:path.join(path.dirname(directory),'backups'),evidenceDirectory:path.join(path.dirname(directory),'evidence'),credentialsFile:path.join(directory,'bootstrap/initial-owner.json'),writersQuiesced:true,token:'abcdef0123456789abcdef01'}};
}

test('recovery rejects production, unquiesced writers, source restores and mixed project identities before orchestration',()=>{
  for(const change of [f=>f.api.AV8_ENV='production',f=>f.api.AV8_HOSTING='vercel',f=>f.compose.AV8_COMPOSE_PROJECT='existing-other-app',f=>f.api.AV8_HETZNER_RESOURCE='av8-erp-production:wrong',f=>f.api.AV8_HETZNER_DB_NAME='av8_staging_restore_existing',f=>f.options.writersQuiesced=false]){
    const f=fixture();change(f);assert.throws(()=>restorePlan(f.api,f.compose,f.options));
  }
});

test('recovery rejects inherited database URLs, source credentials mixed with another host, or unsafe cleanup names',()=>{
  for(const change of [f=>f.api.DATABASE_URL_UNPOOLED=f.api.DATABASE_ADMIN_URL.replace('av8-postgres','other-db'),f=>f.api.DATABASE_URL=f.api.DATABASE_URL.replace('sslmode=disable','sslmode=disable&options=-crow_security=off'),f=>f.api.DATABASE_ADMIN_URL=f.api.DATABASE_ADMIN_URL.replace(f.api.AV8_HETZNER_DB_NAME,'other_database'),f=>f.options.token='source;DROP DATABASE postgres']){
    const f=fixture();change(f);assert.throws(()=>restorePlan(f.api,f.compose,f.options));
  }
});

test('recovery directories and credentials cannot overlap backup storage or escape named private configuration',()=>{
  for(const change of [f=>f.options.backupDirectory=path.join(f.options.privateDirectory,'backups'),f=>f.options.evidenceDirectory=f.options.backupDirectory,f=>f.options.credentialsFile='/tmp/unrelated-owner.json',f=>f.options.privateDirectory='/tmp/private/../private']){
    const f=fixture();change(f);assert.throws(()=>restorePlan(f.api,f.compose,f.options));
  }
});

test('restored API gets independent identity and signing secret, all credential URL overrides retargeted, and delivery disabled without mutating source',()=>{
  const f=fixture();f.api.DATABASE_URL_UNPOOLED=f.api.DATABASE_ADMIN_URL;f.api.POSTGRES_URL_NON_POOLING=f.api.DATABASE_ADMIN_URL;
  for(const flag of ['AV8_ACADEMIC_EMAIL_ENABLED','AV8_ACADEMIC_WORKER_ENABLED','AV8_OPERATIONS_WORKER_ENABLED','AV8_SCHEDULER_ENABLED','AV8_ALERT_EMAIL_ENABLED'])f.api[flag]='true';
  f.api.AV8_INITIAL_SETUP='EMPTY_DATABASE_ONLY';f.api.AV8_ACADEMIC_EMAIL_API_KEY='synthetic-not-a-provider-key';
  const original=structuredClone(f.api),plan=restorePlan(f.api,f.compose,f.options);
  assert.deepEqual(f.api,original);assert.notEqual(plan.source,plan.target);assert.notEqual(plan.resource,plan.sourceResource);
  for(const key of ['DATABASE_URL','DATABASE_ADMIN_URL','DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'])assert.equal(new URL(plan.recovery[key]).pathname,`/${plan.target}`);
  for(const flag of ['AV8_ACADEMIC_EMAIL_ENABLED','AV8_ACADEMIC_WORKER_ENABLED','AV8_OPERATIONS_WORKER_ENABLED','AV8_SCHEDULER_ENABLED','AV8_ALERT_EMAIL_ENABLED'])assert.equal(plan.recovery[flag],'false');
  assert.notEqual(plan.recovery.ODIN_TOKEN_SECRET,f.api.ODIN_TOKEN_SECRET);assert.equal(plan.recovery.ODIN_MFA_ENCRYPTION_KEY,f.api.ODIN_MFA_ENCRYPTION_KEY);
  assert.equal(plan.recovery.AV8_ACADEMIC_EMAIL_API_KEY,'');assert.equal(plan.recovery.AV8_INITIAL_SETUP,undefined);assert.equal(plan.recovery.ODIN_REQUIRE_PRIVILEGED_MFA,'true');
});

test('actual container identity rejects another Compose project, stopped DB or published database ports',()=>{
  const good={Config:{Labels:{'com.docker.compose.project':'av8-delivery-staging','com.docker.compose.service':'av8-postgres'}},State:{Running:true},HostConfig:{PortBindings:{}},NetworkSettings:{Ports:{'5432/tcp':null}}};
  assert.doesNotThrow(()=>assertContainer(good,'av8-postgres'));
  for(const change of [c=>c.Config.Labels['com.docker.compose.project']='av8-delivery-prod',c=>c.State.Running=false,c=>c.HostConfig.PortBindings={'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'5548'}]}]){const copy=structuredClone(good);change(copy);assert.throws(()=>assertContainer(copy,'av8-postgres'));}
});

test('schema-scoped dump preparation drops only an empty generated target public schema and never cascades',()=>{
  const f=fixture(),plan=restorePlan(f.api,f.compose,f.options),sql=freshTargetProvisionSql(plan);
  assert.match(sql,/^DROP SCHEMA public;/);assert.doesNotMatch(sql,/CASCADE|DROP DATABASE/);assert.doesNotMatch(sql,new RegExp(`DATABASE "${plan.source}"`));
  for(const target of [plan.source,'postgres','av8_prod_real','av8_staging_restore_forged'])assert.throws(()=>freshTargetProvisionSql({...plan,target}));
  assert.throws(()=>freshTargetProvisionSql({...plan,resource:plan.sourceResource}));
});

test('private command failures publish only fixed classifications, without raw stderr or secret fragments',()=>{
  assert.equal(failureClassification('pg_restore: ERROR: schema "public" already exists'),'RESTORE_SCHEMA_ALREADY_EXISTS');
  assert.equal(failureClassification('permission denied for schema public'),'DATABASE_PERMISSION_DENIED');
  assert.equal(failureClassification('row-level security policy'),'DATABASE_RLS_DENIED');
  assert.equal(failureClassification('connection refused; PRIVATE-SECRET'),'DATABASE_CONNECTION_FAILED');
  assert.equal(failureClassification('PRIVATE-SECRET unexpected'),'CHILD_COMMAND_FAILED');
});

test('Compose configuration parsing rejects expansion, duplicate keys and shell-bearing input',()=>{
  assert.deepEqual(parseCompose('AV8_COMPOSE_PROJECT=av8-delivery-staging\nAV8_POSTGRES_IMAGE=postgres@sha256:abcdef\n'),{AV8_COMPOSE_PROJECT:'av8-delivery-staging',AV8_POSTGRES_IMAGE:'postgres@sha256:abcdef'});
  for(const source of ['AV8_PRIVATE_DIR=$(id)','AV8_PRIVATE_DIR=${HOME}','AV8_IMAGE_TAG=one\nAV8_IMAGE_TAG=two','AV8_PRIVATE_DIR=/tmp/private;echo-bad'])assert.throws(()=>parseCompose(source));
});

test('CLI actual identity rejection issues no backup/create/drop commands and never prints private credentials',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'av8-restore-reject-')),directory=path.join(root,'private'),bin=path.join(root,'bin');fs.mkdirSync(directory,{mode:0o700});fs.mkdirSync(path.join(directory,'bootstrap'));fs.mkdirSync(bin);
  const f=fixture(directory),record=path.join(root,'commands.jsonl');
  fs.writeFileSync(path.join(directory,'api.json'),JSON.stringify(f.api),{mode:0o600});fs.writeFileSync(path.join(directory,'backup-key'),'a'.repeat(64),{mode:0o600});fs.writeFileSync(f.options.credentialsFile,JSON.stringify({email:'synthetic@example.test',temporaryPassword:'DO-NOT-PRINT-SYNTHETIC-PRIVATE-PASSWORD'}),{mode:0o600});
  fs.writeFileSync(path.join(directory,'compose.env'),Object.entries(f.compose).map(([k,v])=>`${k}=${v}`).join('\n'));
  fs.writeFileSync(path.join(bin,'docker'),`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.AV8_RESTORE_TEST_COMMANDS,JSON.stringify(args)+'\\n');if(args[0]==='compose')console.log('a'.repeat(64));else console.log(JSON.stringify([{Config:{Labels:{'com.docker.compose.project':'UNRELATED-APPLICATION','com.docker.compose.service':'av8-postgres'}},State:{Running:true}}]));\n`,{mode:0o700});
  try{
    const result=spawnSync(process.execPath,[path.resolve('deploy/hetzner/restore-drill.mjs'),'--private-directory',directory,'--backup-directory',f.options.backupDirectory,'--evidence-directory',f.options.evidenceDirectory,'--credentials-file',f.options.credentialsFile,'--writers-quiesced'],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,AV8_RESTORE_TEST_COMMANDS:record}});
    assert.equal(result.status,1);assert.doesNotMatch(result.stdout+result.stderr,/DO-NOT-PRINT|synthetic@example|postgresql:|MFA_ENCRYPTION/);
    const commands=fs.readFileSync(record,'utf8');assert.doesNotMatch(commands,/pg_dump|pg_restore|CREATE|DROP|"rm"|"run"/);
    assert.equal(fs.readFileSync(path.join(directory,'backup-key'),'utf8'),'a'.repeat(64));assert.equal(fs.readdirSync(f.options.backupDirectory).length,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
