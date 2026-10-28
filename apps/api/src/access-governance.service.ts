import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessReviewDecision, AccountType, BankAccountType, FinancialResourceType, Prisma, SodEnforcement } from '@prisma/client';
import { hasPermission, LIMIT_REGISTRY } from './permissions';
import type { Actor } from './auth';
import { AuthService, can } from './auth';
import { canAtCompany, evaluateSodRules, isDelegablePermission } from './access-governance';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;
type RequestContext = { ipAddress?: string; requestId?: string };
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const strings = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(String))] : [];

@Injectable()
export class AccessGovernanceService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  private assertReason(value: unknown) {
    const reason = String(value || '').trim();
    if (reason.length < 10) throw new BadRequestException('A specific governance reason of at least 10 characters is required.');
    return reason;
  }

  private window(body: any, maximumDays: number) {
    const validFrom = new Date(String(body.validFrom || new Date().toISOString()));
    const validUntil = new Date(String(body.validUntil || ''));
    if (Number.isNaN(validFrom.valueOf()) || Number.isNaN(validUntil.valueOf()) || validUntil <= validFrom) {
      throw new BadRequestException('A valid access start and later expiry are required.');
    }
    if (validUntil <= new Date() || validUntil.valueOf() - validFrom.valueOf() > maximumDays * 86_400_000) {
      throw new BadRequestException(`The access window must expire in the future and cannot exceed ${maximumDays} days.`);
    }
    return { validFrom, validUntil };
  }

  private assertCompanyAdmin(actor: Actor, companyId: bigint | string) {
    if (can(actor, 'system.super_admin') || actor.companyAdminIds.includes(companyId.toString())) return;
    throw new ForbiddenException('Company Administrator access is required for this company.');
  }

  private async assertCompany(tx: Tx, actor: Actor, companyId: bigint) {
    this.assertCompanyAdmin(actor, companyId);
    const company = await tx.company.findFirst({ where: { id: companyId, active: true } });
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  private async assertMember(tx: Tx, companyId: bigint, userId: bigint) {
    const now = new Date();
    const membership = await tx.companyMembership.findFirst({ where: {
      companyId, userId, active: true, validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    }, include: { user: { include: { role: true, additionalRoles: { include: { role: true } } } } } });
    if (!membership) throw new BadRequestException('The user is not an active member of this company.');
    return membership;
  }

  private audit(tx: Tx, actor: Actor, companyId: bigint, action: string, context: RequestContext, detail: Record<string, unknown>) {
    return tx.accessAuditLog.create({ data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      subjectUserId: detail.subjectUserId ? BigInt(String(detail.subjectUserId)) : undefined,
      action,
      companyId: companyId.toString(),
      resourceType: detail.resourceType ? String(detail.resourceType) : undefined,
      resourceId: detail.resourceId ? String(detail.resourceId) : undefined,
      newValue: json(detail),
      ipAddress: context.ipAddress,
      requestId: context.requestId,
    } });
  }

  async companies(actor: Actor) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      const visibleCompanyIds = actor.companyIds.filter((companyId) => canAtCompany(actor, 'settings.users_access.view', companyId)).map(BigInt);
      const where = can(actor, 'system.super_admin') ? {} : { id: { in: visibleCompanyIds } };
      const companies = await tx.company.findMany({ where, include: {
        branchLinks: { where: { active: true }, include: { branch: true } },
        memberships: { where: { active: true }, include: { user: { select: { id: true, name: true, email: true, active: true } } } },
        financialResources: { where: { active: true }, orderBy: [{ type: 'asc' }, { code: 'asc' }] },
      }, orderBy: { name: 'asc' } });
      return companies.map((company) => ({
        id: company.id.toString(), code: company.code, name: company.name, baseCurrency: company.baseCurrency, active: company.active,
        administrator: can(actor, 'system.super_admin') || actor.companyAdminIds.includes(company.id.toString()),
        branches: company.branchLinks.map(({ branch }) => ({ id: branch.id.toString(), code: branch.code, name: branch.name })),
        memberships: company.memberships.map((membership) => ({ id: membership.id.toString(), userId: membership.userId.toString(), role: membership.role, active: membership.active, validFrom: membership.validFrom, validUntil: membership.validUntil, user: { ...membership.user, id: membership.user.id.toString() } })),
        financialResources: company.financialResources.map((resource) => ({
          ...resource,
          id: resource.id.toString(),
          tenantId: resource.tenantId.toString(),
          companyId: resource.companyId.toString(),
          linkedBankAccountId: resource.linkedBankAccountId?.toString(),
          linkedAccountId: resource.linkedAccountId?.toString(),
        })),
      }));
    });
  }

  async createCompany(actor: Actor, body: any, context: RequestContext) {
    if (!can(actor, 'system.super_admin')) throw new ForbiddenException('Only a tenant Super Admin can create a company.');
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    if (code === 'DEFAULT' || !/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code) || name.length < 2) throw new BadRequestException('A valid non-reserved company code and name are required.');
    return this.db.tenant(actor.tenantId, async (tx) => {
      const company = await tx.company.create({ data: { tenantId: actor.tenantId, code, name, baseCurrency: String(body.baseCurrency || 'EGP').toUpperCase() } });
      await tx.companyMembership.create({ data: { tenantId: actor.tenantId, companyId: company.id, userId: actor.userId, role: 'ADMINISTRATOR', createdById: actor.userId } });
      const branchIds = strings(body.branchIds);
      for (const rawBranchId of branchIds) {
        const branchId = BigInt(rawBranchId);
        const branch = await tx.branch.findFirst({ where: { id: branchId }, include: { companyLinks: true, _count: { select: {
          documents: true, journals: true, stockMoves: true, posShifts: true, bankTxns: true, sequences: true,
          defaultCustomers: true, accessAuditLogs: true, authorityPolicies: true,
        } } } });
        if (!branch) throw new BadRequestException('One or more company branches are invalid.');
        const activity = Object.values(branch._count).reduce((sum, count) => sum + count, 0);
        if (activity > 0) throw new ConflictException('A branch with transactional or numbering history cannot be reassigned to a new company.');
        const existing = branch.companyLinks[0];
        if (existing) await tx.companyBranch.update({ where: { branchId }, data: { companyId: company.id, active: true } });
        else await tx.companyBranch.create({ data: { tenantId: actor.tenantId, companyId: company.id, branchId } });
      }
      const accounts = await tx.account.findMany({ where: { active: true }, select: { id: true, code: true, name: true } });
      if (accounts.length) await tx.financialResource.createMany({ data: accounts.map((account) => ({
        tenantId: actor.tenantId, companyId: company.id, type: FinancialResourceType.GL_ACCOUNT,
        code: account.code, name: account.name, linkedAccountId: account.id,
      })), skipDuplicates: true });
      const actorUser = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { branchIds: true } });
      const assignedBranches = [...new Set([...strings(actorUser.branchIds), ...branchIds])];
      await tx.user.update({ where: { id: actor.userId }, data: { branchIds: assignedBranches, authVersion: { increment: 1 } } });
      await this.audit(tx, actor, company.id, 'COMPANY_CREATED', context, { resourceType: 'COMPANY', resourceId: company.id.toString(), code, name });
      return { ...company, id: company.id.toString(), tenantId: company.tenantId.toString() };
    });
  }

  async upsertMembership(actor: Actor, companyId: bigint, userId: bigint, body: any, context: RequestContext) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.assertCompany(tx, actor, companyId);
      const user = await tx.user.findFirst({ where: { id: userId }, include: { role: true, additionalRoles: { include: { role: true } } } });
      if (!user) throw new NotFoundException('User not found.');
      const isTenantSuperAdmin = user.role.key === 'super_admin' || user.additionalRoles.some(({ role }) => role.key === 'super_admin');
      if (isTenantSuperAdmin && !can(actor, 'system.super_admin')) throw new ForbiddenException('Company Administrators cannot modify tenant Super Admin membership.');
      const role = String(body.role) === 'ADMINISTRATOR' ? 'ADMINISTRATOR' : 'MEMBER';
      const validUntil = body.validUntil ? new Date(String(body.validUntil)) : null;
      if (validUntil && (Number.isNaN(validUntil.valueOf()) || validUntil <= new Date())) throw new BadRequestException('Membership expiry must be in the future.');
      const membership = await tx.companyMembership.upsert({
        where: { tenantId_companyId_userId: { tenantId: actor.tenantId, companyId, userId } },
        create: { tenantId: actor.tenantId, companyId, userId, role, active: body.active !== false, validUntil, createdById: actor.userId },
        update: { role, active: body.active !== false, validUntil, createdById: actor.userId },
      });
      const companyBranches = (await tx.companyBranch.findMany({ where: { companyId, active: true }, select: { branchId: true } })).map(({ branchId }) => branchId.toString());
      const companyBranchSet = new Set(companyBranches);
      const currentBranches = strings(user.branchIds);
      const requestedBranches = body.active === false ? [] : body.branchIds === undefined
        ? currentBranches.filter((branchId) => companyBranchSet.has(branchId))
        : strings(body.branchIds);
      if (requestedBranches.some((branchId) => !companyBranchSet.has(branchId))) throw new BadRequestException('Membership branches must be active branches of the selected company.');
      const branchIds = [...new Set([...currentBranches.filter((branchId) => !companyBranchSet.has(branchId)), ...requestedBranches])];
      await tx.user.update({ where: { id: userId }, data: { branchIds, authVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor, companyId, 'COMPANY_MEMBERSHIP_UPDATED', context, { subjectUserId: userId.toString(), resourceType: 'COMPANY_MEMBERSHIP', resourceId: membership.id.toString(), role, active: membership.active, validUntil, branchIds: requestedBranches });
      return { ...membership, id: membership.id.toString(), tenantId: membership.tenantId.toString(), companyId: membership.companyId.toString(), userId: membership.userId.toString(), createdById: membership.createdById?.toString(), branchIds: requestedBranches };
    });
  }

  async createFinancialResource(actor: Actor, companyId: bigint, body: any, context: RequestContext) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      const company = await this.assertCompany(tx, actor, companyId);
      const type = String(body.type) as FinancialResourceType;
      if (!Object.values(FinancialResourceType).includes(type)) throw new BadRequestException('Financial resource type is invalid.');
      const code = String(body.code || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      if (!code || name.length < 2) throw new BadRequestException('Financial resource code and name are required.');
      let linkedBankAccountId = body.linkedBankAccountId ? BigInt(body.linkedBankAccountId) : null;
      let linkedAccountId = body.linkedAccountId ? BigInt(body.linkedAccountId) : null;
      let provisionedBank = false;
      let provisionedAccount = false;
      if (type === FinancialResourceType.GL_ACCOUNT && !linkedAccountId) {
        const accountType = String(body.accountType || '') as AccountType;
        if (!Object.values(AccountType).includes(accountType)) throw new BadRequestException('A valid accountType is required when provisioning a company GL account.');
        const physicalCode = String(body.ledgerCode || code).trim().toUpperCase();
        let account = await tx.account.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: physicalCode } } });
        if (!account) {
          account = await tx.account.create({ data: { tenantId: actor.tenantId, code: physicalCode, name, type: accountType, postingAllowed: body.postingAllowed !== false, controlType: body.controlType || null } });
          provisionedAccount = true;
        }
        linkedAccountId = account.id;
      }
      if (type === FinancialResourceType.BANK_ACCOUNT && !linkedBankAccountId) {
        const glResourceId = String(body.glResourceId || '');
        const glResource = await tx.financialResource.findFirst({ where: { id: glResourceId, companyId, type: FinancialResourceType.GL_ACCOUNT, active: true }, include: { linkedAccount: true } });
        const accountType = String(body.bankAccountType || '') as BankAccountType;
        if (!glResource?.linkedAccountId || !Object.values(BankAccountType).includes(accountType)) throw new BadRequestException('A company GL resource and valid bankAccountType are required when provisioning a bank account.');
        const physicalCode = String(body.ledgerCode || `${company.code}-${code}`).trim().toUpperCase();
        const bank = await tx.bankAccount.create({ data: { tenantId: actor.tenantId, code: physicalCode, name, type: accountType, currency: String(body.currency || company.baseCurrency).toUpperCase(), glAccountId: glResource.linkedAccountId, bankName: body.bankName || null, accountNumber: body.accountNumber || null } });
        linkedBankAccountId = bank.id;
        provisionedBank = true;
      }
      if (type === FinancialResourceType.BANK_ACCOUNT && (!linkedBankAccountId || linkedAccountId)) throw new BadRequestException('A bank-account resource requires exactly one linked bank account.');
      if (type === FinancialResourceType.GL_ACCOUNT && (!linkedAccountId || linkedBankAccountId)) throw new BadRequestException('A GL-account resource requires exactly one linked account.');
      if (type !== FinancialResourceType.BANK_ACCOUNT && type !== FinancialResourceType.GL_ACCOUNT && (linkedAccountId || linkedBankAccountId)) throw new BadRequestException('Only typed bank or GL resources can link legacy accounts.');
      if (linkedBankAccountId && !await tx.bankAccount.findFirst({ where: { id: linkedBankAccountId, active: true } })) throw new BadRequestException('Linked bank account is invalid.');
      if (linkedAccountId && !await tx.account.findFirst({ where: { id: linkedAccountId, active: true } })) throw new BadRequestException('Linked GL account is invalid.');
      let resource;
      if (type === FinancialResourceType.GL_ACCOUNT) {
        const existingLink = await tx.financialResource.findFirst({ where: { companyId, linkedAccountId } });
        if (existingLink && !provisionedAccount) throw new ConflictException('This GL definition is already enabled for the company.');
        resource = existingLink
          ? await tx.financialResource.update({ where: { id: existingLink.id }, data: { code, name, metadata: body.metadata === undefined ? undefined : json(body.metadata), active: true } })
          : await tx.financialResource.create({ data: { tenantId: actor.tenantId, companyId, type, code, name, linkedAccountId, metadata: body.metadata === undefined ? undefined : json(body.metadata) } });
      } else if (type === FinancialResourceType.BANK_ACCOUNT) {
        const existingLink = await tx.financialResource.findUnique({ where: { linkedBankAccountId: linkedBankAccountId! } });
        if (existingLink?.companyId === companyId && !provisionedBank) throw new ConflictException('This bank account is already mapped to the company.');
        if (existingLink && !provisionedBank) throw new ForbiddenException('An existing bank account cannot be moved between companies. Provision a new company-owned bank account.');
        const useCount = existingLink
          ? await tx.payment.count({ where: { bankAccountId: linkedBankAccountId! } }) + await tx.bankTransaction.count({ where: { bankAccountId: linkedBankAccountId! } }) + await tx.bankStatement.count({ where: { bankAccountId: linkedBankAccountId! } })
          : 0;
        if (useCount > 0) throw new ConflictException('A financial account with operational history cannot be reassigned to another company.');
        resource = existingLink
          ? await tx.financialResource.update({ where: { id: existingLink.id }, data: { companyId, code, name, metadata: body.metadata === undefined ? undefined : json(body.metadata), active: true } })
          : await tx.financialResource.create({ data: { tenantId: actor.tenantId, companyId, type, code, name, linkedBankAccountId, metadata: body.metadata === undefined ? undefined : json(body.metadata) } });
      } else {
        resource = await tx.financialResource.create({ data: { tenantId: actor.tenantId, companyId, type, code, name, metadata: body.metadata === undefined ? undefined : json(body.metadata) } });
      }
      await this.audit(tx, actor, companyId, 'FINANCIAL_RESOURCE_CREATED', context, { resourceType: type, resourceId: resource.id, code, name });
      return { ...resource, tenantId: resource.tenantId.toString(), companyId: resource.companyId.toString(), linkedBankAccountId: resource.linkedBankAccountId?.toString(), linkedAccountId: resource.linkedAccountId?.toString() };
    });
  }

  async assignFinancialResource(actor: Actor, resourceId: string, body: any, context: RequestContext) {
    const userId = BigInt(body.userId || 0);
    const reason = this.assertReason(body.reason);
    const validFrom = body.validFrom ? new Date(String(body.validFrom)) : new Date();
    const validUntil = body.validUntil ? new Date(String(body.validUntil)) : null;
    if (Number.isNaN(validFrom.valueOf()) || validUntil && (Number.isNaN(validUntil.valueOf()) || validUntil <= validFrom)) throw new BadRequestException('Resource assignment validity is invalid.');
    return this.db.tenant(actor.tenantId, async (tx) => {
      const resource = await tx.financialResource.findFirst({ where: { id: resourceId, active: true } });
      if (!resource) throw new NotFoundException('Financial resource not found.');
      await this.assertCompany(tx, actor, resource.companyId);
      await this.assertMember(tx, resource.companyId, userId);
      const assignment = await tx.financialResourceAssignment.create({ data: { tenantId: actor.tenantId, userId, resourceId, reason, validFrom, validUntil, grantedById: actor.userId } });
      await this.audit(tx, actor, resource.companyId, 'FINANCIAL_RESOURCE_ASSIGNED', context, { subjectUserId: userId.toString(), resourceType: resource.type, resourceId, reason, validFrom, validUntil });
      return { ...assignment, id: assignment.id.toString(), tenantId: assignment.tenantId.toString(), userId: assignment.userId.toString(), grantedById: assignment.grantedById.toString() };
    });
  }

  async revokeFinancialResourceAssignment(actor: Actor, assignmentId: bigint, context: RequestContext) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      const assignment = await tx.financialResourceAssignment.findFirst({ where: { id: assignmentId }, include: { resource: true } });
      if (!assignment) throw new NotFoundException('Financial resource assignment not found.');
      await this.assertCompany(tx, actor, assignment.resource.companyId);
      if (assignment.revokedAt) return { ok: true, alreadyRevoked: true };
      await tx.financialResourceAssignment.update({ where: { id: assignmentId }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor, assignment.resource.companyId, 'FINANCIAL_RESOURCE_REVOKED', context, {
        subjectUserId: assignment.userId.toString(), resourceType: assignment.resource.type,
        resourceId: assignment.resourceId, assignmentId: assignment.id.toString(),
      });
      return { ok: true };
    });
  }

  private async validatePermissions(tx: Tx, actor: Actor, companyId: bigint, raw: unknown, permanentOnly = false) {
    const permissionKeys = strings(raw);
    if (!permissionKeys.length) throw new BadRequestException('At least one permission is required.');
    if (permissionKeys.some((permission) => !isDelegablePermission(permission))) throw new ForbiddenException('Privileged system and access-administration permissions cannot be temporary or delegated.');
    const count = await tx.permission.count({ where: { key: { in: permissionKeys }, active: true } });
    if (count !== permissionKeys.length) throw new BadRequestException('One or more permissions are invalid.');
    const allowed = (permission: string) => permanentOnly
      ? hasPermission(actor.permissions, actor.deniedPermissions, permission)
      : canAtCompany(actor, permission, companyId);
    if (!can(actor, 'system.super_admin') && permissionKeys.some((permission) => !allowed(permission))) throw new ForbiddenException('You cannot grant a permission you do not possess in this company.');
    return permissionKeys;
  }

  private async assertNoBlockingSod(tx: Tx, current: readonly string[], additions: readonly string[]) {
    const proposed = [...new Set([...current, ...additions])];
    const conflicts = evaluateSodRules(proposed, await tx.sodRule.findMany({ where: { active: true } }));
    const blocking = conflicts.filter(({ enforcement }) => enforcement === SodEnforcement.BLOCK);
    if (blocking.length) throw new ConflictException({ message: 'The proposed access violates a blocking segregation-of-duties rule.', conflicts: blocking });
  }

  private resourceIdentity(resource: { id: string; type: FinancialResourceType; linkedBankAccountId: bigint | null; linkedAccountId: bigint | null }) {
    if (resource.type === FinancialResourceType.BANK_ACCOUNT && resource.linkedBankAccountId) return ['bank_account', resource.linkedBankAccountId.toString()] as const;
    if (resource.type === FinancialResourceType.GL_ACCOUNT && resource.linkedAccountId) return ['account', resource.linkedAccountId.toString()] as const;
    return [resource.type.toLowerCase(), resource.id] as const;
  }

  private async validateResourceAssignments(tx: Tx, companyId: bigint, raw: unknown, directlyHeldByUserId?: bigint) {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Resource assignments must be an object keyed by typed resource.');
    const requested = Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([key, ids]) => [key, strings(ids)]));
    const allowedKeys = new Set(['treasury', 'wallet', 'payment_card', 'cash_source', 'cheque_book', 'cost_center', 'project', 'bank_account', 'account']);
    if (Object.keys(requested).some((key) => !allowedKeys.has(key))) throw new BadRequestException('One or more resource assignment types are invalid.');
    const now = new Date();
    const resources = directlyHeldByUserId
      ? (await tx.financialResourceAssignment.findMany({ where: {
          userId: directlyHeldByUserId, resource: { companyId, active: true }, revokedAt: null, validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        }, include: { resource: true } })).map(({ resource }) => resource)
      : await tx.financialResource.findMany({ where: { companyId, active: true } });
    const allowed = new Map<string, Set<string>>();
    for (const resource of resources) {
      const [key, value] = this.resourceIdentity(resource);
      const bucket = allowed.get(key) || new Set<string>();
      bucket.add(value);
      allowed.set(key, bucket);
    }
    for (const [key, ids] of Object.entries(requested)) {
      if (ids.some((resourceId) => !allowed.get(key)?.has(resourceId))) {
        throw new ForbiddenException(`One or more ${key} resources are not active, not in this company, or not directly assigned.`);
      }
    }
    return requested;
  }

  async createTemporaryGrant(actor: Actor, body: any, context: RequestContext) {
    const companyId = BigInt(body.companyId || 0), userId = BigInt(body.userId || 0);
    const reason = this.assertReason(body.reason), { validFrom, validUntil } = this.window(body, 90);
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.assertCompany(tx, actor, companyId);
      await this.assertMember(tx, companyId, userId);
      const permissions = await this.validatePermissions(tx, actor, companyId, body.permissionKeys);
      const resourceAssignments = await this.validateResourceAssignments(tx, companyId, body.resourceAssignments);
      const { effective } = await this.subjectActor(tx, userId);
      if (permissions.some((permission) => !hasPermission([permission], effective.deniedPermissions, permission))) throw new ForbiddenException('A direct or wildcard DENY on the subject blocks this temporary grant.');
      const current = [...effective.permissions, ...(effective.companyScopedPermissions[companyId.toString()] || [])]
        .filter((permission) => hasPermission([permission], effective.deniedPermissions, permission));
      await this.assertNoBlockingSod(tx, current, permissions);
      const grant = await tx.temporaryAccessGrant.create({ data: { tenantId: actor.tenantId, companyId, userId, grantedById: actor.userId, permissions: json(permissions), resourceAssignments: json(resourceAssignments), reason, validFrom, validUntil } });
      await this.audit(tx, actor, companyId, 'TEMPORARY_ACCESS_GRANTED', context, { subjectUserId: userId.toString(), resourceType: 'TEMPORARY_ACCESS_GRANT', resourceId: grant.id, permissions, resourceAssignments, reason, validFrom, validUntil });
      return { ...grant, tenantId: grant.tenantId.toString(), companyId: grant.companyId.toString(), userId: grant.userId.toString(), grantedById: grant.grantedById.toString() };
    });
  }

  async createDelegation(actor: Actor, body: any, context: RequestContext) {
    const companyId = BigInt(body.companyId || 0), delegateeId = BigInt(body.delegateeId || 0);
    if (delegateeId === actor.userId) throw new ConflictException('You cannot delegate access to yourself.');
    const reason = this.assertReason(body.reason), { validFrom, validUntil } = this.window(body, 30);
    return this.db.tenant(actor.tenantId, async (tx) => {
      if (!actor.companyIds.includes(companyId.toString()) && !can(actor, 'system.super_admin')) throw new ForbiddenException('You are not a member of this company.');
      await this.assertMember(tx, companyId, delegateeId);
      const permissions = await this.validatePermissions(tx, actor, companyId, body.permissionKeys, true);
      const resourceAssignments = await this.validateResourceAssignments(tx, companyId, body.resourceAssignments, actor.userId);
      const { effective } = await this.subjectActor(tx, delegateeId);
      if (permissions.some((permission) => !hasPermission([permission], effective.deniedPermissions, permission))) throw new ForbiddenException('A direct or wildcard DENY on the delegatee blocks this delegation.');
      const current = [...effective.permissions, ...(effective.companyScopedPermissions[companyId.toString()] || [])]
        .filter((permission) => hasPermission([permission], effective.deniedPermissions, permission));
      await this.assertNoBlockingSod(tx, current, permissions);
      const delegation = await tx.delegation.create({ data: { tenantId: actor.tenantId, companyId, delegatorId: actor.userId, delegateeId, permissions: json(permissions), resourceAssignments: json(resourceAssignments), reason, validFrom, validUntil } });
      await this.audit(tx, actor, companyId, 'ACCESS_DELEGATED', context, { subjectUserId: delegateeId.toString(), resourceType: 'DELEGATION', resourceId: delegation.id, permissions, resourceAssignments, reason, validFrom, validUntil });
      return { ...delegation, tenantId: delegation.tenantId.toString(), companyId: delegation.companyId.toString(), delegatorId: delegation.delegatorId.toString(), delegateeId: delegation.delegateeId.toString() };
    });
  }

  async revokeTemporaryGrant(actor: Actor, grantId: string, context: RequestContext) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      const grant = await tx.temporaryAccessGrant.findFirst({ where: { id: grantId } });
      if (!grant) throw new NotFoundException('Temporary grant not found.');
      await this.assertCompany(tx, actor, grant.companyId);
      if (grant.revokedAt) return { ok: true, alreadyRevoked: true };
      await tx.temporaryAccessGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor, grant.companyId, 'TEMPORARY_ACCESS_REVOKED', context, { subjectUserId: grant.userId.toString(), resourceType: 'TEMPORARY_ACCESS_GRANT', resourceId: grant.id });
      return { ok: true };
    });
  }

  async revokeDelegation(actor: Actor, delegationId: string, context: RequestContext) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      const delegation = await tx.delegation.findFirst({ where: { id: delegationId } });
      if (!delegation) throw new NotFoundException('Delegation not found.');
      if (delegation.delegatorId !== actor.userId) this.assertCompanyAdmin(actor, delegation.companyId);
      if (delegation.revokedAt) return { ok: true, alreadyRevoked: true };
      await tx.delegation.update({ where: { id: delegationId }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor, delegation.companyId, 'DELEGATION_REVOKED', context, { subjectUserId: delegation.delegateeId.toString(), resourceType: 'DELEGATION', resourceId: delegation.id });
      return { ok: true };
    });
  }

  private async subjectActor(tx: Tx, userId: bigint) {
    const user = await tx.user.findFirst({ where: { id: userId }, include: this.auth.userInclude });
    if (!user) throw new NotFoundException('User not found.');
    return { user, effective: this.auth.actorFor(user) };
  }

  private lifecycleStatus(record: { active?: boolean; validFrom?: Date | string; validUntil?: Date | string | null; revokedAt?: Date | string | null }, now = new Date()) {
    if (record.revokedAt) return 'REVOKED';
    if (record.active === false) return 'INACTIVE';
    if (record.validFrom && new Date(record.validFrom) > now) return 'SCHEDULED';
    if (record.validUntil && new Date(record.validUntil) <= now) return 'EXPIRED';
    return 'ACTIVE';
  }

  private accessView(user: any, effective: Actor, companyId: bigint, rules: readonly any[], now = new Date()) {
    const key = companyId.toString();
    const membership = (user.companyMemberships || []).find((entry: any) => entry.companyId.toString() === key);
    const permissionKeys = [...new Set([...effective.permissions, ...(effective.companyScopedPermissions[key] || [])])]
      .filter((permission) => hasPermission([permission], effective.deniedPermissions, permission)).sort();
    const sodWarnings = evaluateSodRules(permissionKeys, rules);
    const grants = (user.temporaryGrants || []).filter((grant: any) => grant.companyId.toString() === key);
    const delegations = (user.delegationsReceived || []).filter((delegation: any) => delegation.companyId.toString() === key);
    const assignments = (user.resourceAssignments || []).filter((assignment: any) => assignment.resource?.companyId?.toString() === key);
    const soon = new Date(now.valueOf() + 14 * 86_400_000);
    const riskFlags = [
      ...sodWarnings.map((conflict) => ({ key: `SOD_${conflict.ruleKey}`, severity: conflict.enforcement, message: conflict.name })),
      ...(!user.active ? [{ key: 'USER_INACTIVE', severity: 'BLOCK', message: 'The user account is inactive.' }] : []),
      ...(!effective.companyBranchIds[key]?.length ? [{ key: 'NO_ASSIGNED_BRANCH', severity: 'WARN', message: 'The membership has no assigned company branch.' }] : []),
      ...(membership?.validUntil && membership.validUntil <= soon ? [{ key: 'MEMBERSHIP_EXPIRING', severity: 'WARN', message: 'Company membership expires within 14 days.' }] : []),
      ...(grants.some((grant: any) => this.lifecycleStatus(grant, now) === 'ACTIVE' && grant.validUntil <= soon) ? [{ key: 'TEMPORARY_ACCESS_EXPIRING', severity: 'WARN', message: 'Temporary access expires within 14 days.' }] : []),
      ...(delegations.some((delegation: any) => this.lifecycleStatus(delegation, now) === 'ACTIVE' && delegation.validUntil <= soon) ? [{ key: 'DELEGATION_EXPIRING', severity: 'WARN', message: 'Delegated access expires within 14 days.' }] : []),
    ];
    return {
      user: { id: user.id.toString(), name: user.name, email: user.email, active: user.active },
      companyId: key,
      permissionKeys,
      permanentPermissionKeys: effective.permissions,
      companyScopedPermissionKeys: effective.companyScopedPermissions[key] || [],
      deniedPermissionKeys: effective.deniedPermissions,
      dataScopes: effective.dataScopes,
      fieldPermissions: effective.fieldPermissions,
      limits: effective.limits,
      resourceAssignments: effective.companyResourceAssignments[key] || {},
      sources: {
        membership: membership ? {
          id: membership.id.toString(), role: membership.role, active: membership.active,
          validFrom: membership.validFrom, validUntil: membership.validUntil,
          status: this.lifecycleStatus(membership, now), branchIds: effective.companyBranchIds[key] || [],
        } : null,
        roles: [user.role, ...(user.additionalRoles || []).map((entry: any) => entry.role)].map((role: any) => ({
          id: role.id.toString(), key: role.key, name: role.name, active: role.active,
          permissionKeys: (role.permissionAssignments || []).map((entry: any) => entry.permission.key).sort(),
        })),
        directOverrides: (user.permissionOverrides || []).map((override: any) => ({ key: override.permission.key, effect: override.effect })),
        organization: { departmentId: user.employee?.departmentId?.toString() || null, employeeId: user.employee?.id?.toString() || null },
        financialResources: assignments.map((assignment: any) => ({
          assignmentId: assignment.id.toString(), resourceId: assignment.resourceId, type: assignment.resource.type,
          code: assignment.resource.code, name: assignment.resource.name, validFrom: assignment.validFrom,
          validUntil: assignment.validUntil, revokedAt: assignment.revokedAt, status: this.lifecycleStatus(assignment, now),
        })),
        temporaryGrants: grants.map((grant: any) => ({
          id: grant.id, permissionKeys: strings(grant.permissions), resourceAssignments: grant.resourceAssignments,
          reason: grant.reason, validFrom: grant.validFrom, validUntil: grant.validUntil, revokedAt: grant.revokedAt,
          status: this.lifecycleStatus(grant, now),
        })),
        delegations: delegations.map((delegation: any) => ({
          id: delegation.id, delegator: { id: delegation.delegatorId.toString(), name: delegation.delegator?.name, active: delegation.delegator?.active },
          permissionKeys: strings(delegation.permissions), resourceAssignments: delegation.resourceAssignments,
          reason: delegation.reason, validFrom: delegation.validFrom, validUntil: delegation.validUntil,
          revokedAt: delegation.revokedAt, status: this.lifecycleStatus(delegation, now),
        })),
      },
      sodWarnings,
      riskFlags,
      evaluatedAt: now.toISOString(),
    };
  }

  async effectiveAccess(actor: Actor, userId: bigint, companyId: bigint) {
    if (actor.userId !== userId) this.assertCompanyAdmin(actor, companyId);
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.assertMember(tx, companyId, userId);
      const { user, effective } = await this.subjectActor(tx, userId);
      const rules = await tx.sodRule.findMany({ where: { active: true } });
      return this.accessView(user, effective, companyId, rules);
    });
  }

  async simulate(actor: Actor, body: any) {
    const companyId = BigInt(body.companyId || 0), userId = BigInt(body.userId || 0);
    if (actor.userId !== userId) this.assertCompanyAdmin(actor, companyId);
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.assertMember(tx, companyId, userId);
      const { effective } = await this.subjectActor(tx, userId);
      const current = [...new Set([...effective.permissions, ...(effective.companyScopedPermissions[companyId.toString()] || [])])]
        .filter((permission) => hasPermission([permission], effective.deniedPermissions, permission)).sort();
      const requestedProposedKeys = body.proposed?.permissionKeys === undefined ? current : strings(body.proposed.permissionKeys);
      const validCount = await tx.permission.count({ where: { key: { in: requestedProposedKeys }, active: true } });
      if (validCount !== requestedProposedKeys.length) throw new BadRequestException('One or more simulated permissions are invalid.');
      const proposedKeys = requestedProposedKeys
        .filter((permission) => hasPermission([permission], effective.deniedPermissions, permission))
        .sort();
      const blockedByDeny = requestedProposedKeys.filter((permission) => !proposedKeys.includes(permission)).sort();
      const rules = await tx.sodRule.findMany({ where: { active: true } });
      return {
        mode: 'SAFE_PREVIEW', mutated: false, userId: userId.toString(), companyId: companyId.toString(), evaluatedAt: new Date().toISOString(),
        current: { permissionKeys: current, sodWarnings: evaluateSodRules(current, rules) },
        proposed: { requestedPermissionKeys: requestedProposedKeys.sort(), permissionKeys: proposedKeys, blockedByDeny, sodWarnings: evaluateSodRules(proposedKeys, rules) },
        delta: { added: proposedKeys.filter((key) => !current.includes(key)).sort(), removed: current.filter((key) => !proposedKeys.includes(key)).sort() },
      };
    });
  }

  async createReview(actor: Actor, body: any, context: RequestContext) {
    const companyId = BigInt(body.companyId || 0), subjectUserId = BigInt(body.userId || 0);
    this.assertCompanyAdmin(actor, companyId);
    if (subjectUserId === actor.userId) throw new ConflictException('Access reviews require a different reviewer.');
    const reason = this.assertReason(body.reason);
    const decision = String(body.decision) as AccessReviewDecision;
    if (!Object.values(AccessReviewDecision).includes(decision)) throw new BadRequestException('Access review decision is invalid.');
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.assertMember(tx, companyId, subjectUserId);
      const { user, effective } = await this.subjectActor(tx, subjectUserId);
      const rules = await tx.sodRule.findMany({ where: { active: true } });
      const snapshot = this.accessView(user, effective, companyId, rules);
      const review = await tx.accessReviewRecord.create({ data: { tenantId: actor.tenantId, companyId, subjectUserId, reviewerId: actor.userId, decision, reason, snapshot: json(snapshot) } });
      await this.audit(tx, actor, companyId, 'ACCESS_REVIEW_COMPLETED', context, { subjectUserId: subjectUserId.toString(), resourceType: 'ACCESS_REVIEW', resourceId: review.id, decision, reason });
      return { ...review, tenantId: review.tenantId.toString(), companyId: review.companyId.toString(), subjectUserId: review.subjectUserId.toString(), reviewerId: review.reviewerId.toString() };
    });
  }

  async reviews(actor: Actor, companyId: bigint, userId?: bigint) {
    this.assertCompanyAdmin(actor, companyId);
    return this.db.tenant(actor.tenantId, async (tx) => (await tx.accessReviewRecord.findMany({
      where: { companyId, ...(userId ? { subjectUserId: userId } : {}) },
      include: { subjectUser: { select: { id: true, name: true, email: true } }, reviewer: { select: { id: true, name: true, email: true } } },
      orderBy: { reviewedAt: 'desc' }, take: 200,
    })).map((review) => ({ ...review, tenantId: review.tenantId.toString(), companyId: review.companyId.toString(), subjectUserId: review.subjectUserId.toString(), reviewerId: review.reviewerId.toString(), subjectUser: { ...review.subjectUser, id: review.subjectUser.id.toString() }, reviewer: { ...review.reviewer, id: review.reviewer.id.toString() } })));
  }

  async createAuthorityPolicy(actor: Actor, body: any, context: RequestContext) {
    for(const field of ['companyId','branchId','roleId','departmentId'])if((field==='companyId'||body[field])&&!/^[1-9]\d{0,17}$/.test(String(body[field])))throw new BadRequestException('Authority policy assignment is invalid.');
    if(body.maxAmountMinor!==undefined&&body.maxAmountMinor!==null&&!/^\d{1,18}$/.test(String(body.maxAmountMinor)))throw new BadRequestException('Authority policy amount is invalid.');
    const companyId = BigInt(body.companyId);
    const reason = this.assertReason(body.reason);
    const key = String(body.key || '');
    const currency = String(body.currency || '').toUpperCase();
    const maxAmountMinor = body.maxAmountMinor === undefined || body.maxAmountMinor === null ? null : BigInt(body.maxAmountMinor);
    const maxPercentBps = body.maxPercentBps === undefined || body.maxPercentBps === null ? null : Number(body.maxPercentBps);
    const definition = LIMIT_REGISTRY.find((candidate) => candidate.key === key);
    const typedLimitInvalid = definition?.unit === 'percent'
      ? maxPercentBps === null || maxAmountMinor !== null
      : maxAmountMinor === null || maxPercentBps !== null;
    if (!definition || !currency || typedLimitInvalid || maxAmountMinor !== null && maxAmountMinor < 0n || maxPercentBps !== null && (!Number.isInteger(maxPercentBps) || maxPercentBps < 0 || maxPercentBps > 10_000)) throw new BadRequestException('Authority policy limit is invalid.');
    return this.db.tenant(actor.tenantId, async (tx) => {
      await this.assertCompany(tx, actor, companyId);
      if(!await tx.currency.findFirst({where:{code:currency,active:true}}))throw new BadRequestException('Select an active configured currency.');
      const branchId = body.branchId ? BigInt(body.branchId) : null;
      const roleId = body.roleId ? BigInt(body.roleId) : null;
      const departmentId = body.departmentId ? BigInt(body.departmentId) : null;
      if (branchId && !await tx.companyBranch.findFirst({ where: { companyId, branchId, active: true } })) throw new BadRequestException('Authority-policy branch is not in this company.');
      if (roleId && !await tx.role.findFirst({ where: { id: roleId, active: true, archivedAt: null } })) throw new BadRequestException('Authority-policy role is invalid.');
      if (departmentId && !await tx.department.findFirst({ where: { id: departmentId, active: true } })) throw new BadRequestException('Authority-policy department is invalid.');
      const validFrom = body.validFrom ? new Date(String(body.validFrom)) : new Date();
      const validUntil = body.validUntil ? new Date(String(body.validUntil)) : null;
      if (Number.isNaN(validFrom.valueOf()) || validUntil && (Number.isNaN(validUntil.valueOf()) || validUntil <= validFrom)) throw new BadRequestException('Authority-policy validity is invalid.');
      const policy = await tx.authorityLimitPolicy.create({ data: {
        tenantId: actor.tenantId, companyId, branchId, roleId, departmentId,
        key, documentType: body.documentType || null, currency, maxAmountMinor, maxPercentBps, priority: Number(body.priority || 0),
        validFrom, validUntil,
      } });
      await this.audit(tx, actor, companyId, 'AUTHORITY_POLICY_CREATED', context, { resourceType: 'AUTHORITY_LIMIT_POLICY', resourceId: policy.id.toString(), key, currency, maxAmountMinor: maxAmountMinor?.toString(), maxPercentBps, reason });
      return { ...policy, id: policy.id.toString(), tenantId: policy.tenantId.toString(), companyId: policy.companyId.toString(), branchId: policy.branchId?.toString(), roleId: policy.roleId?.toString(), departmentId: policy.departmentId?.toString(), maxAmountMinor: policy.maxAmountMinor?.toString() };
    });
  }

  async enforceAuthorityLimit(tx: Tx, actor: Actor, input: { companyId: bigint; branchId?: bigint; key: string; currency: string; amountMinor?: bigint; percentBps?: number; documentType?: string }) {
    if (can(actor, 'system.super_admin')) return;
    const now = new Date();
    const policies = await tx.authorityLimitPolicy.findMany({ where: {
      companyId: input.companyId, key: input.key, currency: input.currency, active: true,
      validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      AND: [{ OR: [{ branchId: null }, { branchId: input.branchId }] }, { OR: [{ roleId: null }, { roleId: { in: actor.roleIds.map(BigInt) } }] }, { OR: [{ departmentId: null }, ...(actor.departmentId ? [{ departmentId: BigInt(actor.departmentId) }] : [])] }, { OR: [{ documentType: null }, { documentType: input.documentType }] }],
    }, orderBy: [{ priority: 'desc' }, { id: 'desc' }] });
    if (!policies.length) return;
    const amountLimits = policies.flatMap((policy) => policy.maxAmountMinor === null ? [] : [policy.maxAmountMinor]);
    const percentLimits = policies.flatMap((policy) => policy.maxPercentBps === null ? [] : [policy.maxPercentBps]);
    const amountLimit = amountLimits.length ? amountLimits.reduce((minimum, value) => value < minimum ? value : minimum) : null;
    const percentLimit = percentLimits.length ? Math.min(...percentLimits) : null;
    if (input.amountMinor !== undefined && amountLimit !== null && input.amountMinor > amountLimit) throw new ForbiddenException(`Amount exceeds ${input.key} authority for ${input.currency}.`);
    if (input.percentBps !== undefined && percentLimit !== null && input.percentBps > percentLimit) throw new ForbiddenException(`Percentage exceeds ${input.key} authority.`);
  }

  async sodForPermissions(actor: Actor, permissionKeys: string[]) {
    return this.db.tenant(actor.tenantId, async (tx) => {
      const rules = await tx.sodRule.findMany({ where: { active: true } });
      const conflicts = evaluateSodRules(permissionKeys, rules);
      const blocking = conflicts.filter(({ enforcement }) => enforcement === SodEnforcement.BLOCK);
      if (blocking.length) throw new ConflictException({ message: 'The proposed access violates a blocking segregation-of-duties rule.', conflicts: blocking });
      return conflicts;
    });
  }
}
