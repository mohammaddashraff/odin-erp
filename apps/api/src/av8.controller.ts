import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { requestLanguage } from './i18n';
import { printText, printLabel, statementNotes, statementPdf } from './av8-print';
import { Av8Service } from './av8.service';
import { Av8FinanceService } from './av8-finance.service';
import { positiveId } from './av8-domain';
import { requireAv8 } from './av8-access';
import { serialize } from './money';
import { av8Csv } from './av8-export';

@Controller('api/av8')
export class Av8Controller {
  constructor(private av8:Av8Service,private finance:Av8FinanceService) {}
  @Get('refs') refs(@Req() r:any){return this.av8.refs(r.actor);}
  @Get('leads') leads(@Req() r:any,@Query() q:any){return this.av8.leads(r.actor,q);}
  @Get('leads/:id') lead(@Req() r:any,@Param('id') id:string){return this.av8.leadDetail(r.actor,positiveId(id));}
  @Post('leads') createLead(@Req() r:any,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.createLead(r.actor,b,k);}
  @Post('leads/import/preview') importPreview(@Req() r:any,@Body() b:any){return this.av8.importPreview(r.actor,b);}
  @Post('leads/import/commit') importCommit(@Req() r:any,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.importCommit(r.actor,b,k);}
  @Post('leads/:id/action') leadAction(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.leadAction(r.actor,positiveId(id),b,k);}
  @Post('leads/:id/convert') convert(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.convert(r.actor,positiveId(id),b,k);}
  @Get('applications') applications(@Req() r:any,@Query() q:any){return this.av8.applications(r.actor,q);}
  @Get('applications/:id') detail(@Req() r:any,@Param('id') id:string){return this.av8.detail(r.actor,positiveId(id));}
  @Post('applications/:id/medical') medical(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.medical(r.actor,positiveId(id),b,k);}
  @Post('applications/:id/contract') contract(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.contract(r.actor,positiveId(id),b,k);}
  @Post('applications/:id/receipts') @UseInterceptors(FileInterceptor('attachment',{limits:{fileSize:4*1024*1024,files:1}}))
  receipt(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string,@UploadedFile() file:any){return this.finance.receipt(r.actor,positiveId(id),b,k,file);}
  @Post('applications/:id/record') record(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.record(r.actor,positiveId(id),b,k);}
  @Post('applications/:id/anchor') anchor(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.customAnchor(r.actor,positiveId(id),b,k);}
  @Post('applications/:id/amendments') amendment(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.finance.amendment(r.actor,positiveId(id),b,k);}
  @Post('applications/:id/attachments/:recordId') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:4*1024*1024,files:1}}))
  upload(@Req() r:any,@Param('id') id:string,@Param('recordId') recordId:string,@UploadedFile() file:any){return this.av8.upload(r.actor,positiveId(id),positiveId(recordId),file);}
  @Get('attachments/:id') async download(@Req() r:any,@Param('id') id:string,@Res() res:Response){const f=await this.av8.download(r.actor,id);res.setHeader('Content-Type',f.contentType);res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`);res.setHeader('X-AV8-Scan','not-configured');res.send(f.content);}
  @Get('policies') policies(@Req() r:any){return this.av8.policies(r.actor);}
  @Post('policies') policy(@Req() r:any,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.savePolicy(r.actor,b,k);}
  @Get('funds') funds(@Req() r:any,@Query() q:any){return this.finance.list(r.actor,q);}
  @Post('funds') createFund(@Req() r:any,@Body() b:any,@Headers('idempotency-key') k:string){return this.finance.create(r.actor,b,k);}
  @Post('funds/:id/action') fundAction(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.finance.action(r.actor,positiveId(id),b,k);}
  @Post('funds/:id/allocations') allocation(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.finance.allocate(r.actor,positiveId(id),b,k);}
  @Post('allocations/:id/correct') correct(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.finance.correctAllocation(r.actor,positiveId(id),b,k);}
  @Post('refunds/:id/approve') refund(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.finance.approveRefund(r.actor,positiveId(id),b,k);}
  @Get('appointments') appointments(@Req() r:any,@Query() q:any){return this.av8.appointments(r.actor,q);}
  @Post('applications/:id/reports/plan') planReports(@Req() r:any,@Param('id') id:string,@Body() b:any,@Headers('idempotency-key') k:string){return this.av8.planReports(r.actor,positiveId(id),b,k);}
  @Get('queues') queues(@Req() r:any,@Query() q:any){return this.av8.queues(r.actor,q);}
  @Get('reports/:kind') report(@Req() r:any,@Param('kind') kind:string,@Query() q:any){return this.av8.report(r.actor,kind,q);}
  @Get('reports/:kind/csv') async csv(@Req() r:any,@Param('kind') kind:string,@Query() q:any,@Res() res:Response){
    requireAv8(r.actor,'av8.reports.export');const report:any=await this.av8.report(r.actor,kind,q);
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="av8-${kind}-page-${report.page}.csv"`);res.send(av8Csv(report,requestLanguage(r)));
  }
  @Get('applications/:id/print/:kind') async print(@Req() r:any,@Param('id') id:string,@Param('kind') kind:string,@Res() res:Response){
    const value:any=await this.av8.statement(r.actor,positiveId(id),kind);const language=requestLanguage(r);
    const esc=(s:any)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
    const rows=value.rows||[];const keys=Object.keys(rows[0]||{});
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.send(`<!doctype html><html lang="${language}" dir="${language==='ar'?'rtl':'ltr'}"><meta charset="utf-8"><title>AV8 ${esc(value.title)}</title><style>body{font:14px Arial;margin:36px;color:#102747}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #ccc;text-align:start}h1{font-size:25px}p{white-space:pre-wrap}</style><h1>AV8 ERP · ${esc(printText(value.title,language))}</h1><p>${esc(value.reference)} · ${esc(value.name)}</p><p>${esc(value.wording||'')}</p><table><tr>${keys.map(k=>`<th>${esc(printLabel(k,language))}</th>`).join('')}</tr>${rows.map((row:any)=>`<tr>${keys.map(k=>`<td>${esc(printText(row[k],language))}</td>`).join('')}</tr>`).join('')}</table><p>${statementNotes(value,language).map(esc).join('<br>')}</p><p>${esc(printText(value.disclaimer||'',language))}</p></html>`);
  }
  @Get('applications/:id/pdf/:kind') async pdf(@Req() r:any,@Param('id') id:string,@Param('kind') kind:string,@Res() res:Response){
    const value:any=await this.av8.statement(r.actor,positiveId(id),kind);const pdf=statementPdf(value,requestLanguage(r));res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="av8-${kind}-${id}.pdf"`);pdf.pipe(res);pdf.end();
  }
}
