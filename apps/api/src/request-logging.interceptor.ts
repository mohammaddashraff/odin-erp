import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { catchError, finalize, Observable, throwError } from 'rxjs';
import type { Actor } from './auth';

type LoggedRequest = Request & { actor?: Actor };

function requestId(value: unknown) {
  const candidate = typeof value === 'string' ? value : '';
  return /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<LoggedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();
    const id = requestId(request.headers['x-request-id']);
    response.setHeader('X-Request-ID', id);
    let caughtError: unknown;

    return next.handle().pipe(
      catchError((error: unknown) => {
        caughtError = error;
        return throwError(() => error);
      }),
      finalize(() => {
        const httpError = caughtError instanceof HttpException ? caughtError : null;
        const statusCode = httpError?.getStatus() || (caughtError ? 500 : response.statusCode);
        const entry = {
          timestamp: new Date().toISOString(),
          level: caughtError ? 'error' : 'info',
          event: 'http_request',
          requestId: id,
          method: request.method,
          route: String(request.originalUrl || request.url || '').split('?')[0],
          statusCode,
          durationMs: Date.now() - startedAt,
          userId: request.actor?.userId?.toString() || null,
          tenantId: request.actor?.tenantId?.toString() || null,
          ...(caughtError ? {
            error: {
              name: caughtError instanceof Error ? caughtError.name : 'Error',
              message: httpError?.message || 'Internal server error',
            },
          } : {}),
        };
        const serialized = JSON.stringify(entry);
        if (caughtError) console.error(serialized);
        else console.log(serialized);
      }),
    );
  }
}
