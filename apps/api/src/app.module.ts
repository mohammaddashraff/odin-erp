import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, AuthService } from './auth';
import { ErpController } from './erp.controller';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [ErpController],
  providers: [PrismaService, AuthService, ErpService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
