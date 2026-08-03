import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { AuthGuard, AuthService } from './auth';
import { AuthorizationGuard } from './authorization.guard';
import { AuthorizationDenialFilter } from './authorization-denial.filter';
import { CustomerReceivablesService } from './customer-receivables';
import { ErpController } from './erp.controller';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { StepUpGuard } from './step-up.guard';

@Module({
  controllers: [ErpController, AccessControlController],
  providers: [
    PrismaService,
    AuthService,
    AccessControlService,
    CustomerReceivablesService,
    ErpService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    { provide: APP_FILTER, useClass: AuthorizationDenialFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
