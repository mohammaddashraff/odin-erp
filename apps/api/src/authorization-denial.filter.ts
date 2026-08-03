import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Actor } from './auth';
import { permissionMatches } from './permissions';
import { PrismaService } from './prisma.service';

type SafeRequest = {
  actor?: Actor;
  method?: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, unknown>;
  params?: Record<string, unknown>;
};

type DenialResponse = {
  message?: unknown;
  permission?: unknown;
  denial?: { reason?: unknown; requestedAction?: unknown; resourceType?: unknown; resourceId?: unknown };
};

const clean = (value: unknown, maximum = 255) => typeof value === 'string' ? value.slice(0, maximum) : undefined;
const messageText = (value: unknown) => Array.isArray(value) ? value.map(String).join(' ') : String(value || '');

function inferredResource(message: string, route: string) {
  if (/branch/i.test(message)) return 'branch';
  if (/warehouse/i.test(message)) return 'warehouse';
  if (/company/i.test(message)) return 'company';
  if (/bank account|banking/i.test(message)) return 'bank_account';
  if (/treasury/i.test(message)) return 'treasury';
  if (/wallet/i.test(message)) return 'wallet';
  if (/card/i.test(message)) return 'payment_card';
  if (/attachment/i.test(message)) return 'attachment';
  if (/export/i.test(message)) return 'export';
  if (/print/i.test(message)) return 'print';
  return route.split('/').filter((part) => part && !/^\d+$/.test(part)).at(-1)?.replaceAll('-', '_');
}

export function classifyAuthorizationDenial(statusCode: number, body: DenialResponse, actor: Actor | undefined, request: SafeRequest) {
  const message = messageText(body.message);
  const permissionKey = clean(body.permission, 200);
  const route = String(request.originalUrl || request.url || '').split('?')[0].slice(0, 500);
  const explicitDeny = Boolean(permissionKey && actor?.deniedPermissions.some((candidate) => permissionMatches(candidate, permissionKey)));
  const scopeDenied = /outside your access scope|wrong (branch|warehouse|company)|not assigned|unassigned/i.test(message);
  const fieldDenied = /read-only|hidden field|field is hidden|details are hidden/i.test(message);
  const limitDenied = /approval limit|configured limit|maker-checker/i.test(message);
  const denialReason = clean(body.denial?.reason, 100)
    || (statusCode === HttpStatus.UNAUTHORIZED ? 'AUTHENTICATION_REQUIRED'
      : explicitDeny ? 'EXPLICIT_DENY'
        : scopeDenied ? 'DATA_SCOPE_DENIED'
          : fieldDenied ? 'FIELD_SECURITY_DENIED'
            : limitDenied ? 'ROLE_LIMIT_DENIED'
              : permissionKey ? 'MISSING_PERMISSION' : 'FORBIDDEN');
  const dataScopeReason = /branch/i.test(message) ? 'WRONG_BRANCH'
    : /warehouse/i.test(message) ? 'WRONG_WAREHOUSE'
      : /company/i.test(message) ? 'WRONG_COMPANY'
        : scopeDenied && /attachment/i.test(message) ? 'ATTACHMENT_SCOPE'
          : scopeDenied && /export/i.test(message) ? 'EXPORT_SCOPE'
            : scopeDenied ? 'WRONG_RESOURCE' : undefined;
  const fieldSecurityReason = fieldDenied ? (/hidden/i.test(message) ? 'HIDDEN_FIELD' : 'READ_ONLY_FIELD') : undefined;
  const roleLimitReason = limitDenied ? (/maker-checker/i.test(message) ? 'MAKER_CHECKER' : 'APPROVAL_LIMIT') : undefined;
  const parameterId = Object.entries(request.params || {}).find(([key, value]) => /(^id$|Id$)/.test(key) && /^[A-Za-z0-9_-]{1,128}$/.test(String(value || '')))?.[1];
  return {
    permissionKey,
    resourceType: clean(body.denial?.resourceType, 100) || inferredResource(message, route),
    resourceId: clean(body.denial?.resourceId, 128) || clean(String(parameterId || ''), 128),
    requestedAction: clean(body.denial?.requestedAction, 100) || permissionKey?.split('.').at(-1) || clean(request.method, 20),
    route,
    httpMethod: clean(request.method, 20),
    denialReason,
    dataScopeReason,
    fieldSecurityReason,
    roleLimitReason,
  };
}

@Catch()
@Injectable()
export class AuthorizationDenialFilter implements ExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost, private readonly db: PrismaService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const { httpAdapter } = this.adapterHost;
    const http = host.switchToHttp();
    const request = http.getRequest<SafeRequest>();
    const response = http.getResponse();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawBody = exception instanceof HttpException ? exception.getResponse() : { statusCode, error: 'Internal Server Error', message: 'Internal server error' };
    const body = typeof rawBody === 'object' && rawBody ? rawBody as DenialResponse : { message: rawBody };
    const suppliedId = clean(request.headers?.['x-request-id'], 128) || '';
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedId) ? suppliedId : randomUUID();
    response?.setHeader?.('X-Request-ID', requestId);

    if (statusCode === HttpStatus.UNAUTHORIZED || statusCode === HttpStatus.FORBIDDEN) {
      const actor = request.actor;
      const denial = classifyAuthorizationDenial(statusCode, body, actor, request);
      try {
        await this.db.admin.accessAuditLog.create({ data: {
          tenantId: actor?.tenantId,
          actorUserId: actor?.userId,
          subjectUserId: actor?.userId,
          action: 'AUTHORIZATION_DENIED',
          ...denial,
          ipAddress: clean(request.ip || request.socket?.remoteAddress, 200),
          userAgent: clean(request.headers?.['user-agent'], 500),
          sessionId: clean(actor?.sessionId, 128),
          branchId: actor?.branchIds[0] ? BigInt(actor.branchIds[0]) : undefined,
          warehouseId: actor?.warehouseIds[0] ? BigInt(actor.warehouseIds[0]) : undefined,
          requestId,
          newValue: { statusCode },
        } });
      } catch (auditError) {
        console.error(JSON.stringify({ event: 'authorization_denial_audit_failed', requestId, message: auditError instanceof Error ? auditError.message : 'Unknown error' }));
      }
    }
    httpAdapter.reply(response, rawBody, statusCode);
  }
}
