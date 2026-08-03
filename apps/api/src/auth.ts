import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { sign, verify, type SignOptions } from 'jsonwebtoken';
import { PrismaService } from './prisma.service';
import { tokenSigningSecret } from './deployment-config';
import { hasPermission, normalizePermissions, permissionMatches } from './permissions';

export type EffectiveDataScope = { resource: string; scope: 'OWN' | 'ASSIGNED' | 'TEAM' | 'BRANCH' | 'WAREHOUSE' | 'DEPARTMENT' | 'ALL'; config?: unknown };
export type EffectiveFieldPermission = { resource: string; field: string; access: 'HIDDEN' | 'VIEW' | 'EDIT' };

export type Actor = {
  userId: bigint;
  tenantId: bigint;
  email: string;
  name: string;
  role: string;
  roleIds: string[];
  permissions: string[];
  deniedPermissions: string[];
  legacyPermissions: string[];
  dataScopes: EffectiveDataScope[];
  fieldPermissions: EffectiveFieldPermission[];
  limits: Record<string, unknown>;
  branchIds: string[];
  warehouseIds: string[];
  employeeId?: string;
  departmentId?: string;
};

export function publicActor(actor: Actor) {
  const { legacyPermissions: _legacyPermissions, ...safe } = actor;
  return { ...safe, userId: actor.userId.toString(), tenantId: actor.tenantId.toString() };
}

const refreshHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService) {}

  private actorFor(user: any): Actor {
    const roles = [user.role, ...(user.additionalRoles || []).map((assignment: any) => assignment.role)]
      .filter((role: any) => role?.active !== false && !role?.archivedAt);
    const legacyPermissions = [...new Set<string>(roles.flatMap((role: any) => Array.isArray(role.permissions) ? role.permissions : []))];
    const assignedPermissions = roles.flatMap((role: any) => (role.permissionAssignments || []).map((assignment: any) => assignment.permission.key));
    const grants = new Set<string>([...normalizePermissions(legacyPermissions), ...assignedPermissions]);
    const denies = new Set<string>();
    for (const override of user.permissionOverrides || []) {
      if (override.effect === 'DENY') denies.add(override.permission.key);
      else grants.add(override.permission.key);
    }
    const scopeRank: Record<string, number> = { OWN: 1, ASSIGNED: 2, TEAM: 3, DEPARTMENT: 4, WAREHOUSE: 5, BRANCH: 6, ALL: 7 };
    const scopes = new Map<string, EffectiveDataScope>();
    for (const scope of roles.flatMap((role: any) => role.dataScopes || [])) {
      const existing = scopes.get(scope.resource);
      if (!existing || scopeRank[scope.scope] > scopeRank[existing.scope]) scopes.set(scope.resource, { resource: scope.resource, scope: scope.scope, config: scope.config });
    }
    const fieldRank: Record<string, number> = { HIDDEN: 0, VIEW: 1, EDIT: 2 };
    const fields = new Map<string, EffectiveFieldPermission>();
    for (const field of roles.flatMap((role: any) => role.fieldPermissions || [])) {
      const key = `${field.resource}.${field.field}`;
      const existing = fields.get(key);
      if (!existing || fieldRank[field.access] > fieldRank[existing.access]) fields.set(key, { resource: field.resource, field: field.field, access: field.access });
    }
    const limits: Record<string, unknown> = {};
    for (const limit of roles.flatMap((role: any) => role.limits || [])) {
      const previous = Number(limits[limit.key]);
      const current = Number(typeof limit.value === 'object' && limit.value !== null && 'value' in limit.value ? limit.value.value : limit.value);
      if (!Number.isFinite(previous) || current > previous) limits[limit.key] = limit.value;
    }
    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role.name,
      roleIds: roles.map((role: any) => role.id.toString()),
      permissions: [...grants].sort(),
      deniedPermissions: [...denies].sort(),
      legacyPermissions,
      dataScopes: [...scopes.values()],
      fieldPermissions: [...fields.values()],
      limits,
      branchIds: user.branchIds as string[],
      warehouseIds: user.warehouseIds as string[],
      employeeId: user.employee?.id?.toString(),
      departmentId: user.employee?.departmentId?.toString(),
    };
  }

  private userInclude = {
    tenant: true,
    employee: true,
    role: { include: { permissionAssignments: { include: { permission: true } }, limits: true, dataScopes: true, fieldPermissions: true } },
    additionalRoles: { include: { role: { include: { permissionAssignments: { include: { permission: true } }, limits: true, dataScopes: true, fieldPermissions: true } } } },
    permissionOverrides: { include: { permission: true } },
  } as const;

  private accessToken(actor: Actor, resetVersion: number) {
    const secret = tokenSigningSecret();
    const expiresIn = (process.env.ODIN_ACCESS_TOKEN_TTL || '15m') as SignOptions['expiresIn'];
    return sign({ ...publicActor(actor), resetVersion }, secret, { expiresIn });
  }

  private async createRefreshSession(user: any, rememberMe = true) {
    const token = randomBytes(48).toString('base64url');
    const durationDays = rememberMe ? 30 : 1;
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    await this.db.admin.refreshSession.create({ data: {
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: refreshHash(token),
      persistent: rememberMe,
      expiresAt,
    } });
    return { token, expiresAt, persistent: rememberMe };
  }

  private sessionResult(user: any, accessToken: string, refresh: { token: string; expiresAt: Date; persistent: boolean }) {
    const actor = this.actorFor(user);
    return {
      token: accessToken,
      accessToken,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.persistent ? refresh.expiresAt : null,
      user: publicActor(actor),
      tenant: { id: user.tenant.id.toString(), name: user.tenant.name, currency: user.tenant.baseCurrency },
    };
  }

  async login(email: string, password: string, rememberMe = true) {
    const user = await this.db.admin.user.findFirst({
      where: { email: email.trim().toLowerCase(), active: true },
      include: this.userInclude,
    });
    if (!user || !(await compare(password, user.passwordHash))) throw new UnauthorizedException('Invalid email or password');
    const actor = this.actorFor(user);
    const refresh = await this.createRefreshSession(user, rememberMe);
    return this.sessionResult(user, this.accessToken(actor, user.tenant.resetVersion), refresh);
  }

  async refresh(rawToken: string) {
    if (!rawToken) throw new UnauthorizedException('Refresh session is missing');
    const tokenHash = refreshHash(rawToken);
    const existing = await this.db.admin.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: { include: this.userInclude } },
    });
    if (!existing || existing.revokedAt || existing.expiresAt <= new Date() || !existing.user.active) {
      throw new UnauthorizedException('Refresh session has expired');
    }
    const rotated = randomBytes(48).toString('base64url');
    const expiresAt = existing.expiresAt;
    const updated = await this.db.admin.$transaction(async (tx) => {
      const revoked = await tx.refreshSession.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
      });
      if (revoked.count !== 1) throw new UnauthorizedException('Refresh session has already been rotated');
      await tx.refreshSession.create({ data: {
        tenantId: existing.tenantId,
        userId: existing.userId,
        tokenHash: refreshHash(rotated),
        persistent: existing.persistent,
        expiresAt,
      } });
      return existing.user;
    });
    const actor = this.actorFor(updated);
    return this.sessionResult(updated, this.accessToken(actor, updated.tenant.resetVersion), { token: rotated, expiresAt, persistent: existing.persistent });
  }

  async logout(rawToken: string) {
    if (!rawToken) return;
    const session = await this.db.admin.refreshSession.findUnique({ where: { tokenHash: refreshHash(rawToken) } });
    if (!session || session.revokedAt) return;
    await this.db.admin.$transaction([
      this.db.admin.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), lastUsedAt: new Date() } }),
      this.db.admin.auditEvent.create({ data: {
        tenantId: session.tenantId,
        userId: session.userId,
        action: 'SESSION_REVOKED',
        entityType: 'AUTH_SESSION',
        entityId: session.id,
        newValues: { reason: 'USER_LOGOUT' },
      } }),
    ]);
  }

  async verifyToken(token: string): Promise<Actor> {
    const secret = tokenSigningSecret();
    let payload: any;
    try { payload = verify(token, secret); } catch { throw new UnauthorizedException('Session expired or invalid'); }
    const user = await this.db.admin.user.findUnique({ where: { id: BigInt(payload.userId) }, include: this.userInclude });
    if (!user || !user.active || user.tenant.resetVersion !== payload.resetVersion) throw new UnauthorizedException('Session is no longer valid');
    return this.actorFor(user);
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.path === '/api/health' || request.path === '/api/auth/login' || request.path === '/api/auth/refresh' || request.path === '/api/auth/logout' || request.path.startsWith('/api/docs')) return true;
    const header = String(request.headers.authorization || '');
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException('Sign in is required');
    request.actor = await this.auth.verifyToken(header.slice(7));
    return true;
  }
}

export function requirePermission(actor: Actor, permission: string) {
  const normalizedRequested = normalizePermissions([permission]);
  const allowedByNewPolicy = normalizedRequested.length
    ? normalizedRequested.every((requested) => hasPermission(actor.permissions, actor.deniedPermissions, requested))
    : hasPermission(actor.permissions, actor.deniedPermissions, permission);
  const denied = (normalizedRequested.length ? normalizedRequested : [permission])
    .some((requested) => actor.deniedPermissions.some((candidate) => permissionMatches(candidate, requested)));
  const allowedByLegacyPolicy = !denied && (actor.legacyPermissions.includes('*') || actor.legacyPermissions.includes(permission));
  if (!allowedByNewPolicy && !allowedByLegacyPolicy) throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: 'You do not have permission to perform this action.', permission });
}

export function can(actor: Actor, permission: string) {
  return hasPermission(actor.permissions, actor.deniedPermissions, permission);
}
