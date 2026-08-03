import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { allowedOrigins, mfaEncryptionKey, swaggerEnabled, tokenSigningSecret } from './deployment-config';

async function bootstrap() {
  config({ path: resolve(process.cwd(), '.env'), quiet: true });
  config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
  tokenSigningSecret();
  mfaEncryptionKey();
  const app = await NestFactory.create(AppModule);
  const origins = allowedOrigins();
  app.enableCors({
    credentials: true,
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || origins.has(origin.replace(/\/$/, ''))) return callback(null, true);
      return callback(new Error('Origin is not allowed by ODIN_ALLOWED_ORIGINS'), false);
    },
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  if (swaggerEnabled()) {
    const swagger = new DocumentBuilder().setTitle('Odin ERP API').setDescription('Tenant-scoped PostgreSQL ERP workflows, accounting, inventory, POS, banking, reports and audit').setVersion('1.0').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
  }
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT || 8081), '127.0.0.1');
  console.log(`Odin API ready on http://127.0.0.1:${process.env.API_PORT || 8081}`);
}
void bootstrap();
