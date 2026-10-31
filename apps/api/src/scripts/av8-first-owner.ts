import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import {PrismaService} from '../prisma.service';
import {createFirstOwner,firstOwnerConfiguration} from '../av8-first-owner';

async function main(){
  const config=firstOwnerConfiguration(),directory='/run/av8-bootstrap',output=`${directory}/initial-owner.json`;
  const stats=fs.statSync(directory);if(!stats.isDirectory()||(stats.mode&0o077)!==0)throw new Error('Mount a private owner-only bootstrap output directory');
  const password=randomBytes(36).toString('base64url');let saved=false;const db=new PrismaService();
  try{await db.onModuleInit();fs.writeFileSync(output,JSON.stringify({email:config.email,temporaryPassword:password,instructions:'Enroll MFA and change the temporary password within 24 hours. Store recovery codes privately.'},null,2)+'\n',{flag:'wx',mode:0o600});saved=true;
    const result=await createFirstOwner(db,config,password);console.log(JSON.stringify({ok:true,...result,credentialsFile:output,financialTransactions:0,policies:'DRAFT'}));
  }catch(error){if(saved)fs.unlinkSync(output);throw error;}finally{await db.onModuleDestroy();}
}
main().catch(()=>{console.error('Initial owner setup failed; verify explicit identity, empty database, permissions and private output directory. Existing installations require authenticated recovery.');process.exitCode=1;});
