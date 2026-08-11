import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Actor } from './auth';
import { hasPermission, permissionMatches } from './permissions';

const PERMISSION_METADATA = 'odin.required-permissions';
const ANY_PERMISSION_METADATA = 'odin.any-permissions';

export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSION_METADATA, permissions);
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSION_METADATA, permissions);

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = [...new Set(this.reflector.getAllAndMerge<string[]>(PERMISSION_METADATA, [context.getHandler(), context.getClass()]) || [])];
    const any = [...new Set(this.reflector.getAllAndMerge<string[]>(ANY_PERMISSION_METADATA, [context.getHandler(), context.getClass()]) || [])];
    if (!required.length && !any.length) return true;
    const request = context.switchToHttp().getRequest<any>();
    const actor = request.actor as Actor | undefined;
    if (!actor) return false;
    const hasEffectivePermission = (permission: string) => hasPermission(actor.permissions, actor.deniedPermissions, permission)
      || Object.values(actor.companyScopedPermissions || {}).some((grants) => hasPermission(grants, actor.deniedPermissions, permission));
    const missing = required.find((permission) => !hasEffectivePermission(permission));
    const hasAny = !any.length || any.some(hasEffectivePermission);
    if (!missing && hasAny) return true;
    const permission = missing || any[0];
    const explicitDeny = actor.deniedPermissions.some((candidate) => permissionMatches(candidate, permission));
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'You do not have permission to perform this action.',
      permission,
      denial: { reason: explicitDeny ? 'EXPLICIT_DENY' : 'MISSING_PERMISSION', requestedAction: permission.split('.').at(-1) },
    });
  }
}
