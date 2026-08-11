import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PermissionOverrideEffect, Prisma } from '@prisma/client';
import type { Actor } from './auth';
import { PrismaService } from './prisma.service';
import { DATA_SCOPE_RESOURCES, FIELD_REGISTRY, hasPermission, LIMIT_REGISTRY, normalizePermissions, PERMISSION_REGISTRY } from './permissions';
import { evaluateSodRules } from './access-governance';

type Tx = Prisma.TransactionClient;
export type AccessRequestContext = { ipAddress?: string; requestId?: string };

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const idStrings = (values: unknown) => Array.isArray(values) ? values.map(String) : [];

@Injectable()
export class AccessControlService {
  constructor(private readonly db: PrismaService) {}

  private async ensureRegistry(tx: Tx, tenantId: bigint) {
    for (const definition of PERMISSION_REGISTRY) {
      await tx.permission.upsert({
        where: { tenantId_key: { tenantId, key: definition.key } },
        update: { module: definition.module, resource: definition.resource, action: definition.action, description: definition.description, active: true },
        create: { tenantId, ...definition },
      });
    }
  }

  private audit(tx: Tx, actor: Actor, action: string, context: AccessRequestContext, detail: {
    subjectUserId?: bigint; subjectRoleId?: bigint; permissionKey?: string; previousValue?: unknown; newValue?: unknown;
  } = {}) {
    return tx.accessAuditLog.create({ data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      subjectUserId: detail.subjectUserId,
      subjectRoleId: detail.subjectRoleId,
      action,
      permissionKey: detail.permissionKey,
      previousValue: detail.previousValue === undefined ? undefined : json(detail.previousValue),
      newValue: detail.newValue === undefined ? undefined : json(detail.newValue),
      ipAddress: context.ipAddress,
      branchId: actor.branchIds[0] ? BigInt(actor.branchIds[0]) : undefined,
      requestId: context.requestId,
    } });
  }

  private roleInclude = {
    permissionAssignments: { include: { permission: true } },
    limits: true,
    dataScopes: true,
    fieldPermissions: true,
    _count: { select: { users: true, additionalUsers: true } },
  } as const;

  private async invalidateRoleSessions(tx: Tx, roleId: bigint) {
    const users = await tx.user.findMany({
      where: { OR: [{ roleId }, { additionalRoles: { some: { roleId } } }] },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    if (!userIds.length) return;
    const now = new Date();
    await tx.user.updateMany({ where: { id: { in: userIds } }, data: { authVersion: { increment: 1 } } });
    await tx.refreshSession.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: now } });
  }

  private roleView(role: any) {
    return {
      id: role.id.toString(), key: role.key, name: role.name, description: role.description, active: role.active,
      archivedAt: role.archivedAt, createdAt: role.createdAt, updatedAt: role.updatedAt,
      permissionKeys: role.permissionAssignments.map((assignment: any) => assignment.permission.key).sort(),
      limits: role.limits.map((limit: any) => ({ key: limit.key, value: limit.value })),
      dataScopes: role.dataScopes.map((scope: any) => ({ resource: scope.resource, scope: scope.scope, config: scope.config })),
      fieldPermissions: role.fieldPermissions.map((field: any) => ({ resource: field.resource, field: field.field, access: field.access })),
      userCount: role._count.users + role._count.additionalUsers,
    };
  }

  async overview(actor: Actor) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.ensureRegistry(tx, actor.tenantId);
      const [roles, users, permissions, audit, bankAccounts, accounts, suppliers] = await Promise.all([
        tx.role.findMany({ where: { archivedAt: null }, include: this.roleInclude, orderBy: { name: 'asc' } }),
        tx.user.findMany({ include: {
          role: true,
          additionalRoles: { include: { role: true } },
          permissionOverrides: { include: { permission: true } },
        }, orderBy: { name: 'asc' } }),
        tx.permission.findMany({ where: { active: true }, orderBy: [{ module: 'asc' }, { resource: 'asc' }, { action: 'asc' }] }),
        tx.accessAuditLog.findMany({ include: { actorUser: { select: { id: true, name: true, email: true } }, subjectUser: { select: { id: true, name: true } }, subjectRole: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }),
        tx.bankAccount.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
        tx.account.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
        tx.supplier.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
      ]);
      return {
        roles: roles.map((role) => this.roleView(role)),
        users: users.map((user) => ({
          id: user.id.toString(), email: user.email, name: user.name, active: user.active, language: user.language,
          primaryRole: { id: user.role.id.toString(), name: user.role.name },
          additionalRoles: user.additionalRoles.map(({ role }) => ({ id: role.id.toString(), name: role.name })),
          overrides: user.permissionOverrides.map((override) => ({ id: override.id.toString(), permissionKey: override.permission.key, effect: override.effect, reason: override.reason })),
          branchIds: idStrings(user.branchIds), warehouseIds: idStrings(user.warehouseIds),
          mfaEnabled: user.mfaEnabled, mfaRequired: user.mfaRequired, mfaEnrolledAt: user.mfaEnrolledAt,
        })),
        permissions: permissions.map((permission) => ({ id: permission.id.toString(), key: permission.key, module: permission.module, resource: permission.resource, action: permission.action, description: permission.description })),
        audit: audit.map((entry) => ({ ...entry, id: entry.id.toString(), tenantId: entry.tenantId?.toString(), actorUserId: entry.actorUserId?.toString(), subjectUserId: entry.subjectUserId?.toString(), subjectRoleId: entry.subjectRoleId?.toString(), branchId: entry.branchId?.toString(), warehouseId: entry.warehouseId?.toString(), actorUser: entry.actorUser && { ...entry.actorUser, id: entry.actorUser.id.toString() }, subjectUser: entry.subjectUser && { ...entry.subjectUser, id: entry.subjectUser.id.toString() }, subjectRole: entry.subjectRole && { ...entry.subjectRole, id: entry.subjectRole.id.toString() } })),
        configuration: {
          dataScopeResources: DATA_SCOPE_RESOURCES,
          assignableResources: {
            bank_account: bankAccounts.map((item) => ({ ...item, id: item.id.toString() })),
            account: accounts.map((item) => ({ ...item, id: item.id.toString() })),
            supplier: suppliers.map((item) => ({ ...item, id: item.id.toString() })),
          },
          fields: FIELD_REGISTRY.map(([resource, field, description]) => ({ resource, field, description })), limits: LIMIT_REGISTRY,
        },
      };
    });
  }

  async createRole(actor: Actor, body: any, context: AccessRequestContext) {
    const name = String(body.name || '').trim();
    if (name.length < 2) throw new BadRequestException('Role name is required.');
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.ensureRegistry(tx, actor.tenantId);
      const duplicate = await tx.role.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
      if (duplicate) throw new ConflictException('A role with this name already exists.');
      const role = await tx.role.create({ data: { tenantId: actor.tenantId, name, description: String(body.description || '').trim() || null, permissions: [] } });
      const sodWarnings = await this.replaceRolePolicy(tx, actor.tenantId, role.id, body);
      await this.audit(tx, actor, 'ROLE_CREATED', context, { subjectRoleId: role.id, newValue: { name, description: role.description } });
      const created = await tx.role.findUniqueOrThrow({ where: { id: role.id }, include: this.roleInclude });
      for (const assignment of created.permissionAssignments) {
        await this.audit(tx, actor, 'PERMISSION_GRANTED', context, { subjectRoleId: role.id, permissionKey: assignment.permission.key, newValue: { granted: true } });
      }
      return { ...this.roleView(created), sodWarnings };
    });
  }

  async updateRole(actor: Actor, roleId: bigint, body: any, context: AccessRequestContext) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.ensureRegistry(tx, actor.tenantId);
      const before = await tx.role.findFirst({ where: { id: roleId }, include: this.roleInclude });
      if (!before) throw new NotFoundException('Role not found.');
      const name = body.name === undefined ? before.name : String(body.name).trim();
      if (!name) throw new BadRequestException('Role name is required.');
      await tx.role.update({ where: { id: roleId }, data: { name, description: body.description === undefined ? before.description : String(body.description || '').trim() || null } });
      const sodWarnings = await this.replaceRolePolicy(tx, actor.tenantId, roleId, body);
      await this.invalidateRoleSessions(tx, roleId);
      const after = await tx.role.findUniqueOrThrow({ where: { id: roleId }, include: this.roleInclude });
      await this.audit(tx, actor, 'ROLE_UPDATED', context, { subjectRoleId: roleId, previousValue: this.roleView(before), newValue: this.roleView(after) });
      const beforePermissions = new Set(before.permissionAssignments.map(({ permission }) => permission.key));
      const afterPermissions = new Set(after.permissionAssignments.map(({ permission }) => permission.key));
      for (const permissionKey of afterPermissions) {
        if (!beforePermissions.has(permissionKey)) await this.audit(tx, actor, 'PERMISSION_GRANTED', context, { subjectRoleId: roleId, permissionKey, newValue: { granted: true } });
      }
      for (const permissionKey of beforePermissions) {
        if (!afterPermissions.has(permissionKey)) await this.audit(tx, actor, 'PERMISSION_REVOKED', context, { subjectRoleId: roleId, permissionKey, previousValue: { granted: true }, newValue: { granted: false } });
      }
      return { ...this.roleView(after), sodWarnings };
    });
  }

  private async replaceRolePolicy(tx: Tx, tenantId: bigint, roleId: bigint, body: any) {
    let sodWarnings: ReturnType<typeof evaluateSodRules> = [];
    if (Array.isArray(body.permissionKeys)) {
      const keys = [...new Set<string>(body.permissionKeys.map(String))];
      const permissions = await tx.permission.findMany({ where: { key: { in: keys }, active: true } });
      if (permissions.length !== keys.length) throw new BadRequestException('One or more permission keys are invalid.');
      const conflicts = evaluateSodRules(keys, await tx.sodRule.findMany({ where: { active: true } }));
      const blocking = conflicts.filter(({ enforcement }) => enforcement === 'BLOCK');
      if (blocking.length) throw new ConflictException({ message: 'The role violates a blocking segregation-of-duties rule.', conflicts: blocking });
      sodWarnings = conflicts.filter(({ enforcement }) => enforcement === 'WARN');
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ tenantId, roleId, permissionId: permission.id })) });
      await tx.role.update({ where: { id: roleId }, data: { permissions: keys } });
    }
    if (Array.isArray(body.limits)) {
      const validLimits = new Set<string>(LIMIT_REGISTRY.map(({ key }) => key));
      if (body.limits.some((limit: any) => !validLimits.has(String(limit.key)) || !Number.isFinite(Number(limit.value)) || Number(limit.value) < 0)) {
        throw new BadRequestException('One or more role limits are invalid.');
      }
      await tx.roleLimit.deleteMany({ where: { roleId } });
      if (body.limits.length) await tx.roleLimit.createMany({ data: body.limits.map((limit: any) => ({ tenantId, roleId, key: String(limit.key), value: json(limit.value) })) });
    }
    if (Array.isArray(body.dataScopes)) {
      const validResources = new Set<string>(DATA_SCOPE_RESOURCES);
      const validScopes = new Set(['NONE', 'OWN', 'ASSIGNED', 'TEAM', 'BRANCH', 'WAREHOUSE', 'DEPARTMENT', 'ALL']);
      if (body.dataScopes.some((scope: any) => !validResources.has(String(scope.resource)) || !validScopes.has(String(scope.scope)))) {
        throw new BadRequestException('One or more data scopes are invalid.');
      }
      for (const scope of body.dataScopes) {
        if (String(scope.scope) !== 'ASSIGNED') continue;
        const resource = String(scope.resource);
        const resourceIds = [...new Set<string>((scope.config?.resourceIds || []).map(String))];
        if (resourceIds.some((value) => !/^\d+$/.test(value))) throw new BadRequestException(`Assigned ${resource} identifiers are invalid.`);
        const ids = resourceIds.map(BigInt);
        const count = resource === 'bank_account' ? await tx.bankAccount.count({ where: { id: { in: ids }, active: true } })
          : resource === 'account' ? await tx.account.count({ where: { id: { in: ids }, active: true } })
          : resource === 'supplier' ? await tx.supplier.count({ where: { id: { in: ids }, active: true } })
          : ids.length;
        if (count !== ids.length) throw new BadRequestException(`One or more assigned ${resource} resources are invalid.`);
      }
      await tx.roleDataScope.deleteMany({ where: { roleId } });
      if (body.dataScopes.length) await tx.roleDataScope.createMany({ data: body.dataScopes.map((scope: any) => ({ tenantId, roleId, resource: String(scope.resource), scope: scope.scope, config: scope.config === undefined ? undefined : json(scope.config) })) });
    }
    if (Array.isArray(body.fieldPermissions)) {
      const validFields = new Set(FIELD_REGISTRY.map(([resource, field]) => `${resource}.${field}`));
      const validAccess = new Set(['HIDDEN', 'VIEW', 'EDIT']);
      if (body.fieldPermissions.some((field: any) => !validFields.has(`${String(field.resource)}.${String(field.field)}`) || !validAccess.has(String(field.access)))) {
        throw new BadRequestException('One or more field permissions are invalid.');
      }
      await tx.roleFieldPermission.deleteMany({ where: { roleId } });
      if (body.fieldPermissions.length) await tx.roleFieldPermission.createMany({ data: body.fieldPermissions.map((field: any) => ({ tenantId, roleId, resource: String(field.resource), field: String(field.field), access: field.access })) });
    }
    return sodWarnings;
  }

  async duplicateRole(actor: Actor, roleId: bigint, body: any, context: AccessRequestContext) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      const source = await tx.role.findFirst({ where: { id: roleId }, include: this.roleInclude });
      if (!source) throw new NotFoundException('Role not found.');
      const name = String(body.name || `${source.name} Copy`).trim();
      const existing = await tx.role.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
      if (existing) throw new ConflictException('A role with this name already exists.');
      const copy = await tx.role.create({ data: { tenantId: actor.tenantId, name, description: source.description, permissions: source.permissionAssignments.map(({ permission }) => permission.key) } });
      const sodWarnings = await this.replaceRolePolicy(tx, actor.tenantId, copy.id, {
        permissionKeys: source.permissionAssignments.map(({ permission }) => permission.key),
        limits: source.limits.map(({ key, value }) => ({ key, value })),
        dataScopes: source.dataScopes.map(({ resource, scope, config }) => ({ resource, scope, config })),
        fieldPermissions: source.fieldPermissions.map(({ resource, field, access }) => ({ resource, field, access })),
      });
      await this.audit(tx, actor, 'ROLE_DUPLICATED', context, { subjectRoleId: copy.id, previousValue: { sourceRoleId: source.id.toString() }, newValue: { name } });
      return { ...this.roleView(await tx.role.findUniqueOrThrow({ where: { id: copy.id }, include: this.roleInclude })), sodWarnings };
    });
  }

  async archiveRole(actor: Actor, roleId: bigint, context: AccessRequestContext) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId }, include: { _count: { select: { users: true, additionalUsers: true } } } });
      if (!role) throw new NotFoundException('Role not found.');
      if (role.key === 'super_admin') throw new ConflictException('The Super Admin role cannot be archived.');
      if (role._count.users + role._count.additionalUsers > 0) throw new ConflictException('Reassign all users before archiving this role.');
      const archived = await tx.role.update({ where: { id: roleId }, data: { active: false, archivedAt: new Date() } });
      await this.invalidateRoleSessions(tx, roleId);
      await this.audit(tx, actor, 'ROLE_ARCHIVED', context, { subjectRoleId: roleId, previousValue: { active: true }, newValue: { active: false, archivedAt: archived.archivedAt } });
      return { ok: true };
    });
  }

  async updateUser(actor: Actor, userId: bigint, body: any, context: AccessRequestContext) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.ensureRegistry(tx, actor.tenantId);
      const before = await tx.user.findFirst({ where: { id: userId }, include: { role: true, additionalRoles: { include: { role: true } }, permissionOverrides: { include: { permission: true } } } });
      if (!before) throw new NotFoundException('User not found.');
      if (userId === actor.userId && body.active === false) throw new ConflictException('You cannot deactivate your own account.');
      const primaryRoleId = body.primaryRoleId === undefined ? before.roleId : BigInt(body.primaryRoleId);
      const primaryRole = await tx.role.findFirst({
        where: { id: primaryRoleId, active: true, archivedAt: null },
        include: { permissionAssignments: { include: { permission: true } } },
      });
      if (!primaryRole) throw new BadRequestException('Primary role is invalid or archived.');
      const requestedBranchIds = body.branchIds === undefined ? idStrings(before.branchIds) : [...new Set<string>(body.branchIds.map(String))];
      const requestedWarehouseIds = body.warehouseIds === undefined ? idStrings(before.warehouseIds) : [...new Set<string>(body.warehouseIds.map(String))];
      const branchIds = requestedBranchIds.map(BigInt);
      const warehouseIds = requestedWarehouseIds.map(BigInt);
      if (await tx.branch.count({ where: { id: { in: branchIds } } }) !== branchIds.length) throw new BadRequestException('One or more branch assignments are invalid.');
      const warehouses = await tx.warehouse.findMany({ where: { id: { in: warehouseIds }, active: true }, select: { id: true, branchId: true } });
      if (warehouses.length !== warehouseIds.length || warehouses.some((warehouse) => !branchIds.includes(warehouse.branchId))) {
        throw new BadRequestException('Warehouses must be active and belong to an assigned branch.');
      }
      const requestedAdditionalRoleIds = Array.isArray(body.additionalRoleIds)
        ? [...new Set<string>(body.additionalRoleIds.map(String))].filter((value) => value !== primaryRoleId.toString()).map(BigInt)
        : before.additionalRoles.map(({ role }) => role.id);
      const requestedRoles = requestedAdditionalRoleIds.length ? await tx.role.findMany({
        where: { id: { in: requestedAdditionalRoleIds }, active: true, archivedAt: null },
        include: { permissionAssignments: { include: { permission: true } } },
      }) : [];
      if (requestedRoles.length !== requestedAdditionalRoleIds.length) throw new BadRequestException('One or more additional roles are invalid.');
      const requestedOverrides: Array<{ permissionKey: string; effect: PermissionOverrideEffect; reason: string | null }> = Array.isArray(body.overrides)
        ? body.overrides.map((override: any) => ({
          permissionKey: String(override.permissionKey),
          effect: String(override.effect) === 'DENY' ? PermissionOverrideEffect.DENY : PermissionOverrideEffect.GRANT,
          reason: String(override.reason || '').trim() || null,
        }))
        : before.permissionOverrides.map((override) => ({ permissionKey: override.permission.key, effect: override.effect, reason: override.reason }));
      const overrideKeys = [...new Set(requestedOverrides.map(({ permissionKey }) => permissionKey))];
      const overridePermissions = overrideKeys.length ? await tx.permission.findMany({ where: { key: { in: overrideKeys }, active: true } }) : [];
      if (overridePermissions.length !== overrideKeys.length) throw new BadRequestException('One or more override permissions are invalid.');
      const permissionByKey = new Map(overridePermissions.map((permission) => [permission.key, permission]));
      // Older persisted roles still carry pre-registry aliases in Role.permissions.
      // Runtime access expands those aliases, so assignment-time SoD evaluation
      // must inspect the same canonical effective grants.
      const roleGrants = normalizePermissions([primaryRole, ...requestedRoles].flatMap((role) => [
        ...idStrings(role.permissions),
        ...role.permissionAssignments.map(({ permission }) => permission.key),
      ]));
      const overrideGrants = requestedOverrides.filter(({ effect }) => effect === PermissionOverrideEffect.GRANT).map(({ permissionKey }) => permissionKey);
      const overrideDenies = requestedOverrides.filter(({ effect }) => effect === PermissionOverrideEffect.DENY).map(({ permissionKey }) => permissionKey);
      const effectivePermissions = PERMISSION_REGISTRY.map(({ key }) => key)
        .filter((permission) => hasPermission([...roleGrants, ...overrideGrants], overrideDenies, permission));
      const sodConflicts = evaluateSodRules(effectivePermissions, await tx.sodRule.findMany({ where: { active: true } }));
      const blockingSod = sodConflicts.filter(({ enforcement }) => enforcement === 'BLOCK');
      if (blockingSod.length) throw new ConflictException({ message: 'The user access change violates a blocking segregation-of-duties rule.', conflicts: blockingSod });
      const sodWarnings = sodConflicts.filter(({ enforcement }) => enforcement === 'WARN');
      const hadSuperAdmin = before.role.key === 'super_admin' || before.additionalRoles.some(({ role }) => role.key === 'super_admin');
      const willHaveSuperAdmin = primaryRole.key === 'super_admin' || requestedRoles.some((role) => role.key === 'super_admin');
      if (hadSuperAdmin && (!willHaveSuperAdmin || body.active === false)) {
        const otherSuperAdmins = await tx.user.count({ where: {
          id: { not: userId }, active: true,
          OR: [{ role: { key: 'super_admin', active: true } }, { additionalRoles: { some: { role: { key: 'super_admin', active: true } } } }],
        } });
        if (otherSuperAdmins === 0) throw new ConflictException('At least one active Super Admin must remain.');
      }
      await tx.user.update({ where: { id: userId }, data: {
        roleId: primaryRoleId,
        active: body.active === undefined ? before.active : Boolean(body.active),
        mfaRequired: body.mfaRequired === undefined ? before.mfaRequired : Boolean(body.mfaRequired),
        branchIds: body.branchIds === undefined ? undefined : json(requestedBranchIds),
        warehouseIds: body.warehouseIds === undefined ? undefined : json(requestedWarehouseIds),
        authVersion: { increment: 1 },
      } });
      if (Array.isArray(body.additionalRoleIds)) {
        await tx.userRole.deleteMany({ where: { userId } });
        if (requestedAdditionalRoleIds.length) await tx.userRole.createMany({ data: requestedAdditionalRoleIds.map((roleId) => ({ tenantId: actor.tenantId, userId, roleId })) });
      }
      if (Array.isArray(body.overrides)) {
        await tx.userPermissionOverride.deleteMany({ where: { userId } });
        if (requestedOverrides.length) await tx.userPermissionOverride.createMany({ data: requestedOverrides.map((override) => ({
          tenantId: actor.tenantId, userId, permissionId: permissionByKey.get(override.permissionKey)!.id,
          effect: override.effect,
          reason: override.reason, createdById: actor.userId,
        })) });
      }
      await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      const after = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true, additionalRoles: { include: { role: true } }, permissionOverrides: { include: { permission: true } } } });
      const snapshot = (user: any) => ({ active: user.active, primaryRole: user.role.name, additionalRoles: user.additionalRoles.map((item: any) => item.role.name), overrides: user.permissionOverrides.map((item: any) => ({ permissionKey: item.permission.key, effect: item.effect })) });
      await this.audit(tx, actor, 'USER_ACCESS_UPDATED', context, { subjectUserId: userId, previousValue: snapshot(before), newValue: snapshot(after) });
      const beforeRoles = new Map([before.role, ...before.additionalRoles.map(({ role }) => role)].map((role) => [role.id.toString(), role.name]));
      const afterRoles = new Map([after.role, ...after.additionalRoles.map(({ role }) => role)].map((role) => [role.id.toString(), role.name]));
      for (const [roleId, roleName] of afterRoles) if (!beforeRoles.has(roleId)) await this.audit(tx, actor, 'USER_ASSIGNED_TO_ROLE', context, { subjectUserId: userId, subjectRoleId: BigInt(roleId), newValue: { roleName } });
      for (const [roleId, roleName] of beforeRoles) if (!afterRoles.has(roleId)) await this.audit(tx, actor, 'USER_REMOVED_FROM_ROLE', context, { subjectUserId: userId, subjectRoleId: BigInt(roleId), previousValue: { roleName } });
      const beforeOverrides = new Map(before.permissionOverrides.map((override) => [override.permission.key, override.effect]));
      const afterOverrides = new Map(after.permissionOverrides.map((override) => [override.permission.key, override.effect]));
      for (const [permissionKey, effect] of afterOverrides) {
        if (beforeOverrides.get(permissionKey) !== effect) await this.audit(tx, actor, 'USER_OVERRIDE_ADDED', context, { subjectUserId: userId, permissionKey, previousValue: beforeOverrides.has(permissionKey) ? { effect: beforeOverrides.get(permissionKey) } : undefined, newValue: { effect } });
      }
      for (const [permissionKey, effect] of beforeOverrides) {
        if (!afterOverrides.has(permissionKey)) await this.audit(tx, actor, 'USER_OVERRIDE_REMOVED', context, { subjectUserId: userId, permissionKey, previousValue: { effect } });
      }
      return { ok: true, sodWarnings };
    });
  }

  async resetUserMfa(actor: Actor, userId: bigint, reason: string, context: AccessRequestContext) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10) throw new BadRequestException('MFA reset requires a specific governance reason.');
    if (actor.userId === userId) throw new ConflictException('Your own MFA reset requires another privileged administrator.');
    return this.db.tenant(actor.tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found.');
      const now = new Date();
      await tx.user.update({ where: { id: userId }, data: {
        mfaEnabled: false, mfaSecretEncrypted: null, mfaRecoveryHashes: [], mfaEnrolledAt: null, authVersion: { increment: 1 },
      } });
      await tx.mfaChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
      await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await this.audit(tx, actor, 'MFA_RESET', context, { subjectUserId: userId, previousValue: { mfaEnabled: user.mfaEnabled }, newValue: { mfaEnabled: false, reason: normalizedReason } });
      return { ok: true, sessionsRevoked: true };
    });
  }
}
