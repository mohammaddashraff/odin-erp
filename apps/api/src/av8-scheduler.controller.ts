import { Controller, Get, Header, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Av8SchedulerService } from './av8-scheduler.service';

@Controller('api/av8/scheduler')
export class Av8SchedulerController {
  constructor(private readonly scheduler:Av8SchedulerService){}
  @Get('tick') @Header('Cache-Control','no-store')
  tick(@Req() request:any){if(request.av8SchedulerAuthenticated!==true)throw new UnauthorizedException('Scheduler authorization required');return this.scheduler.run();}
  @Post('tick') @HttpCode(200) @Header('Cache-Control','no-store')
  trigger(@Req() request:any){return this.tick(request);}
}
