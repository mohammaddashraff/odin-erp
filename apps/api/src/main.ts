import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  config({ path: resolve(process.cwd(), '.env') });
  config({ path: resolve(process.cwd(), '../../.env') });
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  const swagger = new DocumentBuilder().setTitle('Odin ERP API').setDescription('Tenant-scoped PostgreSQL ERP workflows, accounting, inventory, POS, banking, reports and audit').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT || 8081), '127.0.0.1');
  console.log(`Odin API ready on http://127.0.0.1:${process.env.API_PORT || 8081}`);
}
void bootstrap();
