import 'reflect-metadata';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { publicAsset } from './accounting-pdf';
import { allowedOrigins, mfaEncryptionKey, swaggerEnabled, tokenSigningSecret } from './deployment-config';

async function bootstrap() {
  tokenSigningSecret();
  mfaEncryptionKey();
  if (process.env.AV8_ENV === 'production') {
    // Reject incomplete serverless bundles before serving student PDF requests.
    for (const font of ['manrope-regular.ttf', 'manrope-bold.ttf', 'noto-arabic-regular.ttf', 'noto-arabic-bold.ttf']) {
      publicAsset(`fonts/${font}`);
    }
  }
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  });
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
    const swagger = new DocumentBuilder().setTitle('AV8 ERP API').setDescription('Tenant-scoped PostgreSQL ERP workflows, accounting, inventory, POS, banking, reports and audit').setVersion('1.0').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
  }
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || process.env.API_PORT || 8181), process.env.VERCEL ? '0.0.0.0' : '127.0.0.1');
  console.log(`AV8 API ready on http://127.0.0.1:${process.env.API_PORT || 8181}`);
}
void bootstrap();
