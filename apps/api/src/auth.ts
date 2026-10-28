import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { sign, verify, type SignOptions } from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { privilegedMfaRequired, tokenSigningSecret } from './deployment-config';
import { consumeRecoveryCode, decryptMfaSecret, encryptMfaSecret, hashRecoveryCodes, newMfaSecret, newRecoveryCodes, otpAuthUri, verifyTotp } from './mfa-security';
import { hasPermission, normalizePermissions, permissionMatches } from './permissions';
import { resolveEffectiveAccess } from './access-governance';

export type EffectiveDataScope = { resource: string; scope: 'NONE' | 'OWN' | 'ASSIGNED' | 'TEAM' | 'BRANCH' | 'WAREHOUSE' | 'DEPARTMENT' | 'ALL'; config?: unknown };
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
  companyIds: string[];
  companyAdminIds: string[];
  companyBranchIds: Record<string, string[]>;
  companyScopedPermissions: Record<string, string[]>;
  companyResourceAssignments: Record<string, Record<string, string[]>>;
  employeeId?: string;
  departmentId?: string;
  sessionId?: string;
  mfaEnabled?: boolean;
  passwordChangeRequired?: boolean;
  language?: string;
  mfaVerifiedAt?: string;
};

export function publicActor(actor: Actor) {
  const { legacyPermissions: _legacyPermissions, sessionId: _sessionId, ...safe } = actor;
  return { ...safe, userId: actor.userId.toString(), tenantId: actor.tenantId.toString() };
}

