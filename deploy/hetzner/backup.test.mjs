import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('backup encryption round-trips exact dump bytes and rejects tampering before restore',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'av8-backup-test-')),privateDirectory=path.join(root,'private'),outputDirectory=path.join(root,'backups'),bin=path.join(root,'bin');
 fs.mkdirSync(privateDirectory,{mode:0o700});fs.mkdirSync(bin);fs.writeFileSync(path.join(privateDirectory,'api.json'),JSON.stringify({AV8_HOSTING:'hetzner',AV8_HETZNER_DB_NAME:'av8_staging_synthetic',AV8_HETZNER_RESOURCE:'av8-erp-staging:synthetic-backup'}));fs.writeFileSync(path.join(privateDirectory,'backup-key'),randomBytes(32).toString('hex'),{mode:0o600});fs.writeFileSync(path.join(privateDirectory,'compose.env'),'');
 // Isolated fixture replaces only the child dump producer; no Docker daemon or database is contacted.
 fs.writeFileSync(path.join(bin,'docker'),'#!/bin/sh\nprintf "SYNTHETIC exact PostgreSQL custom dump bytes"\n',{mode:0o700});
 const run=(file,args)=>spawnSync(process.execPath,[path.resolve('deploy/hetzner',file),...args],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`}});
 try{const backup=run('backup.mjs',[privateDirectory,outputDirectory]);assert.equal(backup.status,0,backup.stderr);const archive=JSON.parse(backup.stdout).archive,out=path.join(root,'verified.dump'),keyFile=path.join(privateDirectory,'backup-key');
   assert.equal(run('decrypt-backup.mjs',[archive,keyFile,out]).status,0);assert.equal(fs.readFileSync(out,'utf8'),'SYNTHETIC exact PostgreSQL custom dump bytes');assert.equal(fs.statSync(out).mode&0o777,0o600);
   const damaged=fs.readFileSync(archive);damaged[25]^=1;fs.writeFileSync(archive,damaged);const rejected=path.join(root,'rejected.dump');assert.equal(run('decrypt-backup.mjs',[archive,keyFile,rejected]).status,1);assert.equal(fs.existsSync(rejected),false);assert.equal(fs.readFileSync(out,'utf8'),'SYNTHETIC exact PostgreSQL custom dump bytes');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
