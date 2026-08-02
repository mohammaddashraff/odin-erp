import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Actor } from './auth';
import { hasPermission } from './permissions';
import { PrismaService } from './prisma.service';

const PERMISSION_METADATA = 'odin.required-permissions';
const ANY_PERMISSION_METADATA = 'odin.any-permissions';

export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSION_METADATA, permissions);
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSION_METADATA, permissions);

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Optional() private readonly db?: PrismaService) {}

  canActivate(context: ExecutionContext) {
    const required = [...new Set(this.reflector.getAllAndMerge<string[]>(PERMISSION_METADATA, [context.getHandler(), context.getClass()]) || [])];
    const any = [...new Set(this.reflector.getAllAndMerge<string[]>(ANY_PERMISSION_METADATA, [context.getHandler(), context.getClass()]) || [])];
    if (!required.length && !any.length) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<any>();
    const actor = request.actor as Actor | undefined;
    if (!actor) return false;
    const missing = required.find((permission) => !hasPermission(actor.permissions, actor.deniedPermissions, permission));
    const hasAny = !any.length || any.some((permission) => hasPermission(actor.permissions, actor.deniedPermissions, permission));
    if (!missing && hasAny) return true;
    const permission = missing || any[0];
    const providedRequestId = typeof request.headers?.['x-request-id'] === 'string' ? request.headers['x-request-id'] : '';
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(providedRequestId) ? providedRequestId : randomUUID();
    (http as any).getResponse?.()?.setHeader?.('X-Request-ID', requestId);
    void this.db?.admin.accessAuditLog.create({ data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      subjectUserId: actor.userId,
      action: 'PERMISSION_DENIED',
      permissionKey: permission,
      newValue: { method: request.method, route: String(request.originalUrl || request.url || '').split('?')[0] },
      ipAddress: request.ip || request.socket?.remoteAddress,
      branchId: actor.branchIds[0] ? BigInt(actor.branchIds[0]) : undefined,
      requestId,
    } }).catch((error) => console.error(JSON.stringify({ event: 'access_audit_write_failed', requestId, message: error instanceof Error ? error.message : 'Unknown error' })));
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'You do not have permission to perform this action.',
      permission,
    });
  }
}
