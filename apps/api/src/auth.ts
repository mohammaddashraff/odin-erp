import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { sign, verify, type SignOptions } from 'jsonwebtoken';
import { PrismaService } from './prisma.service';

export type Actor = {
  userId: bigint;
  tenantId: bigint;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  branchIds: string[];
  warehouseIds: string[];
};

export function publicActor(actor: Actor) {
  return { ...actor, userId: actor.userId.toString(), tenantId: actor.tenantId.toString() };
}

const refreshHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService) {}

  private actorFor(user: any): Actor {
    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role.name,
      permissions: user.role.permissions as string[],
      branchIds: user.branchIds as string[],
      warehouseIds: user.warehouseIds as string[],
    };
  }

  private accessToken(actor: Actor, resetVersion: number) {
    const secret = process.env.ODIN_TOKEN_SECRET || 'odin-local-demo-secret-change-before-production';
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
      include: { role: true, tenant: true },
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
      include: { user: { include: { role: true, tenant: true } } },
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
    const secret = process.env.ODIN_TOKEN_SECRET || 'odin-local-demo-secret-change-before-production';
    let payload: any;
    try { payload = verify(token, secret); } catch { throw new UnauthorizedException('Session expired or invalid'); }
    const user = await this.db.admin.user.findUnique({ where: { id: BigInt(payload.userId) }, include: { role: true, tenant: true } });
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
  if (!actor.permissions.includes('*') && !actor.permissions.includes(permission)) {
    throw new UnauthorizedException(`Permission required: ${permission}`);
  }
}
