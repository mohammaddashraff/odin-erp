import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { positiveId } from './av8-domain';
import { Av8OperationsService } from './av8-operations.service';

@Controller('api/av8')
export class Av8OperationsController {
  constructor(private readonly operations: Av8OperationsService) {}
  @Get('applications/:id/operations') overview(@Req() r: any, @Param('id') id: string) { return this.operations.overview(r.actor, positiveId(id)); }
  @Post('applications/:id/operations') execute(@Req() r: any, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') key: string) { return this.operations.execute(r.actor, positiveId(id), b, key); }
  @Post('applications/:id/reports/:reportId/dispatch') queue(@Req() r: any, @Param('id') id: string, @Param('reportId') reportId: string, @Headers('idempotency-key') key: string) { return this.operations.queue(r.actor, positiveId(id), positiveId(reportId), key); }
  @Post('applications/:id/dispatches/:dispatchId/action') dispatch(@Req() r: any, @Param('id') id: string, @Param('dispatchId') dispatchId: string, @Body() b: any, @Headers('idempotency-key') key: string) { return this.operations.dispatchAction(r.actor, positiveId(id), positiveId(dispatchId), b, key); }
  @Post('academic-dispatch/process') process(@Req() r: any, @Body() b: any) { return this.operations.process(r.actor, Number(b.limit) || 10); }
  @Post('operations/maintenance') maintenance(@Req() r: any) { return this.operations.maintain(r.actor); }
}
