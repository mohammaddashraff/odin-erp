import fs from 'node:fs';
import path from 'node:path';
import {createDecipheriv,createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
async function main(){
 const [archive,keyFile,output]=process.argv.slice(2);if(!archive||!keyFile||!output||!path.isAbsolute(output)||fs.existsSync(output))throw new Error('Supply archive, private key file and a new private output file');
 const evidence=JSON.parse(fs.readFileSync(archive+'.json','utf8')),key=Buffer.from(fs.readFileSync(keyFile,'utf8').trim(),'hex'),stat=fs.statSync(archive);if(key.length!==32||stat.size<36)throw new Error('Invalid archive/key');
 const handle=fs.openSync(archive,'r'),header=Buffer.alloc(19),tag=Buffer.alloc(16);fs.readSync(handle,header,0,19,0);fs.readSync(handle,tag,0,16,stat.size-16);fs.closeSync(handle);if(header.subarray(0,7).toString()!=='AV8ENC1')throw new Error('Invalid archive format');
 const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(7));decipher.setAuthTag(tag);const digest=createHash('sha256');
 try{await pipeline(fs.createReadStream(archive,{start:19,end:stat.size-17}),decipher,new Transform({transform(chunk,_encoding,callback){digest.update(chunk);callback(null,chunk);}}),fs.createWriteStream(output,{flags:'wx',mode:0o600}));if(digest.digest('hex')!==evidence.sha256Plaintext)throw new Error('Backup digest differs');console.log(JSON.stringify({ok:true,decryptedFile:output,restored:false}));}
 catch(error){try{fs.unlinkSync(output);}catch{}throw error;}finally{key.fill(0);}
}
main().catch(()=>{console.error('Backup authentication/decryption failed; no database was altered.');process.exitCode=1;});
