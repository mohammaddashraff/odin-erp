import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { catchError, finalize, Observable, throwError } from 'rxjs';
import type { Actor } from './auth';
import { PrismaService } from './prisma.service';

type LoggedRequest = Request & { actor?: Actor };

function requestId(value: unknown) {
  const candidate = typeof value === 'string' ? value : '';
  return /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly db?: PrismaService) {}

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
        if (statusCode === 403 && request.actor) {
          const errorBody = httpError?.getResponse();
          const permission = typeof errorBody === 'object' && errorBody && 'permission' in errorBody ? String((errorBody as any).permission || '') : null;
          void this.db?.admin.accessAuditLog.create({ data: {
            tenantId: request.actor.tenantId,
            actorUserId: request.actor.userId,
            subjectUserId: request.actor.userId,
            action: 'PERMISSION_DENIED',
            permissionKey: permission,
            newValue: { method: request.method, route: String(request.originalUrl || request.url || '').split('?')[0] },
            ipAddress: request.ip || request.socket.remoteAddress,
            branchId: request.actor.branchIds[0] ? BigInt(request.actor.branchIds[0]) : undefined,
            requestId: id,
          } }).catch((auditError) => console.error(JSON.stringify({ event: 'access_audit_write_failed', requestId: id, message: auditError instanceof Error ? auditError.message : 'Unknown error' })));
        }
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
