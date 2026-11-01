import { NestFactory } from '@nestjs/core';
import { HttpException } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../auth';
import { Av8Service } from '../av8.service';
import { Av8OpeningService } from '../av8-opening.service';
import { ErpService } from '../erp.service';
import { supplierOpeningFixture } from '../av8-supplier-opening-fixture';
async function main(){if(!['dev','test'].includes(process.env.AV8_ENV||'')||!process.env.DATABASE_URL?.includes('/av8_'))throw new Error('Isolated synthetic environment required');const app=await NestFactory.createApplicationContext(AppModule,{logger:false});try{const f=await supplierOpeningFixture(app.get(PrismaService),app.get(AuthService),app.get(Av8Service),app.get(Av8OpeningService),app.get(ErpService));console.log(JSON.stringify({synthetic:true,supplierName:f.supplier.name,supplierId:String(f.supplier.id),bankAccountId:String(f.bank.id),...f.body}));}finally{await app.close();}}
main().catch(error=>{console.error(error instanceof HttpException?error.message:'Synthetic supplier fixture failed; no production fixture is permitted');process.exitCode=1;});
