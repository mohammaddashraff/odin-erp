import { Body, Controller, Get, Headers, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Av8OpeningService } from './av8-opening.service';
import { fail } from './av8-domain';

const manifestUpload = FileInterceptor('manifest', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
function manifest(file: any, body: any) {
  if (!file) return body.manifest || body;
  try { return JSON.parse(file.buffer.toString('utf8')); } catch { fail('Opening manifest must contain valid JSON'); }
}
@Controller('api/av8/opening')
export class Av8OpeningController {
  constructor(private readonly opening: Av8OpeningService) {}
  @Get() history(@Req() r: any) { return this.opening.history(r.actor); }
  @Post('supplier-settlement')
  supplierSettlement(@Req() r:any,@Body() b:any,@Headers('idempotency-key') key:string){return this.opening.supplierSettlement(r.actor,b,key);}
  @Post('preview') @UseInterceptors(manifestUpload)
  preview(@Req() r: any, @Body() b: any, @UploadedFile() file: any) { return this.opening.preview(r.actor, manifest(file,b)); }
  @Post('commit') @UseInterceptors(manifestUpload)
  commit(@Req() r: any, @Body() b: any, @UploadedFile() file: any, @Headers('idempotency-key') key: string) { return this.opening.commit(r.actor, { manifest: manifest(file,b), previewHash: b.previewHash, reason: b.reason }, key); }
}
