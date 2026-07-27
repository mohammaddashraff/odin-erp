import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard, AuthService } from './auth';
import { CustomerReceivablesService } from './customer-receivables';
import { ErpController } from './erp.controller';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

@Module({
  controllers: [ErpController],
  providers: [
    PrismaService,
    AuthService,
    CustomerReceivablesService,
    ErpService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
