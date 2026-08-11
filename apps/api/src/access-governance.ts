import { ForbiddenException } from '@nestjs/common';
import { hasPermission, normalizePermissions } from './permissions';
import type { EffectiveDataScope, EffectiveFieldPermission } from './auth';

export type CompanyScopedAccess = {
  companyIds: string[];
  companyAdminIds: string[];
  companyBranchIds: Record<string, string[]>;
  companyScopedPermissions: Record<string, string[]>;
  companyResourceAssignments: Record<string, Record<string, string[]>>;
};

const values = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const objectAssignments = (value: unknown): Record<string, string[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, ids]) => [key, values(ids)]));
};

export const NON_DELEGABLE_PERMISSIONS = [
  'system.super_admin',
  'settings.users_access.manage',
  'settings.system.manage',
  'settings.system.reset',
] as const;

export function isDelegablePermission(permission: string) {
  return !NON_DELEGABLE_PERMISSIONS.some((blocked) => permission === blocked || permission.startsWith(`${blocked}.`));
}

function basePolicy(user: any) {
  const roles = [user.role, ...(user.additionalRoles || []).map((assignment: any) => assignment.role)]
    .filter((role: any) => role?.active !== false && !role?.archivedAt);
  const legacyPermissions = [...new Set<string>(roles.flatMap((role: any) => Array.isArray(role.permissions) ? role.permissions.map(String) : []))];
  const assignedPermissions = roles.flatMap((role: any) => (role.permissionAssignments || []).map((assignment: any) => assignment.permission.key));
  const grants = new Set<string>([...normalizePermissions(legacyPermissions), ...assignedPermissions]);
  const denies = new Set<string>();
  for (const override of user.permissionOverrides || []) {
    if (override.effect === 'DENY') denies.add(override.permission.key);
    else grants.add(override.permission.key);
  }
  return { roles, legacyPermissions, grants, denies };
}

function activeAt(record: { validFrom?: Date | string; validUntil?: Date | string | null; revokedAt?: Date | string | null; active?: boolean }, now: Date) {
  const from = record.validFrom ? new Date(record.validFrom) : new Date(0);
  const until = record.validUntil ? new Date(record.validUntil) : null;
  return record.active !== false && !record.revokedAt && from <= now && (!until || until > now);
}

function append(target: Record<string, Set<string>>, key: string, entries: readonly string[]) {
  const bucket = target[key] || new Set<string>();
  for (const entry of entries) bucket.add(entry);
  target[key] = bucket;
}

function appendCompanyResource(target: Record<string, Record<string, Set<string>>>, companyId: string, resource: string, entries: readonly string[]) {
  const company = target[companyId] || {};
  append(company, resource, entries);
  target[companyId] = company;
}

function resourceAssignment(resource: any) {
  if (resource.type === 'BANK_ACCOUNT' && resource.linkedBankAccountId) return ['bank_account', resource.linkedBankAccountId.toString()] as const;
  if (resource.type === 'GL_ACCOUNT' && resource.linkedAccountId) return ['account', resource.linkedAccountId.toString()] as const;
  return [String(resource.type || '').toLowerCase(), String(resource.id)] as const;
}

