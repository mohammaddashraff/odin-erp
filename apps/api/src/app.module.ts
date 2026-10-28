import { AdministrationService } from './administration.service';
import { AdministrationController } from './administration.controller';
import { Av8Service } from './av8.service';
import { Av8FinanceService } from './av8-finance.service';
import { Av8Controller } from './av8.controller';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { AccessGovernanceService } from './access-governance.service';
import { AuthGuard, AuthService } from './auth';
import { AuthorizationGuard } from './authorization.guard';
import { AuthorizationDenialFilter } from './authorization-denial.filter';
import { CustomerReceivablesService } from './customer-receivables';
import { ErpController } from './erp.controller';
import { ErpService } from './erp.service';
import { PrivateAttachmentsController } from './private-attachments.controller';
import { PrivateAttachmentsService } from './private-attachments.service';
import { PrismaService } from './prisma.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { StepUpGuard } from './step-up.guard';

@Module({
  controllers: [AdministrationController, Av8Controller, ErpController, AccessControlController, PrivateAttachmentsController],
  providers: [
    AdministrationService, PrismaService, Av8Service, Av8FinanceService,
    AuthService,
    AccessControlService,
    AccessGovernanceService,
    CustomerReceivablesService,
    ErpService,
    PrivateAttachmentsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    { provide: APP_FILTER, useClass: AuthorizationDenialFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