const refreshHash = (token: string) => createHash('sha256').update(token).digest('hex');
const dummyPasswordHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
export type AuthenticationContext = { ipAddress?: string; userAgent?: string };

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService) {}

  actorFor(user: any): Actor {
    const effective = resolveEffectiveAccess(user);
    if (hasPermission(effective.permissions, effective.deniedPermissions, 'system.super_admin')) {
      effective.companyIds = (user.tenant.companies || []).filter((company: any) => company.active !== false).map((company: any) => company.id.toString()).sort();
      effective.companyAdminIds = [...effective.companyIds];
      effective.companyBranchIds = Object.fromEntries((user.tenant.companies || []).filter((company: any) => company.active !== false).map((company: any) => [
        company.id.toString(),
        (company.branchLinks || []).filter((link: any) => link.active !== false).map((link: any) => link.branchId.toString()).sort(),
      ]));
    }
    const membershipBranches = new Set(Object.values(effective.companyBranchIds).flat());
    const branchIds = (user.branchIds as string[]).map(String).filter((branchId) => membershipBranches.has(branchId));
    const membershipWarehouses = new Set((user.companyMemberships || []).flatMap((membership: any) => (membership.company?.branchLinks || [])
      .filter((link: any) => membershipBranches.has(link.branchId.toString()))
      .flatMap((link: any) => link.branch?.warehouses || []).map((warehouse: any) => warehouse.id.toString())));
    const warehouseIds = (user.warehouseIds as string[]).map(String).filter((warehouseId) => membershipWarehouses.has(warehouseId));
    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role.name,
      roleIds: effective.roles.map((role: any) => role.id.toString()),
      permissions: effective.permissions,
      deniedPermissions: effective.deniedPermissions,
      legacyPermissions: effective.legacyPermissions,
      dataScopes: effective.dataScopes,
      fieldPermissions: effective.fieldPermissions,
      limits: effective.limits,
      branchIds,
      warehouseIds,
      companyIds: effective.companyIds,
      companyAdminIds: effective.companyAdminIds,
      companyBranchIds: effective.companyBranchIds,
      companyScopedPermissions: effective.companyScopedPermissions,
      companyResourceAssignments: effective.companyResourceAssignments,
      employeeId: user.employee?.id?.toString(),
      departmentId: user.employee?.departmentId?.toString(),
      mfaEnabled: user.mfaEnabled,
      passwordChangeRequired: user.passwordChangeRequired,
      language: user.language,
    };
  }

  readonly userInclude = {
    tenant: { include: { companies: { include: { branchLinks: true } } } },
    employee: true,
    role: { include: { permissionAssignments: { include: { permission: true } }, limits: true, dataScopes: true, fieldPermissions: true } },
    additionalRoles: { include: { role: { include: { permissionAssignments: { include: { permission: true } }, limits: true, dataScopes: true, fieldPermissions: true } } } },
    permissionOverrides: { include: { permission: true } },
    companyMemberships: {
      include: {
        company: {
          include: {
            branchLinks: { include: { branch: { include: { warehouses: true } } } },
            financialResources: true,
          },
        },
      },
    },
    resourceAssignments: { include: { resource: true } },
    temporaryGrants: true,
    delegationsReceived: { include: { delegator: { include: {
      role: { include: { permissionAssignments: { include: { permission: true } } } },
      additionalRoles: { include: { role: { include: { permissionAssignments: { include: { permission: true } } } } } },
      permissionOverrides: { include: { permission: true } },
      resourceAssignments: { include: { resource: true } },
      companyMemberships: { include: { company: true } },
    } } } },
  } as const;

  private accessToken(actor: Actor, resetVersion: number, authVersion: number) {
    const secret = tokenSigningSecret();
    const expiresIn = (process.env.ODIN_ACCESS_TOKEN_TTL || '15m') as SignOptions['expiresIn'];
    return sign({ ...publicActor(actor), sessionId: actor.sessionId, mfaVerifiedAt: actor.mfaVerifiedAt, resetVersion, authVersion }, secret, { expiresIn });
  }

  private async createRefreshSession(
    user: any,
    rememberMe = true,
    mfaVerifiedAt?: Date,
    client: Pick<Prisma.TransactionClient, 'refreshSession'> = this.db.admin,
  ) {
    const token = randomBytes(48).toString('base64url');
    const durationDays = rememberMe ? 30 : 1;
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    const session = await client.refreshSession.create({ data: {
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: refreshHash(token),
      persistent: rememberMe,
      expiresAt,
      mfaVerifiedAt,
    } });
    return { id: session.id, token, expiresAt, persistent: rememberMe, mfaVerifiedAt };
  }

  private sessionResult(user: any, refresh: { id: string; token: string; expiresAt: Date; persistent: boolean; mfaVerifiedAt?: Date | null }) {
    const actor = this.actorFor(user);
    actor.sessionId = refresh.id;
    actor.mfaVerifiedAt = refresh.mfaVerifiedAt?.toISOString();
    const accessToken = this.accessToken(actor, user.tenant.resetVersion, user.authVersion);
    return {
      token: accessToken,
      accessToken,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.persistent ? refresh.expiresAt : null,
      user: publicActor(actor),
      tenant: { id: user.tenant.id.toString(), name: user.tenant.name, currency: user.tenant.baseCurrency },
    };
  }

  private isPrivileged(actor: Actor) {
    return isPrivilegedActor(actor);
  }

  private throttleKeys(email: string, ipAddress?: string) {
    const pepper = tokenSigningSecret();
    const key = (kind: string, value: string) => createHash('sha256').update(`${pepper}:${kind}:${value}`).digest('hex');
    return [
      { keyHash: key('EMAIL', email), kind: 'EMAIL' },
      ...(ipAddress ? [{ keyHash: key('IP', ipAddress), kind: 'IP' }] : []),
    ];
  }

  private async assertLoginAllowed(keys: Array<{ keyHash: string; kind: string }>) {
    const blocked = await this.db.admin.authThrottle.findFirst({ where: { keyHash: { in: keys.map(({ keyHash }) => keyHash) }, blockedUntil: { gt: new Date() } } });
    if (blocked) throw new UnauthorizedException('Invalid email or password');
  }

  private async recordLoginFailure(keys: Array<{ keyHash: string; kind: string }>) {
    const now = new Date();
    await this.db.admin.$transaction(async (tx) => {
      for (const key of keys) {
        const previous = await tx.authThrottle.findUnique({ where: { keyHash: key.keyHash } });
        const failedCount = (previous?.failedCount || 0) + 1;
        const lockSeconds = failedCount < 5 ? 0 : Math.min(900, 30 * (2 ** Math.min(failedCount - 5, 5)));
        await tx.authThrottle.upsert({
          where: { keyHash: key.keyHash },
          create: { ...key, failedCount, blockedUntil: lockSeconds ? new Date(now.valueOf() + lockSeconds * 1000) : null, lastAttemptAt: now },
          update: { failedCount, blockedUntil: lockSeconds ? new Date(now.valueOf() + lockSeconds * 1000) : null, lastAttemptAt: now },
        });
      }
    });
  }

  private async clearLoginFailures(keys: Array<{ keyHash: string; kind: string }>) {
    await this.db.admin.authThrottle.deleteMany({ where: { keyHash: { in: keys.map(({ keyHash }) => keyHash) } } });
  }

  private async authAudit(
    user: any,
    action: string,
    values: Record<string, unknown> = {},
    client: Pick<Prisma.TransactionClient, 'auditEvent'> = this.db.admin,
  ) {
    await client.auditEvent.create({ data: {
      tenantId: user.tenantId,
      userId: user.id,
      action,
      entityType: 'AUTH_SECURITY',
      entityId: user.id.toString(),
      newValues: values as any,
    } });
  }

  private async createMfaChallenge(user: any, purpose: 'LOGIN' | 'ENROLLMENT', rememberMe: boolean) {
    const token = randomBytes(40).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.db.admin.mfaChallenge.create({ data: {
      tenantId: user.tenantId, userId: user.id, tokenHash: refreshHash(token), purpose, rememberMe, expiresAt,
    } });
    return { challengeToken: token, expiresAt };
  }

  private async prepareMfaEnrollment(user: any, rememberMe: boolean) {
    const secret = newMfaSecret();
    const recoveryCodes = newRecoveryCodes();
    const recoveryHashes = await hashRecoveryCodes(recoveryCodes);
    await this.db.admin.user.update({ where: { id: user.id }, data: {
      mfaEnabled: false, mfaSecretEncrypted: encryptMfaSecret(secret), mfaRecoveryHashes: recoveryHashes,
    } });
    const challenge = await this.createMfaChallenge(user, 'ENROLLMENT', rememberMe);
    await this.authAudit(user, 'MFA_ENROLLMENT_STARTED', { privilegedBootstrap: true });
    return {
      mfaEnrollmentRequired: true,
      ...challenge,
      secret,
      otpAuthUri: otpAuthUri(secret, user.tenant.name, user.email),
      recoveryCodes,
    };
  }

  async login(email: string, password: string, rememberMe = true, context: AuthenticationContext = {}): Promise<any> {
    const normalizedEmail = email.trim().toLowerCase();
    const throttleKeys = this.throttleKeys(normalizedEmail, context.ipAddress);
    await this.assertLoginAllowed(throttleKeys);
    const user = await this.db.admin.user.findFirst({
      where: { email: normalizedEmail, active: true },
      include: this.userInclude,
    });
    const passwordAccepted = await compare(password, user?.passwordHash || dummyPasswordHash);
    if (!user || !passwordAccepted) {
      await this.recordLoginFailure(throttleKeys);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.passwordChangeRequired && user.temporaryPasswordExpiresAt && user.temporaryPasswordExpiresAt <= new Date()) {
      throw new UnauthorizedException('Temporary password expired. Ask your administrator for a new one.');
    }
    await this.clearLoginFailures(throttleKeys);
    const actor = this.actorFor(user);
    const mfaRequired = user.mfaRequired || (privilegedMfaRequired() && this.isPrivileged(actor));
    if (mfaRequired && !user.mfaEnabled) return this.prepareMfaEnrollment(user, rememberMe);
    if (user.mfaEnabled) {
      const challenge = await this.createMfaChallenge(user, 'LOGIN', rememberMe);
      await this.authAudit(user, 'MFA_CHALLENGE_ISSUED', { context: context.userAgent ? 'KNOWN_DEVICE' : 'LOGIN' });
      return { mfaRequired: true, ...challenge };
    }
    const refresh = await this.createRefreshSession(user, rememberMe);
    await this.db.admin.user.update({ where: { id: user.id }, data: { lastSignInAt: new Date() } });
    await this.authAudit(user, 'LOGIN_SUCCEEDED', { mfa: false });
    return this.sessionResult(user, refresh);
  }

  private async verifyMfa(user: any, code?: string, recoveryCode?: string) {
    const recoveryHashes = Array.isArray(user.mfaRecoveryHashes) ? user.mfaRecoveryHashes.map(String) : [];
    if (!user.mfaSecretEncrypted) return { accepted: false, recoveryHashes };
    const secret = decryptMfaSecret(user.mfaSecretEncrypted);
    if (code && verifyTotp(secret, code)) return { accepted: true, recoveryHashes };
    if (recoveryCode) {
      const consumed = await consumeRecoveryCode(recoveryHashes, recoveryCode);
      return { accepted: consumed.accepted, recoveryHashes: consumed.remaining };
    }
    return { accepted: false, recoveryHashes };
  }

  async completeMfaChallenge(rawToken: string, code?: string, recoveryCode?: string) {
    if (!rawToken) throw new UnauthorizedException('MFA challenge is invalid or expired');
    const tokenHash = refreshHash(rawToken);
    const outcome = await this.db.admin.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; userId: bigint }>>(Prisma.sql`
        SELECT id, user_id AS "userId"
        FROM mfa_challenges
        WHERE token_hash = ${tokenHash}
        FOR UPDATE
      `);
      if (!locked[0]) return { kind: 'INVALID_CHALLENGE' } as const;

      // A user lock serializes recovery-code consumption across distinct login
      // challenges as well as against step-up authentication.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${locked[0].userId} FOR UPDATE`);
      const challenge = await tx.mfaChallenge.findUnique({
        where: { id: locked[0].id }, include: { user: { include: this.userInclude } },
      });
      const now = new Date();
      if (!challenge || challenge.consumedAt || challenge.expiresAt <= now || !challenge.user.active) {
        return { kind: 'INVALID_CHALLENGE' } as const;
      }

      const user = challenge.user;
      let accepted = false;
      let recoveryHashes = Array.isArray(user.mfaRecoveryHashes) ? user.mfaRecoveryHashes.map(String) : [];
      if (challenge.purpose === 'ENROLLMENT' && user.mfaSecretEncrypted && code) {
        accepted = verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted), code);
      } else {
        ({ accepted, recoveryHashes } = await this.verifyMfa(user, code, recoveryCode));
      }
      if (user.passwordChangeRequired && user.temporaryPasswordExpiresAt && user.temporaryPasswordExpiresAt <= now) return { kind: 'INVALID_CHALLENGE' } as const;
      if (!accepted) {
        const attempts = challenge.attempts + 1;
        await tx.mfaChallenge.update({
          where: { id: challenge.id },
          data: { attempts, consumedAt: attempts >= 5 ? now : undefined },
        });
        return { kind: 'INVALID_CODE' } as const;
      }

      const updated = await tx.user.update({ where: { id: user.id }, data: {
        mfaEnabled: true,
        lastSignInAt: now,
        mfaEnrolledAt: challenge.purpose === 'ENROLLMENT' ? now : undefined,
        mfaRecoveryHashes: recoveryHashes,
      }, include: this.userInclude });
      await tx.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now } });
      const refresh = await this.createRefreshSession(updated, challenge.rememberMe, now, tx);
      await this.authAudit(
        updated,
        challenge.purpose === 'ENROLLMENT' ? 'MFA_ENROLLMENT_COMPLETED' : 'MFA_VERIFIED',
        { recoveryCode: Boolean(recoveryCode) },
        tx,
      );
      return { kind: 'VERIFIED', updated, refresh } as const;
    }, { maxWait: 10_000, timeout: 30_000 });

    if (outcome.kind === 'INVALID_CHALLENGE') throw new UnauthorizedException('MFA challenge is invalid or expired');
    if (outcome.kind === 'INVALID_CODE') throw new UnauthorizedException('MFA code is invalid');
    return this.sessionResult(outcome.updated, outcome.refresh);
  }

  async beginMfaEnrollment(actor: Actor, password: string) {
    const user = await this.db.admin.user.findUnique({ where: { id: actor.userId }, include: this.userInclude });
    if (!user || !user.active || !await compare(password, user.passwordHash)) throw new UnauthorizedException('Invalid email or password');
    if (user.mfaEnabled) throw new ForbiddenException('MFA reset requires administrator governance and a recorded reason');
    const secret = newMfaSecret();
    const recoveryCodes = newRecoveryCodes();
    await this.db.admin.user.update({ where: { id: user.id }, data: { mfaSecretEncrypted: encryptMfaSecret(secret), mfaRecoveryHashes: await hashRecoveryCodes(recoveryCodes) } });
    await this.authAudit(user, 'MFA_ENROLLMENT_STARTED');
    return { secret, otpAuthUri: otpAuthUri(secret, user.tenant.name, user.email), recoveryCodes };
  }

  async confirmMfaEnrollment(actor: Actor, code: string) {
    const user = await this.db.admin.user.findUnique({ where: { id: actor.userId }, include: this.userInclude });
    if (!user?.mfaSecretEncrypted || !verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted), code)) throw new UnauthorizedException('MFA code is invalid');
    const now = new Date();
    await this.db.admin.$transaction([
      this.db.admin.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaEnrolledAt: now, authVersion: { increment: 1 } } }),
      this.db.admin.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
      this.db.admin.auditEvent.create({ data: { tenantId: user.tenantId, userId: user.id, action: 'MFA_ENROLLMENT_COMPLETED', entityType: 'AUTH_SECURITY', entityId: user.id.toString() } }),
    ]);
    return { ok: true, reauthenticate: true };
  }

  async stepUp(actor: Actor, password: string, code?: string, recoveryCode?: string) {
    const result = await this.db.admin.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${actor.userId} FOR UPDATE`);
      const lockedUser = await tx.user.findUnique({ where: { id: actor.userId }, include: this.userInclude });
      if (!lockedUser || !await compare(password, lockedUser.passwordHash)) throw new UnauthorizedException('Step-up authentication failed');
      if (lockedUser.mfaEnabled) {
        const result = await this.verifyMfa(lockedUser, code, recoveryCode);
        if (!result.accepted) throw new UnauthorizedException('Step-up authentication failed');
        if (recoveryCode) {
          await tx.user.update({ where: { id: lockedUser.id }, data: { mfaRecoveryHashes: result.recoveryHashes } });
        }
      } else if (lockedUser.mfaRequired || (privilegedMfaRequired() && this.isPrivileged(actor))) {
        throw new ForbiddenException('MFA enrollment is required for privileged actions');
      }
      const stepUpToken = sign({ purpose: 'step-up', userId: actor.userId.toString(), tenantId: actor.tenantId.toString(), sessionId: actor.sessionId, authVersion: lockedUser.authVersion }, tokenSigningSecret(), { expiresIn: '5m' });
      await this.authAudit(lockedUser, 'STEP_UP_SUCCEEDED', { mfa: lockedUser.mfaEnabled }, tx);
      return { stepUpToken };
    }, { maxWait: 10_000, timeout: 30_000 });
    return { stepUpToken: result.stepUpToken, expiresInSeconds: 300 };
  }

  verifyStepUp(token: string, actor: Actor) {
    try {
      const payload: any = verify(token, tokenSigningSecret());
      if (payload.purpose !== 'step-up' || payload.userId !== actor.userId.toString() || payload.tenantId !== actor.tenantId.toString() || payload.sessionId !== actor.sessionId) throw new Error('mismatch');
      return true;
    } catch {
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: 'Recent step-up authentication is required.', denial: { reason: 'STEP_UP_REQUIRED', requestedAction: 'step-up' } });
    }
  }

  async refresh(rawToken: string) {
    if (!rawToken) throw new UnauthorizedException('Refresh session is missing');
    const tokenHash = refreshHash(rawToken);
    const existing = await this.db.admin.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: { include: this.userInclude } },
    });
    if (!existing || existing.revokedAt || existing.expiresAt <= new Date() || !existing.user.active || (existing.user.passwordChangeRequired && !!existing.user.temporaryPasswordExpiresAt && existing.user.temporaryPasswordExpiresAt <= new Date())) {
      throw new UnauthorizedException('Refresh session has expired');
    }
    const now = new Date();
    const refreshActor = this.actorFor(existing.user);
    const idleMinutes = Math.max(5, Number(process.env.ODIN_SESSION_IDLE_MINUTES || 30));
    const privilegedHours = Math.max(1, Number(process.env.ODIN_PRIVILEGED_SESSION_HOURS || 8));
    if (existing.lastUsedAt < new Date(now.valueOf() - idleMinutes * 60_000)
      || (this.isPrivileged(refreshActor) && existing.createdAt < new Date(now.valueOf() - privilegedHours * 3_600_000))) {
      await this.db.admin.refreshSession.updateMany({ where: { id: existing.id, revokedAt: null }, data: { revokedAt: now } });
      throw new UnauthorizedException('Refresh session has expired');
    }
    const rotated = randomBytes(48).toString('base64url');
    const expiresAt = existing.expiresAt;
    const updated = await this.db.admin.$transaction(async (tx) => {
      const revoked = await tx.refreshSession.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: now, lastUsedAt: now },
      });
      if (revoked.count !== 1) throw new UnauthorizedException('Refresh session has already been rotated');
      const next = await tx.refreshSession.create({ data: {
        tenantId: existing.tenantId,
        userId: existing.userId,
        tokenHash: refreshHash(rotated),
        persistent: existing.persistent,
        expiresAt,
        mfaVerifiedAt: existing.mfaVerifiedAt,
      } });
      return { user: existing.user, sessionId: next.id };
    });
    return this.sessionResult(updated.user, { id: updated.sessionId, token: rotated, expiresAt, persistent: existing.persistent, mfaVerifiedAt: existing.mfaVerifiedAt });
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

  async logoutAll(actor: Actor) {
    const now = new Date();
    await this.db.admin.$transaction([
      this.db.admin.refreshSession.updateMany({ where: { userId: actor.userId, revokedAt: null }, data: { revokedAt: now } }),
      this.db.admin.auditEvent.create({ data: { tenantId: actor.tenantId, userId: actor.userId, action: 'ALL_SESSIONS_REVOKED', entityType: 'AUTH_SESSION', entityId: actor.userId.toString() } }),
    ]);
    return { ok: true };
  }

  async changePassword(actor: Actor, currentPassword: string, newPassword: string) {
    if (newPassword.length < 12 || newPassword.length > 128 || Buffer.byteLength(newPassword, 'utf8') > 72) throw new ForbiddenException('Use 12–72 bytes for the new password.');
    if (currentPassword === newPassword) throw new ForbiddenException('Choose a different password.');
    const passwordHash = await hash(newPassword, 12);
    await this.db.tenant(actor.tenantId, async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.userId} FOR UPDATE`;
      const user = await tx.user.findFirst({ where: { id: actor.userId, active: true } });
      if (!user || !await compare(currentPassword, user.passwordHash)) throw new UnauthorizedException('Invalid email or password');
      await tx.user.update({ where: { id: actor.userId }, data: { passwordHash, passwordChangeRequired: false, temporaryPasswordExpiresAt: null, authVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { userId: actor.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.mfaChallenge.updateMany({ where: { userId: actor.userId, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.auditEvent.create({ data: { tenantId: actor.tenantId, userId: actor.userId, action: 'PASSWORD_CHANGED', entityType: 'AUTH_SECURITY', entityId: actor.userId.toString() } });
    });
    return { ok: true, reauthenticate: true };
  }

  async verifyToken(token: string): Promise<Actor> {
    const secret = tokenSigningSecret();
    let payload: any;
    try { payload = verify(token, secret); } catch { throw new UnauthorizedException('Session expired or invalid'); }
    if (!payload.sessionId) throw new UnauthorizedException('Session is no longer valid');
    const [user, session] = await Promise.all([
      this.db.admin.user.findUnique({ where: { id: BigInt(payload.userId) }, include: this.userInclude }),
      this.db.admin.refreshSession.findUnique({ where: { id: String(payload.sessionId) } }),
    ]);
    const now = new Date();
    if (!user || !user.active || user.tenant.resetVersion !== payload.resetVersion || user.authVersion !== payload.authVersion
      || !session || session.userId !== user.id || session.revokedAt || session.expiresAt <= now) throw new UnauthorizedException('Session is no longer valid');
    if (user.passwordChangeRequired && user.temporaryPasswordExpiresAt && user.temporaryPasswordExpiresAt <= now) throw new UnauthorizedException('Temporary password expired.');
    const actor = this.actorFor(user);
    const idleMinutes = Math.max(5, Number(process.env.ODIN_SESSION_IDLE_MINUTES || 30));
    const privilegedHours = Math.max(1, Number(process.env.ODIN_PRIVILEGED_SESSION_HOURS || 8));
    if (session.lastUsedAt < new Date(now.valueOf() - idleMinutes * 60_000)
      || (this.isPrivileged(actor) && session.createdAt < new Date(now.valueOf() - privilegedHours * 3_600_000))) {
      await this.db.admin.refreshSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now } });
      throw new UnauthorizedException('Session is no longer valid');
    }
    if (session.lastUsedAt < new Date(now.valueOf() - 5 * 60_000)) void this.db.admin.refreshSession.update({ where: { id: session.id }, data: { lastUsedAt: now } }).catch(() => undefined);
    actor.sessionId = session.id;
    actor.mfaVerifiedAt = session.mfaVerifiedAt?.toISOString();
    return actor;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.path === '/api/health' || request.path === '/api/auth/login' || request.path === '/api/auth/mfa/verify' || request.path === '/api/auth/refresh' || request.path === '/api/auth/logout' || request.path.startsWith('/api/docs')) return true;
    const header = String(request.headers.authorization || '');
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException('Sign in is required');
    request.actor = await this.auth.verifyToken(header.slice(7));
    if (request.actor.passwordChangeRequired && !['/api/auth/me', '/api/auth/change-password', '/api/auth/step-up'].includes(request.path)) {
      throw new ForbiddenException({ message: 'Change your temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
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
  if (!allowedByNewPolicy && !allowedByLegacyPolicy) throw new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    message: 'You do not have permission to perform this action.',
    permission,
    denial: { reason: denied ? 'EXPLICIT_DENY' : 'MISSING_PERMISSION', requestedAction: permission.split('.').at(-1) },
  });
}

export function can(actor: Actor, permission: string) {
  return hasPermission(actor.permissions, actor.deniedPermissions, permission);
}

export function isPrivilegedActor(actor: Actor) {
  return can(actor, 'system.super_admin')
    || can(actor, 'settings.users_access.manage')
    || Object.values(actor.companyScopedPermissions || {})
      .some((permissions) => hasPermission(permissions, actor.deniedPermissions, 'settings.users_access.manage'));
}