export function resolveEffectiveAccess(user: any, now = new Date()) {
  const base = basePolicy(user);
  const memberships = (user.companyMemberships || []).filter((membership: any) => activeAt(membership, now) && membership.company?.active !== false);
  const membershipByCompany = new Map<string, any>(memberships.map((membership: any) => [membership.companyId.toString(), membership]));
  const companyIds = [...membershipByCompany.keys()].sort();
  const companyAdminIds = memberships.filter((membership: any) => membership.role === 'ADMINISTRATOR').map((membership: any) => membership.companyId.toString()).sort();
  const companyBranchIds: Record<string, string[]> = {};
  const assignedBranches = new Set(values(user.branchIds));
  const activeCompanyResources: Record<string, Record<string, Set<string>>> = {};
  for (const membership of memberships) {
    const companyId = membership.companyId.toString();
    companyBranchIds[companyId] = (membership.company.branchLinks || [])
      .filter((link: any) => link.active !== false && assignedBranches.has(link.branchId.toString()))
      .map((link: any) => link.branchId.toString())
      .sort();
    for (const resource of membership.company.financialResources || []) {
      if (resource.active === false) continue;
      const [key, id] = resourceAssignment(resource);
      const companyResources = activeCompanyResources[companyId] || {};
      append(companyResources, key, [id]);
      activeCompanyResources[companyId] = companyResources;
    }
  }

  const scoped: Record<string, Set<string>> = {};
  for (const companyId of companyAdminIds) append(scoped, companyId, [
    'settings.users_access.view',
    'settings.users_access.manage',
  ]);
  const assignments: Record<string, Record<string, Set<string>>> = {};
  for (const assignment of user.resourceAssignments || []) {
    if (!activeAt(assignment, now) || assignment.resource?.active === false || !membershipByCompany.has(assignment.resource?.companyId?.toString())) continue;
    const [resource, id] = resourceAssignment(assignment.resource);
    appendCompanyResource(assignments, assignment.resource.companyId.toString(), resource, [id]);
  }
  for (const grant of user.temporaryGrants || []) {
    const companyId = grant.companyId.toString();
    if (!activeAt(grant, now) || !membershipByCompany.has(companyId)) continue;
    append(scoped, companyId, values(grant.permissions));
    for (const [resource, ids] of Object.entries(objectAssignments(grant.resourceAssignments))) {
      appendCompanyResource(assignments, companyId, resource, ids.filter((id) => activeCompanyResources[companyId]?.[resource]?.has(id)));
    }
  }
  for (const delegation of user.delegationsReceived || []) {
    const companyId = delegation.companyId.toString();
    const delegatorMembership = (delegation.delegator?.companyMemberships || []).find((membership: any) => membership.companyId?.toString() === companyId && activeAt(membership, now) && membership.company?.active !== false);
    if (!activeAt(delegation, now) || !membershipByCompany.has(companyId) || delegation.delegator?.active === false || !delegatorMembership) continue;
    const delegator = basePolicy(delegation.delegator || {});
    const delegatedPermissions = values(delegation.permissions);
    const stillHeld = delegatedPermissions.filter((permission) => isDelegablePermission(permission)
      && hasPermission([...delegator.grants], [...delegator.denies], permission));
    append(scoped, companyId, stillHeld);
    // Resource assignments are a capability bundle with the delegated
    // permissions. On partial role/override loss, revoke the resource side of
    // the whole bundle rather than letting an unrelated retained permission
    // keep a bank or GL capability alive.
    if (!stillHeld.length || stillHeld.length !== delegatedPermissions.length) continue;
    const directResources: Record<string, Set<string>> = {};
    for (const assignment of delegation.delegator?.resourceAssignments || []) {
      if (!activeAt(assignment, now) || assignment.resource?.active === false || assignment.resource?.companyId?.toString() !== companyId) continue;
      const [resource, id] = resourceAssignment(assignment.resource);
      append(directResources, resource, [id]);
    }
    for (const [resource, ids] of Object.entries(objectAssignments(delegation.resourceAssignments))) {
      appendCompanyResource(assignments, companyId, resource, ids.filter((id) => directResources[resource]?.has(id)));
    }
  }

  const scopeRank: Record<string, number> = { NONE: 0, OWN: 1, ASSIGNED: 2, TEAM: 3, DEPARTMENT: 4, WAREHOUSE: 5, BRANCH: 6, ALL: 7 };
  const scopes = new Map<string, EffectiveDataScope>();
  for (const scope of base.roles.flatMap((role: any) => role.dataScopes || [])) {
    const existing = scopes.get(scope.resource);
    if (!existing || scopeRank[scope.scope] > scopeRank[existing.scope]) scopes.set(scope.resource, { resource: scope.resource, scope: scope.scope, config: scope.config });
  }
  const fieldRank: Record<string, number> = { HIDDEN: 0, VIEW: 1, EDIT: 2 };
  const fields = new Map<string, EffectiveFieldPermission>();
  for (const field of base.roles.flatMap((role: any) => role.fieldPermissions || [])) {
    const key = `${field.resource}.${field.field}`;
    const existing = fields.get(key);
    if (!existing || fieldRank[field.access] > fieldRank[existing.access]) fields.set(key, { resource: field.resource, field: field.field, access: field.access });
  }
  const limits: Record<string, unknown> = {};
  for (const limit of base.roles.flatMap((role: any) => role.limits || [])) {
    const previous = Number(limits[limit.key]);
    const current = Number(typeof limit.value === 'object' && limit.value !== null && 'value' in limit.value ? limit.value.value : limit.value);
    if (!Number.isFinite(previous) || current > previous) limits[limit.key] = limit.value;
  }

  return {
    roles: base.roles,
    legacyPermissions: base.legacyPermissions,
    permissions: [...base.grants].sort(),
    deniedPermissions: [...base.denies].sort(),
    dataScopes: [...scopes.values()],
    fieldPermissions: [...fields.values()],
    limits,
    companyIds,
    companyAdminIds,
    companyBranchIds,
    companyScopedPermissions: Object.fromEntries(Object.entries(scoped).map(([key, set]) => [key, [...set].sort()])),
    companyResourceAssignments: Object.fromEntries(Object.entries(assignments).map(([companyId, resources]) => [companyId,
      Object.fromEntries(Object.entries(resources).map(([resource, set]) => [resource, [...set].sort()])),
    ])),
  };
}

export function companyForBranch(actor: CompanyScopedAccess, branchId: bigint | string) {
  const value = branchId.toString();
  return Object.entries(actor.companyBranchIds).find(([, branchIds]) => branchIds.includes(value))?.[0];
}

export function canAtCompany(actor: { permissions: string[]; deniedPermissions: string[]; companyScopedPermissions: Record<string, string[]> }, permission: string, companyId: bigint | string) {
  if (hasPermission(actor.permissions, actor.deniedPermissions, permission)) return true;
  return hasPermission(actor.companyScopedPermissions[companyId.toString()] || [], actor.deniedPermissions, permission);
}

export function requirePermissionAtCompany(actor: Parameters<typeof canAtCompany>[0], permission: string, companyId: bigint | string) {
  if (!canAtCompany(actor, permission, companyId)) throw new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    message: 'You do not have permission to perform this action in the selected company.',
    permission,
    denial: { reason: 'MISSING_COMPANY_PERMISSION', companyId: companyId.toString(), requestedAction: permission.split('.').at(-1) },
  });
}

export type SodConflict = { ruleKey: string; name: string; enforcement: 'WARN' | 'BLOCK'; left: string[]; right: string[] };

export function evaluateSodRules(permissionKeys: readonly string[], rules: readonly any[]): SodConflict[] {
  return rules.flatMap((rule: any) => {
    if (rule.active === false) return [];
    const left = values(rule.leftPermissions).filter((permission) => hasPermission(permissionKeys, [], permission));
    const right = values(rule.rightPermissions).filter((permission) => hasPermission(permissionKeys, [], permission));
    return left.length && right.length ? [{ ruleKey: String(rule.key), name: String(rule.name), enforcement: rule.enforcement as 'WARN' | 'BLOCK', left, right }] : [];
  });
}
