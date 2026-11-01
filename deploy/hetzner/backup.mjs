import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

async function main(){
 const [privateDirectory,outputDirectory]=process.argv.slice(2);if(!privateDirectory||!outputDirectory||!path.isAbsolute(privateDirectory)||!path.isAbsolute(outputDirectory)||path.resolve(outputDirectory).startsWith(path.resolve(privateDirectory)+path.sep))throw new Error('Select separate absolute private-configuration and backup directories');
 const configuration=JSON.parse(fs.readFileSync(path.join(privateDirectory,'api.json'),'utf8')),database=configuration.AV8_HETZNER_DB_NAME;
 if(configuration.AV8_HOSTING!=='hetzner'||!/^av8_(prod|staging)_[a-z0-9_]+$/.test(database))throw new Error('Explicit isolated Hetzner database required');
 const key=Buffer.from(fs.readFileSync(path.join(privateDirectory,'backup-key'),'utf8').trim(),'hex');if(key.length!==32)throw new Error('A separately stored 32-byte backup key is required');
 fs.mkdirSync(outputDirectory,{recursive:true,mode:0o700});const filename=path.join(outputDirectory,`av8-${new Date().toISOString().replace(/[:.]/g,'-')}.dump.enc`),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),digest=createHash('sha256');
 const output=fs.createWriteStream(filename,{flags:'wx',mode:0o600});output.write(Buffer.concat([Buffer.from('AV8ENC1'),iv]));
 const child=spawn('docker',['compose','--env-file',path.join(privateDirectory,'compose.env'),'-f',path.resolve('deploy/hetzner/compose.yaml'),'exec','-T','av8-postgres','pg_dump','--username=av8_bootstrap',`--dbname=${database}`,'--format=custom','--no-owner','--schema=public'],{stdio:['ignore','pipe','pipe']});
 let stderrBytes=0;child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;});const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code));});
 try{const [dumpExit]=await Promise.all([exited,pipeline(child.stdout,new Transform({transform(chunk,_encoding,callback){digest.update(chunk);callback(null,chunk);}}),cipher,output)]);if(dumpExit!==0)throw new Error('Database dump failed');fs.appendFileSync(filename,cipher.getAuthTag());
 const evidence={createdAt:new Date().toISOString(),sourceResource:configuration.AV8_HETZNER_RESOURCE,schema:'public; target environment marker is managed separately',encryption:'AES-256-GCM',sha256Plaintext:digest.digest('hex'),encryptedBytes:fs.statSync(filename).size,stderrBytes,restoreVerified:false};fs.writeFileSync(filename+'.json',JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({ok:true,archive:filename,encryptedBytes:evidence.encryptedBytes,restoreVerified:false}));
 }catch(error){child.kill('SIGTERM');try{fs.unlinkSync(filename);}catch{}throw error;}finally{key.fill(0);}
}
main().catch(()=>{console.error('Encrypted AV8 backup failed; inspect the selected isolated project and private key without printing credentials.');process.exitCode=1;});
