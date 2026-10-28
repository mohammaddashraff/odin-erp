import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType, BankAccountType, BankTransactionKind, DocumentType, FinancialResourceType, JournalStatus, PaymentKind, PaymentMethod, PaymentStatus,
  PosSaleStatus, PosShiftStatus, Prisma, WorkflowStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { compare } from 'bcryptjs';
import { Actor, can, requirePermission } from './auth';
import { CustomerReceivablesService, receivableBaseMinor, receivableJournalAmounts } from './customer-receivables';
import { money, parseFixed, quantity, roundDiv, serialize } from './money';
import { PrismaService } from './prisma.service';
import { demoResetEnabled } from './deployment-config';
import { normalizePermissions } from './permissions';
import { canAtCompany, companyForBranch, requirePermissionAtCompany } from './access-governance';
import { AccessGovernanceService } from './access-governance.service';
import { fieldAccess, projectRecord } from './field-projection';
import { seed } from '../prisma/seed';
import { accountingFilters, accountingReportNames, buildAccountingReport } from './accounting-workspace';
import { hrKind, hrRecordInput, hrDate, leaveBalance, assertAnnualLeaveBalance } from './hr-workspace';
import { accountCodePrefix, nextAvailableAccountCode } from './account-code';

type Tx = Prisma.TransactionClient;
type JournalLineInput = { code: string; debit?: bigint; credit?: bigint; description: string };
type PlannedPaymentAllocation = { documentId: bigint; amountMinor: bigint };
const publicUser = { select: { id: true, name: true, email: true } } as const;

const SALES_TYPES = new Set<DocumentType>([
  DocumentType.QUOTATION, DocumentType.SALES_ORDER, DocumentType.DELIVERY_NOTE,
  DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE,
]);
const PURCHASE_TYPES = new Set<DocumentType>([
  DocumentType.PURCHASE_REQUEST, DocumentType.PURCHASE_RFQ, DocumentType.PURCHASE_ORDER, DocumentType.GOODS_RECEIPT,
  DocumentType.PURCHASE_BILL, DocumentType.PURCHASE_RETURN,
]);
const CONVERSIONS: Partial<Record<DocumentType, DocumentType[]>> = {
  QUOTATION: [DocumentType.SALES_ORDER],
  SALES_ORDER: [DocumentType.DELIVERY_NOTE],
  DELIVERY_NOTE: [DocumentType.SALES_INVOICE],
  SALES_INVOICE: [DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE],
  PURCHASE_REQUEST: [DocumentType.PURCHASE_RFQ],
  PURCHASE_RFQ: [DocumentType.PURCHASE_ORDER],
  PURCHASE_ORDER: [DocumentType.GOODS_RECEIPT],
  GOODS_RECEIPT: [DocumentType.PURCHASE_BILL, DocumentType.PURCHASE_RETURN],
  PURCHASE_BILL: [DocumentType.PURCHASE_RETURN],
};

export function calculateDocumentLine(quantityMilli: bigint, unitPriceMinor: bigint, discountMinor: bigint, taxRateBps: bigint, taxMode: string) {
  if (quantityMilli <= 0n) throw new BadRequestException('Quantity must be greater than zero');
  if (unitPriceMinor < 0n) throw new BadRequestException('Unit price cannot be negative');
  const gross = roundDiv(quantityMilli * unitPriceMinor, 1000n);
  if (discountMinor < 0n || discountMinor > gross) throw new BadRequestException('Discount is invalid');
  if (taxRateBps < 0n || taxRateBps > 10_000n) throw new BadRequestException('Tax rate must be between 0 and 100');
  const charged = gross - discountMinor;
  const taxableMinor = taxMode === 'INCLUSIVE' ? roundDiv(charged * 10_000n, 10_000n + taxRateBps) : charged;
  const taxMinor = taxMode === 'EXEMPT' ? 0n : taxMode === 'INCLUSIVE' ? charged - taxableMinor : roundDiv(taxableMinor * taxRateBps, 10_000n);
  const totalMinor = taxMode === 'INCLUSIVE' ? charged : taxableMinor + taxMinor;
  return { grossMinor: gross, taxableMinor, taxMinor, totalMinor };
}

export function documentEditState(status: WorkflowStatus, hasOperationalEffects: boolean) {
  if (hasOperationalEffects || status === WorkflowStatus.POSTED || status === WorkflowStatus.CANCELLED) {
    return { editable: false, reason: 'This document can no longer be edited because operational or accounting effects already exist.' };
  }
  if (status === WorkflowStatus.SUBMITTED) return { editable: false, reason: 'This document is locked while approval is pending.' };
  if (status === WorkflowStatus.APPROVED) return { editable: false, reason: 'Create a revision to change an approved document.' };
  return { editable: status === WorkflowStatus.DRAFT || status === WorkflowStatus.REJECTED, reason: null };
}

export function documentConversionAllowed(sourceType: DocumentType, sourceStatus: WorkflowStatus, targetType: DocumentType) {
  const supportedTarget = CONVERSIONS[sourceType]?.includes(targetType) ?? false;
  if (!supportedTarget) return false;
  if (sourceType === DocumentType.QUOTATION && targetType === DocumentType.SALES_ORDER && sourceStatus === WorkflowStatus.DRAFT) return true;
  return sourceStatus === WorkflowStatus.APPROVED || sourceStatus === WorkflowStatus.POSTED;
}

@Injectable()
export class ErpService {
  constructor(
    private readonly db: PrismaService,
    private readonly governance: AccessGovernanceService,
    private readonly receivables: CustomerReceivablesService = new CustomerReceivablesService(),
  ) {}

  async withTenant<T>(actor: Actor, work: (tx: Tx) => Promise<T>) {
    return serialize(await this.db.tenant(actor.tenantId, work));
  }

  async health() {
    await this.db.healthCheck();
    return { api: 'ok', database: 'ok', timestamp: new Date().toISOString() };
  }

  av8Number(tx: Tx, actor: Actor, branchId: bigint, type: string) {
    return this.sequence(tx, actor, branchId, type, new Date());
  }

  /** AV8 operational subledger posts through the existing bank, numbering,
   * authority, balanced journal and locked-period controls. No external transfer. */
  async postAv8Cash(tx: Tx, actor: Actor, fund: any, agencyAccountId: bigint, permission = 'av8.finance.confirm') {
    const companyId = this.requireAtBranch(actor, permission, fund.branchId);
    this.assertResourceId(actor, 'bank_account', fund.bankAccountId, companyId);
    const bank = await tx.bankAccount.findFirst({ where: { id: fund.bankAccountId, tenantId: actor.tenantId, active: true,
      ...this.resourceIdScope(actor, 'bank_account', companyId) }, include: { glAccount: true } });
    if (!bank || bank.currency !== fund.currency) throw new BadRequestException('Select an accessible bank account in the receipt/remittance currency');
    const agency = await tx.account.findFirst({ where: {
      tenantId: actor.tenantId, id: agencyAccountId, active: true, postingAllowed: true, type: AccountType.LIABILITY,
      financialResources: { some: { tenantId: actor.tenantId, companyId, type: FinancialResourceType.GL_ACCOUNT, active: true } },
    } });
    if (!agency || agency.id === bank.glAccountId) throw new BadRequestException('The AV8 student-collections account is not configured for this company');
    await this.governance.enforceAuthorityLimit(tx, actor, { companyId, branchId: fund.branchId,
      key: 'payments.payment_amount_minor', currency: fund.currency, amountMinor: fund.amountMinor });
    const base = roundDiv(BigInt(fund.amountMinor) * BigInt(fund.baseRateMicros), 1000000n);
    const incoming = fund.kind === 'RECEIPT';
    const number = await this.sequence(tx, actor, fund.branchId, incoming ? 'RECEIPT' : 'PAYMENT', fund.postingDate);
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
    const journal = await this.postedJournal(tx, actor, {
      branchId: fund.branchId, date: fund.postingDate, description: `AV8 ${fund.kind} ${number}`, module: 'AV8',
      sourceType: 'AV8_CASH', sourceId: fund.id, sourceNumber: number, currency: tenant.baseCurrency,
      lines: incoming ? [
        {code: bank.glAccount.code, debit: base, description: number}, {code: agency.code, credit: base, description: 'Student agency collections'},
      ] : [
        {code: agency.code, debit: base, description: number}, {code: bank.glAccount.code, credit: base, description: fund.kind},
      ],
    });
    const transaction = await tx.bankTransaction.create({data: {
      tenantId: actor.tenantId, branchId: fund.branchId, bankAccountId: bank.id, counterpartyAccountId: agency.id,
      kind: incoming ? BankTransactionKind.RECEIPT : BankTransactionKind.PAYMENT, number,
      postingDate: fund.postingDate, amountMinor: fund.amountMinor, reference: fund.reference,
      description: `AV8 ${fund.kind}; internal recording`, journalEntryId: journal.id, createdById: actor.userId,
    }});
    return transaction;
  }

  private assertBranch(actor: Actor, branchId: bigint) {
    if (!can(actor, 'system.super_admin') && !actor.branchIds.includes(branchId.toString())) throw new ForbiddenException('Branch is outside your access scope');
  }

  private assertWarehouse(actor: Actor, warehouseId?: bigint | null) {
    if (warehouseId && !can(actor, 'system.super_admin') && !actor.warehouseIds.includes(warehouseId.toString())) throw new ForbiddenException('Warehouse is outside your access scope');
  }

  private companyBranchEnvelope(actor: Actor) {
    return [...new Set(Object.values(actor.companyBranchIds).flat())].map(BigInt);
  }

  private companyIdForBranch(actor: Actor, branchId: bigint) {
    const companyId = companyForBranch(actor, branchId);
    if (!companyId && !can(actor, 'system.super_admin')) throw new ForbiddenException('Branch is outside your active company memberships');
    return BigInt(companyId || 0);
  }

  private requireAtBranch(actor: Actor, permission: string, branchId: bigint) {
    this.assertBranch(actor, branchId);
    const companyId = this.companyIdForBranch(actor, branchId);
    if (can(actor, 'system.super_admin')) return companyId;
    requirePermissionAtCompany(actor, permission, companyId);
    return companyId;
  }

  private branchesForPermissions(actor: Actor, permissions: readonly string[]) {
    if (permissions.some((permission) => can(actor, permission))) return this.companyBranchEnvelope(actor);
    return [...new Set(Object.entries(actor.companyBranchIds)
      .filter(([companyId]) => permissions.some((permission) => canAtCompany(actor, permission, companyId)))
      .flatMap(([, branchIds]) => branchIds))].map(BigInt);
  }

  private companiesForPermissions(actor: Actor, permissions: readonly string[]) {
    return actor.companyIds.filter((companyId) => permissions.some((permission) => canAtCompany(actor, permission, companyId))).map(BigInt);
  }

  private branchesForAllPermissions(actor: Actor, permissions: readonly string[]) {
    if (!permissions.length) return this.companyBranchEnvelope(actor);
    const scopes = permissions.map((permission) => new Set(this.branchesForPermissions(actor, [permission]).map(String)));
    return [...scopes[0]].filter((branchId) => scopes.every((scope) => scope.has(branchId))).map(BigInt);
  }

  private companiesForAllPermissions(actor: Actor, permissions: readonly string[]) {
    if (!permissions.length) return actor.companyIds.map(BigInt);
    return actor.companyIds
      .filter((companyId) => permissions.every((permission) => canAtCompany(actor, permission, companyId)))
      .map(BigInt);
  }

  private requireAny(actor: Actor, ...permissions: string[]) {
    const allowed = permissions.some((permission) => {
      const normalized = normalizePermissions([permission]);
      return actor.legacyPermissions.includes('*') || actor.legacyPermissions.includes(permission)
        || normalized.some((candidate) => can(actor, candidate)) || can(actor, permission);
    });
    if (!allowed) {
      throw new ForbiddenException(`Permission required: ${permissions[0]}`);
    }
  }

  private scope(actor: Actor, resource: string) {
    if (can(actor, 'system.super_admin')) return 'ALL';
    return actor.dataScopes.find((entry) => entry.resource === resource)?.scope || 'NONE';
  }

  private configuredResourceIds(actor: Actor, resource: string, companyId?: bigint) {
    const config = actor.dataScopes.find((entry) => entry.resource === resource)?.config as { resourceIds?: string[] } | undefined;
    const companyIds = companyId ? [companyId.toString()] : actor.companyIds;
    const governed = companyIds.flatMap((id) => actor.companyResourceAssignments[id]?.[resource] || []);
    return [...new Set([...(config?.resourceIds || []).map(String), ...governed])].filter((value) => /^\d+$/.test(value)).map(BigInt);
  }

  private resourceIdScope(actor: Actor, resource: string, companyId?: bigint) {
    const scope = this.scope(actor, resource);
    if (can(actor, 'system.super_admin')) return {};
    const companyIds = companyId ? [companyId] : actor.companyIds.map(BigInt);
    const company: any = ['bank_account', 'account'].includes(resource) ? { financialResources: { some: { companyId: { in: companyIds }, active: true } } } : {};
    if (scope === 'ALL') return company;
    if (scope === 'ASSIGNED') return { AND: [company, { id: { in: this.configuredResourceIds(actor, resource, companyId) } }] };
    return { id: -1n };
  }

  private assertResourceId(actor: Actor, resource: string, resourceId: bigint, companyId?: bigint) {
    const scope = this.scope(actor, resource);
    if (can(actor, 'system.super_admin')) return;
    if (scope === 'ALL' && !['bank_account', 'account'].includes(resource)) return;
    if (scope === 'ALL' && companyId && actor.companyIds.includes(companyId.toString())) return;
    if (scope === 'ASSIGNED' && this.configuredResourceIds(actor, resource, companyId).includes(resourceId)) return;
    throw new ForbiddenException(`${resource.replaceAll('_', ' ')} is outside your access scope`);
  }

  private teamUserScope(actor: Actor, module?: string): Prisma.UserWhereInput {
    const roleIds = actor.roleIds.map(BigInt);
    const sharedRoles: Prisma.UserWhereInput[] = roleIds.length
      ? [{ roleId: { in: roleIds } }, { additionalRoles: { some: { roleId: { in: roleIds } } } }]
      : [];
    if (module) {
      const role: Prisma.RoleWhereInput = {
        active: true,
        permissionAssignments: { some: { permission: { module, active: true } } },
      };
      sharedRoles.push({ role }, { additionalRoles: { some: { role } } });
    }
    return sharedRoles.length ? { OR: sharedRoles } : { id: -1n };
  }

  private documentResource(type: DocumentType) {
    const resources: Partial<Record<DocumentType, string>> = {
      QUOTATION: 'quotation', SALES_ORDER: 'order', DELIVERY_NOTE: 'delivery', SALES_INVOICE: 'invoice',
      SALES_RETURN: 'return', CREDIT_NOTE: 'credit_note', PURCHASE_REQUEST: 'purchase_request', PURCHASE_RFQ: 'rfq',
      PURCHASE_ORDER: 'purchase_order', GOODS_RECEIPT: 'receipt', PURCHASE_BILL: 'bill', PURCHASE_RETURN: 'purchase_return',
      WAREHOUSE_TRANSFER: 'transfer', INVENTORY_ADJUSTMENT: 'adjustment', STOCK_COUNT: 'stock_count',
    };
    return resources[type] || 'document';
  }

  private documentPermissionResource(type: DocumentType) {
    const resources: Partial<Record<DocumentType, string>> = {
      PURCHASE_REQUEST: 'request', PURCHASE_RFQ: 'rfq', PURCHASE_ORDER: 'order', GOODS_RECEIPT: 'receipt',
      PURCHASE_BILL: 'bill', PURCHASE_RETURN: 'return',
    };
    return resources[type] || this.documentResource(type);
  }

  private documentModule(type: DocumentType) {
    return SALES_TYPES.has(type) ? 'sales' : PURCHASE_TYPES.has(type) ? 'purchasing' : 'inventory';
  }

  private visibleSalesDocumentClauses(actor: Actor): Prisma.DocumentWhereInput[] {
    const types = [
      DocumentType.QUOTATION,
      DocumentType.SALES_ORDER,
      DocumentType.DELIVERY_NOTE,
      DocumentType.SALES_INVOICE,
      DocumentType.SALES_RETURN,
      DocumentType.CREDIT_NOTE,
    ];
    const clauses = types.flatMap((type) => {
      const permission = `sales.${this.documentPermissionResource(type)}.view`;
      const branchIds = this.branchesForPermissions(actor, [permission]);
      if (!can(actor, 'system.super_admin') && (!branchIds.length || this.scope(actor, this.documentResource(type)) === 'NONE')) return [];
      return [{
        AND: [
          { type },
          this.documentScope(actor, this.documentResource(type), 'sales'),
          can(actor, 'system.super_admin') ? {} : { branchId: { in: branchIds } },
        ],
      } satisfies Prisma.DocumentWhereInput];
    });
    return clauses;
  }

  private visibleSalesDocuments(actor: Actor): Prisma.DocumentWhereInput {
    const clauses = this.visibleSalesDocumentClauses(actor);
    return clauses.length ? { OR: clauses } : { id: -1n };
  }

  private requireDocumentPermission(actor: Actor, type: DocumentType, action: string, branchId?: bigint) {
    const permission = `${this.documentModule(type)}.${this.documentPermissionResource(type)}.${action}`;
    if (branchId) return this.requireAtBranch(actor, permission, branchId);
    if (!can(actor, permission)) throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: 'You do not have permission to perform this document action.', permission });
    return 0n;
  }

  private assertApprovalLimit(actor: Actor, type: DocumentType, totalMinor: bigint, subtotalMinor = 0n, discountMinor = 0n) {
    if (!can(actor, 'system.super_admin') && SALES_TYPES.has(type) && discountMinor > 0n && subtotalMinor > 0n) {
      const discountLimit = this.limit(actor, 'sales.discount_percent', 0);
      if (discountMinor * 10_000n > subtotalMinor * BigInt(Math.round(discountLimit * 100))) {
        throw new ForbiddenException(`Document discount exceeds your configured approval limit of ${discountLimit}%.`);
      }
    }
    const key = type === DocumentType.QUOTATION ? 'sales.quotation_amount_minor'
      : type === DocumentType.SALES_RETURN || type === DocumentType.CREDIT_NOTE ? 'sales.return_amount_minor'
      : type === DocumentType.SALES_ORDER || type === DocumentType.SALES_INVOICE ? 'sales.credit_amount_minor'
      : null;
    if (!key || can(actor, 'system.super_admin')) return;
    const maximum = this.limit(actor, key, 0);
    if (maximum <= 0 || totalMinor > BigInt(Math.round(maximum))) {
      throw new ForbiddenException(`Document amount exceeds your configured approval limit for ${key}.`);
    }
  }

  private documentScope(actor: Actor, resource: string, module?: string): Prisma.DocumentWhereInput {
    const scope = this.scope(actor, resource);
    const company: Prisma.DocumentWhereInput = can(actor, 'system.super_admin') ? {} : { branchId: { in: this.companyBranchEnvelope(actor) } };
    if (scope === 'ALL') return company;
    if (scope === 'NONE') return { id: -1n };
    if (scope === 'OWN') return { AND: [company, { createdById: actor.userId }] };
    if (scope === 'ASSIGNED') return { AND: [company, actor.employeeId ? { salespersonId: BigInt(actor.employeeId) } : { createdById: actor.userId }] };
    if (scope === 'WAREHOUSE') return { AND: [company, { warehouseId: { in: actor.warehouseIds.map(BigInt) } }] };
    if (scope === 'DEPARTMENT' && actor.departmentId) return { AND: [company, { salesEmployee: { departmentId: BigInt(actor.departmentId) } }] };
    if (scope === 'TEAM') {
      const configured = actor.dataScopes.find((entry) => entry.resource === resource)?.config as { userIds?: string[] } | undefined;
      return { AND: [company, configured?.userIds?.length ? { createdById: { in: configured.userIds.map(BigInt) } } : { createdBy: this.teamUserScope(actor, module) }] };
    }
    return { AND: [company, { branchId: { in: actor.branchIds.map(BigInt) } }] };
  }

  private async documentInScope(tx: Tx, actor: Actor, id: bigint, include?: Prisma.DocumentInclude): Promise<any> {
    const header = await tx.document.findUnique({ where: { id }, select: { type: true } });
    if (!header) return null;
    return tx.document.findFirst({ where: { id, ...this.documentScope(actor, this.documentResource(header.type), this.documentModule(header.type)) }, include });
  }

  private customerScope(actor: Actor): Prisma.CustomerWhereInput {
    const scope = this.scope(actor, 'customer');
    const company: Prisma.CustomerWhereInput = can(actor, 'system.super_admin') ? {} : {
      companyId: { in: actor.companyIds.map(BigInt) },
      defaultBranchId: { in: this.companyBranchEnvelope(actor) },
    };
    if (scope === 'ALL') return company;
    if (scope === 'NONE') return { id: -1n };
    if (scope === 'OWN' || scope === 'ASSIGNED') return { AND: [company, { ownerUserId: actor.userId }] };
    if (scope === 'TEAM') {
      const configured = actor.dataScopes.find((entry) => entry.resource === 'customer')?.config as { userIds?: string[] } | undefined;
      if (configured?.userIds?.length) return { AND: [company, { ownerUserId: { in: configured.userIds.map(BigInt) } }] };
      return { AND: [company, { ownerUser: this.teamUserScope(actor, 'sales') }] };
    }
    return { AND: [company, { defaultBranchId: { in: actor.branchIds.map(BigInt) } }] };
  }

  private supplierScope(actor: Actor): Prisma.SupplierWhereInput {
    if (can(actor, 'system.super_admin')) return {};
    return {
      AND: [
        { companyId: { in: actor.companyIds.map(BigInt) } },
        this.resourceIdScope(actor, 'supplier'),
      ],
    };
  }

  private inventoryItemScope(actor: Actor): Prisma.ItemWhereInput {
    if (can(actor, 'system.super_admin')) return {};
    const scope = this.scope(actor, 'item');
    if (scope === 'ALL' || scope === 'BRANCH' || scope === 'WAREHOUSE') return {};
    if (scope === 'ASSIGNED') return { id: { in: this.configuredResourceIds(actor, 'item') } };
    return { id: -1n };
  }

  private inventoryWarehouseIds(actor: Actor) {
    if (can(actor, 'system.super_admin')) return undefined;
    const scope = this.scope(actor, 'warehouse');
    const assigned = actor.warehouseIds.map(BigInt);
    if (scope === 'ALL' || scope === 'BRANCH' || scope === 'WAREHOUSE') return assigned;
    if (scope === 'ASSIGNED') {
      const configured = new Set(this.configuredResourceIds(actor, 'warehouse').map(String));
      return assigned.filter((warehouseId) => configured.has(warehouseId.toString()));
    }
    return [];
  }

  private employeeScope(actor: Actor): Prisma.EmployeeWhereInput {
    const scope = this.scope(actor, 'employee');
    const company: Prisma.EmployeeWhereInput = can(actor, 'system.super_admin') ? {} : this.companyBranchEnvelope(actor).length
      ? { OR: this.companyBranchEnvelope(actor).map((branchId) => ({ branchIds: { array_contains: [branchId.toString()] } })) }
      : { id: -1n };
    if (scope === 'ALL') return company;
    if (scope === 'NONE') return { id: -1n };
    if (scope === 'OWN' || scope === 'ASSIGNED') return { AND: [company, { userId: actor.userId }] };
    if (scope === 'DEPARTMENT') return actor.departmentId ? { AND: [company, { departmentId: BigInt(actor.departmentId) }] } : { id: -1n };
    if (scope === 'TEAM') {
      const configured = actor.dataScopes.find((entry) => entry.resource === 'employee')?.config as { userIds?: string[] } | undefined;
      if (configured?.userIds?.length) return { AND: [company, { userId: { in: configured.userIds.map(BigInt) } }] };
      return { AND: [company, { user: this.teamUserScope(actor, 'sales') }] };
    }
    return actor.branchIds.length
      ? { OR: actor.branchIds.map((branchId) => ({ branchIds: { array_contains: [branchId] } })) }
      : { id: -1n };
  }

  private journalScope(actor: Actor, resource = 'journal'): Prisma.JournalEntryWhereInput {
    const scope = this.scope(actor, resource);
    const company: Prisma.JournalEntryWhereInput = can(actor, 'system.super_admin') ? {} : { branchId: { in: this.companyBranchEnvelope(actor) } };
    if (scope === 'ALL') return company;
    if (scope === 'NONE') return { id: -1n };
    if (scope === 'OWN' || scope === 'ASSIGNED') return { AND: [company, { createdById: actor.userId }] };
    if (scope === 'TEAM') {
      const configured = actor.dataScopes.find((entry) => entry.resource === resource)?.config as { userIds?: string[] } | undefined;
      if (configured?.userIds?.length) return { AND: [company, { createdById: { in: configured.userIds.map(BigInt) } }] };
      return { AND: [company, { createdBy: this.teamUserScope(actor, 'accounting') }] };
    }
    return { AND: [company, { branchId: { in: actor.branchIds.map(BigInt) } }] };
  }

  private auditVisibilityScope(actor: Actor, companyIds: readonly bigint[], branchIds: readonly bigint[]): Prisma.AuditEventWhereInput {
    if (can(actor, 'system.super_admin')) return {};
    const memberCompanies = new Set(actor.companyIds);
    const companies = companyIds.filter((companyId) => memberCompanies.has(companyId.toString()));
    const permittedBranches = new Set(branchIds.map(String));
    const companyBranchPairs: Prisma.AuditEventWhereInput[] = companies.flatMap((companyId) => {
      const branches = (actor.companyBranchIds[companyId.toString()] || [])
        .filter((branchId) => permittedBranches.has(branchId))
        .map(BigInt);
      return branches.length ? [{ AND: [
        { companyId: companyId.toString() },
        { branchId: { in: branches } },
      ] }] : [];
    });
    return companyBranchPairs.length ? { OR: companyBranchPairs } : { id: -1n };
  }

  private posShiftDataScope(actor: Actor, resource: 'report' | 'pos_terminal'): Prisma.PosShiftWhereInput {
    if (can(actor, 'system.super_admin')) return {};
    const base: Prisma.PosShiftWhereInput = {
      branchId: { in: this.companyBranchEnvelope(actor) },
      warehouseId: { in: actor.warehouseIds.map(BigInt) },
    };
    const scope = this.scope(actor, resource);
    if (scope === 'ALL' || scope === 'BRANCH' || scope === 'WAREHOUSE') return base;
    if (scope === 'NONE' || scope === 'DEPARTMENT') return { id: -1n };
    if (scope === 'OWN' || (scope === 'ASSIGNED' && resource === 'report')) {
      return { AND: [base, { openedById: actor.userId }] };
    }
    if (scope === 'ASSIGNED') {
      return { AND: [base, { id: { in: this.configuredResourceIds(actor, resource) } }] };
    }
    if (scope === 'TEAM') {
      const configured = actor.dataScopes.find((entry) => entry.resource === resource)?.config as { userIds?: string[] } | undefined;
      return {
        AND: [
          base,
          configured?.userIds?.length
            ? { openedById: { in: configured.userIds.map(BigInt) } }
            : { openedBy: this.teamUserScope(actor, 'pos') },
        ],
      };
    }
    return { id: -1n };
  }

  private paymentScope(actor: Actor): Prisma.PaymentWhereInput {
    const scope = this.scope(actor, 'payment');
    const company: Prisma.PaymentWhereInput = can(actor, 'system.super_admin') ? {} : { branchId: { in: this.companyBranchEnvelope(actor) } };
    if (scope === 'ALL') return company;
    if (scope === 'NONE') return { id: -1n };
    if (scope === 'OWN' || scope === 'ASSIGNED') return { AND: [company, { createdById: actor.userId }] };
    if (scope === 'TEAM') {
      const configured = actor.dataScopes.find((entry) => entry.resource === 'payment')?.config as { userIds?: string[] } | undefined;
      if (configured?.userIds?.length) return { AND: [company, { createdById: { in: configured.userIds.map(BigInt) } }] };
      return { AND: [company, { createdBy: this.teamUserScope(actor, 'payments') }] };
    }
    return { AND: [company, { branchId: { in: actor.branchIds.map(BigInt) } }] };
  }

  private journalMutationScope(actor: Actor, permission: string): Prisma.JournalEntryWhereInput {
    const branchIds = this.branchesForPermissions(actor, [permission]);
    if (!can(actor, 'system.super_admin') && !branchIds.length) requirePermission(actor, permission);
    return {
      AND: [
        this.journalScope(actor),
        can(actor, 'system.super_admin') ? {} : { branchId: { in: branchIds } },
      ],
    };
  }

  private fieldAccess(actor: Actor, resource: string, field: string) {
    return fieldAccess(actor, resource, field);
  }

  private requireFieldEdit(actor: Actor, resource: string, field: string, label: string) {
    if (this.fieldAccess(actor, resource, field) !== 'EDIT') {
      throw new ForbiddenException(`${label} is read-only for your role.`);
    }
  }

  private requireFieldView(actor: Actor, resource: string, field: string, label: string) {
    const legacyJournalViewer = resource === 'journal' && field === 'lines'
      && actor.legacyPermissions.includes('invoices.view-accounting');
    if (this.fieldAccess(actor, resource, field) === 'HIDDEN' && !legacyJournalViewer) {
      throw new ForbiddenException(`${label} is hidden for your role.`);
    }
  }

  private limit(actor: Actor, key: string, fallback: number) {
    const configured: any = actor.limits[key];
    const value = Number(configured && typeof configured === 'object' && 'value' in configured ? configured.value : configured);
    return Number.isFinite(value) ? value : fallback;
  }

  private customerForActor(actor: Actor, customer: any) {
    return projectRecord(actor, 'customer', customer);
  }

  private itemForActor(actor: Actor, item: any) {
    return projectRecord(actor, 'item', item);
  }

  private supplierForActor(actor: Actor, supplier: any) {
    return projectRecord(actor, 'supplier', supplier);
  }

  private bankAccountForActor(actor: Actor, account: any) {
    return projectRecord(actor, 'bankAccount', account);
  }

  private employeeForActor(actor: Actor, employee: any) {
    return projectRecord(actor, 'employee', employee);
  }

  private documentForActor(actor: Actor, document: any) {
    return projectRecord(actor, 'document', document);
  }

  private journalForActor(actor: Actor, journal: any) { return projectRecord(actor, 'journal', journal); }
  private paymentForActor(actor: Actor, payment: any) { return projectRecord(actor, 'payment', payment); }
  private auditForActor(actor: Actor, audit: any) { return projectRecord(actor, 'audit', audit); }
  private posSaleForActor(actor: Actor, sale: any) {
    const visible: any = {
      ...sale,
      customer: sale.customer ? this.customerForActor(actor, sale.customer) : sale.customer,
      journalEntry: sale.journalEntry ? this.journalForActor(actor, sale.journalEntry) : sale.journalEntry,
      lines: Array.isArray(sale.lines) ? sale.lines.map((line: any) => ({ ...line, item: line.item ? this.itemForActor(actor, line.item) : line.item })) : sale.lines,
    };
    if (this.fieldAccess(actor, 'document', 'costMinor') === 'HIDDEN') {
      delete visible.costMinor;
      if (Array.isArray(visible.lines)) visible.lines = visible.lines.map((line: any) => { const copy = { ...line }; delete copy.costMinor; return copy; });
    }
    return visible;
  }

  private async assertBranchWarehouse(tx: Tx, actor: Actor, branchId: bigint, warehouseId?: bigint | null) {
    this.assertBranch(actor, branchId);
    this.assertWarehouse(actor, warehouseId);
    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new BadRequestException('The selected branch is not available.');
    if (!warehouseId) return;
    const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse || !warehouse.active || warehouse.branchId !== branchId) {
      throw new BadRequestException(`The selected warehouse is not available for the ${branch.name} branch.`);
    }
  }

  private date(value: unknown, field = 'date') {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException(`${field} must use YYYY-MM-DD`);
    const date = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(date.valueOf())) throw new BadRequestException(`${field} is invalid`);
    return date;
  }

  private async audit(tx: Tx, actor: Actor, action: string, entityType: string, entityId: bigint | string, details: Record<string, unknown> = {}, previousValues?: Record<string, unknown>) {
    let branchId: bigint | null = null;
    const numericId = /^\d+$/.test(entityId.toString()) ? BigInt(entityId) : null;
    if (numericId && entityType === 'DOCUMENT') branchId = (await tx.document.findUnique({ where: { id: numericId }, select: { branchId: true } }))?.branchId || null;
    else if (numericId && entityType === 'CUSTOMER') branchId = (await tx.customer.findUnique({ where: { id: numericId }, select: { defaultBranchId: true } }))?.defaultBranchId || null;
    else if (numericId && entityType === 'JOURNAL') branchId = (await tx.journalEntry.findUnique({ where: { id: numericId }, select: { branchId: true } }))?.branchId || null;
    else if (numericId && entityType === 'PAYMENT') branchId = (await tx.payment.findUnique({ where: { id: numericId }, select: { branchId: true } }))?.branchId || null;
    else if (numericId && entityType === 'BANK_TRANSACTION') branchId = (await tx.bankTransaction.findUnique({ where: { id: numericId }, select: { branchId: true } }))?.branchId || null;
    else if (numericId && entityType === 'POS_SHIFT') branchId = (await tx.posShift.findUnique({ where: { id: numericId }, select: { branchId: true } }))?.branchId || null;
    else if (numericId && entityType === 'POS_SALE') branchId = (await tx.posSale.findUnique({ where: { id: numericId }, select: { shift: { select: { branchId: true } } } }))?.shift.branchId || null;
    const companyId = branchId ? companyForBranch(actor, branchId) || (await tx.companyBranch.findUnique({ where: { branchId }, select: { companyId: true } }))?.companyId.toString() : undefined;
    await tx.auditEvent.create({ data: {
      tenantId: actor.tenantId, userId: actor.userId, action, entityType, entityId: entityId.toString(),
      companyId, branchId,
      previousValues: previousValues as Prisma.InputJsonValue | undefined,
      newValues: details as Prisma.InputJsonValue,
      postingReference: typeof details.postingReference === 'string' ? details.postingReference : null,
      approvalReference: typeof details.approvalReference === 'string' ? details.approvalReference : null,
    } });
  }

  private async sequence(tx: Tx, actor: Actor, branchId: bigint, type: string, date: Date) {
    const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { code: true } });
    if (!branch) throw new BadRequestException('Branch is invalid');
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
      INSERT INTO document_sequences (tenant_id, branch_id, document_type, fiscal_year, next_value)
      VALUES (${actor.tenantId}, ${branchId}, ${type}, ${date.getUTCFullYear()}, 2)
      ON CONFLICT (tenant_id, branch_id, document_type, fiscal_year)
      DO UPDATE SET next_value = document_sequences.next_value + 1
      RETURNING next_value - 1 AS value`;
    const prefix: Record<string, string> = {
      QUOTATION: 'QT', SALES_ORDER: 'SO', DELIVERY_NOTE: 'DN', SALES_INVOICE: 'SI', SALES_RETURN: 'SR', CREDIT_NOTE: 'CN',
      PURCHASE_REQUEST: 'PR', PURCHASE_RFQ: 'RFQ', PURCHASE_ORDER: 'PO', GOODS_RECEIPT: 'GR', PURCHASE_BILL: 'PB', PURCHASE_RETURN: 'RT',
      WAREHOUSE_TRANSFER: 'WT', INVENTORY_ADJUSTMENT: 'IA', STOCK_COUNT: 'SC', JOURNAL: 'JE', RECEIPT: 'RC', PAYMENT: 'PY',
      POS: 'PS', POS_RETURN: 'PX', BANK: 'BT', SHIFT: 'SH',
    };
    return `${prefix[type] || type.slice(0, 3)}-${branch.code}-${date.getUTCFullYear()}-${rows[0].value.toString().padStart(5, '0')}`;
  }

  private async customerCode(tx: Tx, actor: Actor) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { customerCodePrefix: true } });
    const prefix = tenant.customerCodePrefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'CUS';
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
      INSERT INTO master_sequences (tenant_id, key, prefix, next_value)
      VALUES (${actor.tenantId}, 'CUSTOMER', ${prefix}, 2)
      ON CONFLICT (tenant_id, key)
      DO UPDATE SET next_value = master_sequences.next_value + 1, prefix = EXCLUDED.prefix
      RETURNING next_value - 1 AS value`;
    return `${prefix}-${rows[0].value.toString().padStart(6, '0')}`;
  }

  private async assertOpenPeriod(tx: Tx, actor: Actor, postingDate: Date) {
    const period = await tx.fiscalPeriod.findFirst({ where: { tenantId: actor.tenantId, startDate: { lte: postingDate }, endDate: { gte: postingDate } } });
    if (!period) throw new BadRequestException('No fiscal period covers this posting date');
    if (period.status !== 'OPEN') throw new BadRequestException(`Fiscal period ${period.name} is ${period.status}`);
  }

  private async postedJournal(tx: Tx, actor: Actor, input: {
    branchId: bigint; date: Date; description: string; module: string; sourceType: string; sourceId: bigint; sourceNumber: string; lines: JournalLineInput[]; currency?: string;
  }) {
    await this.assertOpenPeriod(tx, actor, input.date);
    const debit = input.lines.reduce((sum, line) => sum + (line.debit || 0n), 0n);
    const credit = input.lines.reduce((sum, line) => sum + (line.credit || 0n), 0n);
    if (input.lines.length < 2 || debit <= 0n || debit !== credit) throw new BadRequestException(`Journal is unbalanced: ${debit} / ${credit}`);
    const codes = [...new Set(input.lines.map((line) => line.code))];
    const companyId = this.companyIdForBranch(actor, input.branchId);
    const resources = await tx.financialResource.findMany({ where: { companyId, type: FinancialResourceType.GL_ACCOUNT, code: { in: codes }, active: true, linkedAccount: { active: true } }, include: { linkedAccount: true } });
    const map = new Map(resources.map((resource) => [resource.code, resource.linkedAccount!]));
    for (const code of codes) if (!map.get(code)?.postingAllowed) throw new BadRequestException(`Account ${code} is unavailable for posting`);
    const number = await this.sequence(tx, actor, input.branchId, 'JOURNAL', input.date);
    const journal = await tx.journalEntry.create({ data: {
      tenantId: actor.tenantId, branchId: input.branchId, number, postingDate: input.date,
      description: input.description, status: JournalStatus.DRAFT, sourceModule: input.module, currency: input.currency,
      sourceType: input.sourceType, sourceId: input.sourceId, sourceNumber: input.sourceNumber,
      createdById: actor.userId, submittedById: actor.userId, approvedById: actor.userId, postedById: actor.userId,
      submittedAt: new Date(), approvedAt: new Date(), postedAt: new Date(),
      lines: { create: input.lines.map((line) => ({
        tenantId: actor.tenantId, accountId: map.get(line.code)!.id, description: line.description,
        debitMinor: line.debit || 0n, creditMinor: line.credit || 0n,
      })) },
    } });
    await tx.journalEntry.update({ where: { id: journal.id }, data: { status: JournalStatus.POSTED } });
    return { ...journal, status: JournalStatus.POSTED };
  }

  private async stock(tx: Tx, actor: Actor, input: {
    branchId: bigint; warehouseId: bigint; itemId: bigint; qtyMilli: bigint; direction: 'IN' | 'OUT'; unitCostMinor?: bigint;
    date: Date; sourceType: string; sourceId: bigint; sourceNumber: string;
  }) {
    const current = await tx.stockBalance.findUnique({ where: { tenantId_warehouseId_itemId: {
      tenantId: actor.tenantId, warehouseId: input.warehouseId, itemId: input.itemId,
    } } });
    const beforeQty = current?.quantityMilli || 0n;
    const beforeValue = current?.valueMinor || 0n;
    if (input.qtyMilli <= 0n) throw new BadRequestException('Stock quantity must be greater than zero');
    let cost = input.unitCostMinor || 0n;
    let total = roundDiv(input.qtyMilli * cost, 1000n);
    if (input.direction === 'OUT') {
      if (beforeQty < input.qtyMilli) throw new BadRequestException('Insufficient stock; negative inventory is disabled');
      cost = beforeQty === 0n ? 0n : roundDiv(beforeValue * 1000n, beforeQty);
      total = input.qtyMilli === beforeQty ? beforeValue : roundDiv(input.qtyMilli * cost, 1000n);
    }
    const afterQty = input.direction === 'IN' ? beforeQty + input.qtyMilli : beforeQty - input.qtyMilli;
    const afterValue = input.direction === 'IN' ? beforeValue + total : beforeValue - total;
    await tx.stockBalance.upsert({
      where: { tenantId_warehouseId_itemId: { tenantId: actor.tenantId, warehouseId: input.warehouseId, itemId: input.itemId } },
      create: { tenantId: actor.tenantId, warehouseId: input.warehouseId, itemId: input.itemId, quantityMilli: afterQty, valueMinor: afterValue },
      update: { quantityMilli: afterQty, valueMinor: afterValue },
    });
    await tx.stockMovement.create({ data: {
      tenantId: actor.tenantId, branchId: input.branchId, warehouseId: input.warehouseId, itemId: input.itemId,
      postingDate: input.date, quantityInMilli: input.direction === 'IN' ? input.qtyMilli : 0n,
      quantityOutMilli: input.direction === 'OUT' ? input.qtyMilli : 0n, unitCostMinor: cost, totalCostMinor: total,
      runningQuantityMilli: afterQty, runningValueMinor: afterValue, sourceType: input.sourceType,
      sourceId: input.sourceId, sourceNumber: input.sourceNumber, createdById: actor.userId,
    } });
    return { unitCostMinor: cost, totalCostMinor: total, afterQty, afterValue };
  }

  async bootstrap(actor: Actor) {
    const customerCompanies = this.companiesForPermissions(actor, ['sales.customer.view']);
    const supplierCompanies = this.companiesForPermissions(actor, ['purchasing.supplier.view']);
    const itemCompanies = this.companiesForPermissions(actor, ['inventory.item.view', 'sales.quotation.create', 'purchasing.order.create']);
    const bankCompanies = this.companiesForPermissions(actor, ['banking.account.view', 'payments.receipt.create', 'payments.payment.create']);
    const accountCompanies = this.companiesForPermissions(actor, ['accounting.account.view']);
    const accountingCompanies = this.companiesForPermissions(actor, ['accounting.account.view', 'accounting.journal.view', 'accounting.overview.view']);
    const salesEmployeeBranches = this.branchesForPermissions(actor, ['hr.employee.view', 'sales.quotation.view', 'sales.quotation.create']);
    const periodCompanies = this.companiesForPermissions(actor, ['accounting.period.view']);
    const hrCompanies = this.companiesForPermissions(actor, ['hr.employee.view']);
    return this.withTenant(actor, async (tx) => {
      const items = itemCompanies.length
        ? await tx.item.findMany({ where: { active: true }, include: { category: true, uom: true }, orderBy: { sku: 'asc' } }) : [];
      const bankAccounts = bankCompanies.length
        ? await tx.bankAccount.findMany({ where: { active: true, AND: [this.resourceIdScope(actor, 'bank_account'), { financialResources: { some: { companyId: { in: bankCompanies }, active: true } } }] }, orderBy: { code: 'asc' } }) : [];
      const salesEmployees = salesEmployeeBranches.length
        ? await tx.employee.findMany({ where: { active: true, AND: [this.employeeScope(actor), { OR: [{ salesEligible: true }, { department: { code: 'SALES' } }] }] }, include: { department: true }, orderBy: { name: 'asc' } }) : [];
      return {
      tenant: await tx.tenant.findUnique({ where: { id: actor.tenantId } }),
      companies: accountingCompanies.length ? (await tx.company.findMany({ where: { id: { in: accountingCompanies }, active: true }, select: { id: true, name: true, baseCurrency: true }, orderBy: { name: 'asc' } })).map((company) => ({ ...company, branchIds: actor.companyBranchIds[company.id.toString()] || [] })) : [],
      branches: await tx.branch.findMany({ where: can(actor, 'system.super_admin') ? {} : { id: { in: actor.branchIds.map(BigInt) } }, orderBy: { code: 'asc' } }),
      warehouses: await tx.warehouse.findMany({ where: { active: true, ...(can(actor, 'system.super_admin') ? {} : { id: { in: actor.warehouseIds.map(BigInt) } }) }, orderBy: { code: 'asc' } }),
      customers: customerCompanies.length ? (await tx.customer.findMany({ where: {
        active: true,
        AND: [this.customerScope(actor), { companyId: { in: customerCompanies } }],
      }, orderBy: { code: 'asc' } })).map((customer) => this.customerForActor(actor, customer)) : [],
      suppliers: supplierCompanies.length ? (await tx.supplier.findMany({ where: { active: true, companyId: { in: supplierCompanies }, ...this.resourceIdScope(actor, 'supplier') }, orderBy: { code: 'asc' } })).map((supplier) => this.supplierForActor(actor, supplier)) : [],
      categories: items.length ? await tx.itemCategory.findMany({ orderBy: { code: 'asc' } }) : [],
      units: items.length ? await tx.unitOfMeasure.findMany({ orderBy: { code: 'asc' } }) : [],
      items: items.map((item) => this.itemForActor(actor, item)),
      accounts: accountCompanies.length ? await tx.account.findMany({ where: { active: true, AND: [this.resourceIdScope(actor, 'account'), { financialResources: { some: { companyId: { in: accountCompanies }, active: true } } }] }, orderBy: { code: 'asc' } }) : [],
      bankAccounts: bankAccounts.map((account) => this.bankAccountForActor(actor, account)),
      periods: periodCompanies.length ? await tx.fiscalPeriod.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] }) : [],
      departments: hrCompanies.length ? await tx.department.findMany({ where: { active: true }, orderBy: { code: 'asc' } }) : [],
      salesEmployees: salesEmployees.filter((employee) => (employee.branchIds as string[]).some((branchId) => salesEmployeeBranches.some((candidate) => candidate.toString() === branchId))).map((employee) => this.employeeForActor(actor, employee)),
      currencies: await tx.currency.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
      documentTypes: Object.values(DocumentType),
      };
    });
  }

  private requiredText(value: unknown, field: string) {
    const text = String(value || '').trim();
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private async masterCreate<T>(actor: Actor, entityType: string, create: (tx: Tx) => Promise<T>) {
    try {
      return await this.withTenant(actor, async (tx) => {
        const result: any = await create(tx);
        await this.audit(tx, actor, 'CREATE', entityType, result.id, { code: result.code, name: result.name });
        return result;
      });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new BadRequestException(`${entityType.toLowerCase().replaceAll('_', ' ')} code, SKU, or barcode already exists`);
      throw error;
    }
  }

  async createCustomer(actor: Actor, body: any) {
    const legacyCreditEditor = actor.legacyPermissions.includes('customers.edit-credit');
    if (((body.creditLimit !== '' && body.creditLimit !== null && body.creditLimit !== undefined) || body.creditHold === true)
      && this.fieldAccess(actor, 'customer', 'creditLimitMinor') !== 'EDIT' && !legacyCreditEditor) throw new ForbiddenException('Credit limit controls are read-only for your role.');
    if (body.paymentTermsDays !== '' && body.paymentTermsDays !== null && body.paymentTermsDays !== undefined
      && this.fieldAccess(actor, 'customer', 'paymentTermsDays') !== 'EDIT' && !legacyCreditEditor) throw new ForbiddenException('Payment terms are read-only for your role.');
    if ((body.taxNumber || body.registrationNumber) && this.fieldAccess(actor, 'party', 'taxNumber') !== 'EDIT') throw new ForbiddenException('Tax information is read-only for your role.');
    return this.masterCreate(actor, 'CUSTOMER', async (tx) => {
      const defaultBranchId = body.defaultBranchId ? BigInt(body.defaultBranchId) : null;
      if (!defaultBranchId) throw new BadRequestException('A company branch is required for the customer.');
      let companyId = body.companyId ? BigInt(body.companyId) : actor.companyIds.length === 1 ? BigInt(actor.companyIds[0]) : null;
      if (defaultBranchId) {
        this.assertBranch(actor, defaultBranchId);
        const link = await tx.companyBranch.findFirst({ where: { branchId: defaultBranchId, active: true } });
        if (!link) throw new BadRequestException('The selected default branch is not available.');
        if (companyId && companyId !== link.companyId) throw new BadRequestException('Customer company and default branch do not match.');
        companyId = link.companyId;
      }
      if (!companyId || !actor.companyIds.includes(companyId.toString())) throw new BadRequestException('Select an active company for the customer.');
      requirePermissionAtCompany(actor, 'sales.customer.create', companyId);
      const defaultCurrency = body.defaultCurrency ? String(body.defaultCurrency).toUpperCase() : null;
      if (defaultCurrency && !await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: defaultCurrency } } })) {
        throw new BadRequestException('The selected default currency is not registered.');
      }
      const paymentTermsDays = body.paymentTermsDays === '' || body.paymentTermsDays === null || body.paymentTermsDays === undefined
        ? null
        : Number(body.paymentTermsDays);
      if (paymentTermsDays !== null && (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650)) {
        throw new BadRequestException('Payment terms must be a whole number of days.');
      }
      const creditLimitMinor = body.creditLimit === '' || body.creditLimit === null || body.creditLimit === undefined
        ? null
        : money(body.creditLimit, 'credit limit');
      if (creditLimitMinor !== null && creditLimitMinor < 0n) throw new BadRequestException('Credit limit cannot be negative.');
      const code = await this.customerCode(tx, actor);
      return tx.customer.create({ data: {
        tenantId: actor.tenantId,
        companyId,
        code,
        name: this.requiredText(body.name, 'Customer name'),
        customerType: String(body.customerType || 'BUSINESS'),
        taxNumber: body.taxNumber || null,
        registrationNumber: body.registrationNumber || null,
        email: body.email || null,
        phone: body.phone || null,
        address: body.billingAddress || body.address || null,
        billingAddress: body.billingAddress || body.address || null,
        shippingAddress: body.shippingAddress || null,
        city: this.requiredText(body.city, 'City'),
        defaultBranchId,
        ownerUserId: actor.userId,
        creditLimitMinor,
        paymentTermsDays,
        defaultCurrency,
        taxTreatment: String(body.taxTreatment || 'STANDARD'),
        creditHold: Boolean(body.creditHold),
      } });
    });
  }

  async listCustomers(actor: Actor, query: any = {}) {
    const permittedCompanies = this.companiesForPermissions(actor, ['sales.customer.view']);
    if (!permittedCompanies.length) requirePermission(actor, 'sales.customer.view');
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize || 20)));
    const search = String(query.search || '').trim();
    if (query.branchId) this.assertBranch(actor, BigInt(query.branchId));
    return this.withTenant(actor, async (tx) => {
      const where: Prisma.CustomerWhereInput = {
        ...(String(query.status || 'ACTIVE') === 'ALL' ? {} : { active: String(query.status || 'ACTIVE') === 'ACTIVE' }),
        AND: [this.customerScope(actor), { companyId: { in: permittedCompanies } }, ...(query.branchId ? [{ defaultBranchId: BigInt(query.branchId) }] : [])],
        ...(search ? { OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          ...(this.fieldAccess(actor, 'party', 'taxNumber') === 'HIDDEN' ? [] : [{ taxNumber: { contains: search, mode: 'insensitive' as const } }]),
        ] } : {}),
      };
      const [total, customers] = await Promise.all([
        tx.customer.count({ where }),
        tx.customer.findMany({ where, include: { defaultBranch: true }, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      const ids = customers.map((customer) => customer.id);
      const receivableBranches = can(actor, 'system.super_admin') ? undefined : this.branchesForAllPermissions(actor, ['sales.customer.view', 'sales.invoice.view']);
      const canReadBalances = this.fieldAccess(actor, 'customer', 'balanceMinor') !== 'HIDDEN'
        && (can(actor, 'system.super_admin') || (Boolean(receivableBranches?.length) && this.scope(actor, 'invoice') !== 'NONE'));
      const outstanding = canReadBalances
        ? await this.receivables.customerBalances(tx, ids, receivableBranches, this.documentScope(actor, 'invoice', 'sales'))
        : new Map<string, bigint>();
      return {
        rows: customers.map((customer) => this.customerForActor(actor, {
          ...customer,
          ...(canReadBalances ? { outstandingMinor: outstanding.get(customer.id.toString()) || 0n } : {}),
        })),
        pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      };
    });
  }

  async customerDetail(actor: Actor, customerId: bigint) {
    const permittedCompanies = this.companiesForPermissions(actor, ['sales.customer.view']);
    if (!permittedCompanies.length) requirePermission(actor, 'sales.customer.view');
    return this.withTenant(actor, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, companyId: { in: permittedCompanies }, ...this.customerScope(actor) },
        include: { defaultBranch: true },
      });
      if (!customer) throw new NotFoundException('Customer not found');
      if (!customer.companyId) throw new ForbiddenException('Customer company ownership is missing.');
      if (customer.defaultBranchId) this.assertBranch(actor, customer.defaultBranchId);
      const documentClauses = this.visibleSalesDocumentClauses(actor);
      const canReadDocuments = can(actor, 'system.super_admin') || documentClauses.length > 0;
      const receiptBranches = can(actor, 'system.super_admin') ? undefined : this.branchesForPermissions(actor, ['payments.receipt.view']);
      const canReadPayments = can(actor, 'system.super_admin') || Boolean(
        receiptBranches?.length
        && this.scope(actor, 'payment') !== 'NONE'
        && this.scope(actor, 'bank_account') !== 'NONE',
      );
      const paymentScope: Prisma.PaymentWhereInput = can(actor, 'system.super_admin') ? {} : canReadPayments ? {
        AND: [
          this.paymentScope(actor),
          { branchId: { in: receiptBranches } },
          { bankAccount: this.resourceIdScope(actor, 'bank_account', customer.companyId) },
        ],
      } : { id: -1n };
      const receivableBranches = can(actor, 'system.super_admin') ? undefined : this.branchesForAllPermissions(actor, ['sales.customer.view', 'sales.invoice.view']);
      const canReadReceivables = this.fieldAccess(actor, 'customer', 'balanceMinor') !== 'HIDDEN'
        && (can(actor, 'system.super_admin') || (Boolean(receivableBranches?.length) && this.scope(actor, 'invoice') !== 'NONE'));
      const receivableScope = this.documentScope(actor, 'invoice', 'sales');
      const auditBranches = can(actor, 'system.super_admin') ? undefined : this.branchesForPermissions(actor, ['audit.business.view']);
      const customerAuditBranch = customer.defaultBranchId || null;
      const canReadAudit = can(actor, 'system.super_admin') || Boolean(
        canAtCompany(actor, 'audit.business.view', customer.companyId)
        && customerAuditBranch
        && auditBranches?.some((branchId) => branchId === customerAuditBranch),
      );
      const [rawDocuments, payments, balances, statement, ageing, audit] = await Promise.all([
        canReadDocuments
          ? tx.document.findMany({ where: { customerId, OR: documentClauses }, include: { branch: true, salesEmployee: true }, orderBy: { createdAt: 'desc' }, take: 50 })
          : Promise.resolve([]),
        canReadPayments
          ? tx.payment.findMany({ where: { customerId, kind: PaymentKind.RECEIPT, AND: [paymentScope] }, include: { bankAccount: true, journalEntry: true, allocations: true }, orderBy: { createdAt: 'desc' }, take: 30 })
          : Promise.resolve([]),
        canReadReceivables ? this.receivables.customerBalances(tx, [customerId], receivableBranches, receivableScope) : Promise.resolve(new Map<string, bigint>()),
        canReadReceivables ? this.receivables.customerStatement(tx, {
          customerId,
          branchIds: receivableBranches,
          documentScope: receivableScope,
          allocationDocumentScope: receivableScope,
          paymentScope,
        }) : Promise.resolve(undefined),
        canReadReceivables ? this.receivables.ageing(tx, { customerId, branchIds: receivableBranches, documentScope: receivableScope }) : Promise.resolve(undefined),
        canReadAudit ? tx.auditEvent.findMany({ where: {
          entityType: 'CUSTOMER',
          entityId: customerId.toString(),
          companyId: customer.companyId.toString(),
          ...(customerAuditBranch ? { branchId: customerAuditBranch } : { branchId: null }),
        }, include: { user: publicUser }, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
      ]);
      const documents = await this.receivables.decorateInvoices(tx, rawDocuments);
      const visiblePayments = canReadPayments
        ? await Promise.all(payments.map((payment) => this.paymentWithVisibleDocuments(tx, actor, payment)))
        : [];
      return this.customerForActor(actor, {
        ...customer,
        ...(canReadDocuments ? { documents: documents.map((document) => this.documentForActor(actor, document)) } : {}),
        ...(canReadPayments ? { payments: visiblePayments } : {}),
        ...(canReadReceivables ? {
          outstandingMinor: balances.get(customerId.toString()) || 0n,
          statement,
          ageing,
        } : {}),
        ...(canReadAudit ? { audit: audit.map((entry) => this.auditForActor(actor, entry)) } : {}),
      });
    });
  }

  async updateCustomer(actor: Actor, customerId: bigint, body: any) {
    const permittedCompanies = this.companiesForPermissions(actor, ['sales.customer.edit']);
    if (!permittedCompanies.length) requirePermission(actor, 'sales.customer.edit');
    return this.withTenant(actor, async (tx) => {
      const current = await tx.customer.findFirst({ where: { id: customerId, companyId: { in: permittedCompanies }, ...this.customerScope(actor) } });
      if (!current) throw new NotFoundException('Customer not found');
      if (!current.companyId) throw new ForbiddenException('Customer company ownership is missing.');
      requirePermissionAtCompany(actor, 'sales.customer.edit', current.companyId);
      const legacyCreditEditor = actor.legacyPermissions.includes('customers.edit-credit');
      if ((body.creditLimit !== undefined || body.creditHold !== undefined) && this.fieldAccess(actor, 'customer', 'creditLimitMinor') !== 'EDIT' && !legacyCreditEditor) throw new ForbiddenException('Credit limit controls are read-only for your role.');
      if (body.paymentTermsDays !== undefined && this.fieldAccess(actor, 'customer', 'paymentTermsDays') !== 'EDIT' && !legacyCreditEditor) throw new ForbiddenException('Payment terms are read-only for your role.');
      if ((body.taxNumber !== undefined || body.registrationNumber !== undefined) && this.fieldAccess(actor, 'party', 'taxNumber') !== 'EDIT') throw new ForbiddenException('Tax information is read-only for your role.');
      const creditLimitMinor = body.creditLimit === undefined ? current.creditLimitMinor
        : body.creditLimit === '' || body.creditLimit === null ? null : money(body.creditLimit, 'credit limit');
      const paymentTermsDays = body.paymentTermsDays === undefined ? current.paymentTermsDays
        : body.paymentTermsDays === '' || body.paymentTermsDays === null ? null : Number(body.paymentTermsDays);
      const defaultBranchId = body.defaultBranchId === undefined ? current.defaultBranchId
        : body.defaultBranchId ? BigInt(body.defaultBranchId) : null;
      if (defaultBranchId) {
        this.assertBranch(actor, defaultBranchId);
        if (!await tx.companyBranch.findFirst({ where: { branchId: defaultBranchId, companyId: current.companyId, active: true } })) throw new BadRequestException('The selected default branch is not available for the customer company.');
      }
      const defaultCurrency = body.defaultCurrency === undefined ? current.defaultCurrency
        : body.defaultCurrency ? String(body.defaultCurrency).toUpperCase() : null;
      if (defaultCurrency && !await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: defaultCurrency } } })) {
        throw new BadRequestException('The selected default currency is not registered.');
      }
      if (creditLimitMinor !== null && creditLimitMinor < 0n) throw new BadRequestException('Credit limit cannot be negative.');
      if (paymentTermsDays !== null && (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650)) throw new BadRequestException('Payment terms must be a whole number of days.');
      const updated = await tx.customer.update({ where: { id: customerId }, data: {
        name: body.name === undefined ? current.name : this.requiredText(body.name, 'Customer name'),
        customerType: body.customerType ?? current.customerType,
        taxNumber: body.taxNumber === undefined ? current.taxNumber : body.taxNumber || null,
        registrationNumber: body.registrationNumber === undefined ? current.registrationNumber : body.registrationNumber || null,
        email: body.email === undefined ? current.email : body.email || null,
        phone: body.phone === undefined ? current.phone : body.phone || null,
        city: body.city === undefined ? current.city : this.requiredText(body.city, 'City'),
        billingAddress: body.billingAddress === undefined ? current.billingAddress : body.billingAddress || null,
        shippingAddress: body.shippingAddress === undefined ? current.shippingAddress : body.shippingAddress || null,
        defaultBranchId,
        creditLimitMinor,
        paymentTermsDays,
        defaultCurrency,
        taxTreatment: body.taxTreatment ?? current.taxTreatment,
        creditHold: body.creditHold === undefined ? current.creditHold : Boolean(body.creditHold),
        active: body.active === undefined ? current.active : Boolean(body.active),
      } });
      await this.audit(tx, actor, 'UPDATE', 'CUSTOMER', customerId, {
        name: updated.name,
        creditLimitMinor: updated.creditLimitMinor?.toString() ?? null,
        paymentTermsDays: updated.paymentTermsDays,
        creditHold: updated.creditHold,
      }, {
        name: current.name,
        creditLimitMinor: current.creditLimitMinor?.toString() ?? null,
        paymentTermsDays: current.paymentTermsDays,
        creditHold: current.creditHold,
      });
      return this.customerForActor(actor, updated);
    });
  }

  async createSupplier(actor: Actor, body: any) {
    if ((body.taxNumber || body.registrationNumber) && this.fieldAccess(actor, 'party', 'taxNumber') !== 'EDIT') throw new ForbiddenException('Tax information is read-only for your role.');
    return this.masterCreate(actor, 'SUPPLIER', async (tx) => {
      let companyId = body.companyId ? BigInt(body.companyId) : actor.companyIds.length === 1 ? BigInt(actor.companyIds[0]) : null;
      if (body.branchId) {
        const branchId = BigInt(body.branchId); this.assertBranch(actor, branchId);
        const link = await tx.companyBranch.findFirst({ where: { branchId, active: true } });
        if (!link || companyId && companyId !== link.companyId) throw new BadRequestException('Supplier company and branch do not match.');
        companyId = link.companyId;
      }
      if (!companyId || !actor.companyIds.includes(companyId.toString())) throw new BadRequestException('Select an active company for the supplier.');
      requirePermissionAtCompany(actor, 'purchasing.supplier.create', companyId);
      return tx.supplier.create({ data: {
        tenantId: actor.tenantId, companyId, code: this.requiredText(body.code, 'Supplier code').toUpperCase(), name: this.requiredText(body.name, 'Supplier name'),
        taxNumber: body.taxNumber || null, email: body.email || null, phone: body.phone || null, address: body.address || null,
        city: this.requiredText(body.city, 'City'), paymentTermsDays: Number(body.paymentTermsDays || 30),
      } });
    });
  }

  async createCategory(actor: Actor, body: any) {
    requirePermission(actor, 'inventory.item.create');
    return this.masterCreate(actor, 'ITEM_CATEGORY', (tx) => tx.itemCategory.create({ data: {
      tenantId: actor.tenantId, code: this.requiredText(body.code, 'Category code').toUpperCase(), name: this.requiredText(body.name, 'Category name'),
    } }));
  }

  async createUnit(actor: Actor, body: any) {
    requirePermission(actor, 'inventory.item.create');
    const precision = Number(body.precision ?? 3);
    if (!Number.isInteger(precision) || precision < 0 || precision > 6) throw new BadRequestException('UOM precision must be between 0 and 6');
    return this.masterCreate(actor, 'UNIT_OF_MEASURE', (tx) => tx.unitOfMeasure.create({ data: {
      tenantId: actor.tenantId, code: this.requiredText(body.code, 'UOM code').toUpperCase(), name: this.requiredText(body.name, 'UOM name'), precision,
    } }));
  }

  async createWarehouse(actor: Actor, body: any) {
    const branchId = BigInt(body.branchId || 0);
    this.requireAtBranch(actor, 'inventory.warehouse.create', branchId);
    return this.masterCreate(actor, 'WAREHOUSE', async (tx) => {
      if (!await tx.branch.findUnique({ where: { id: branchId } })) throw new BadRequestException('Branch is invalid');
      return tx.warehouse.create({ data: { tenantId: actor.tenantId, branchId, code: this.requiredText(body.code, 'Warehouse code').toUpperCase(), name: this.requiredText(body.name, 'Warehouse name') } });
    });
  }

  async createItem(actor: Actor, body: any) {
    requirePermission(actor, 'inventory.item.create');
    if (this.fieldAccess(actor, 'item', 'purchasePriceMinor') !== 'EDIT') throw new ForbiddenException('Purchase price is read-only for your role.');
    const categoryId = BigInt(body.categoryId || 0), uomId = BigInt(body.uomId || 0);
    return this.masterCreate(actor, 'ITEM', async (tx) => {
      const [category, uom] = await Promise.all([tx.itemCategory.findUnique({ where: { id: categoryId } }), tx.unitOfMeasure.findUnique({ where: { id: uomId } })]);
      if (!category || !uom) throw new BadRequestException('Category and unit of measure are required');
      const taxRateBps = Math.round(Number(body.taxRatePercent ?? 14) * 100);
      if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) throw new BadRequestException('Tax rate must be between 0 and 100');
      return tx.item.create({ data: {
        tenantId: actor.tenantId, categoryId, uomId, sku: this.requiredText(body.sku, 'SKU').toUpperCase(), barcode: this.requiredText(body.barcode, 'Barcode'),
        name: this.requiredText(body.name, 'Item name'), nameAr: this.requiredText(body.nameAr || body.name, 'Arabic item name'),
        purchasePriceMinor: money(body.purchasePrice, 'purchase price'), salePriceMinor: money(body.salePrice, 'sales price'),
        taxRateBps, reorderMilli: quantity(body.reorderLevel || '0', 'reorder level'),
      } });
    });
  }

  async createBankAccount(actor: Actor, body: any) {
    if (body.accountNumber && this.fieldAccess(actor, 'bankAccount', 'accountNumber') !== 'EDIT') throw new ForbiddenException('Bank account details are read-only for your role.');
    const glAccountId = BigInt(body.glAccountId || 0), type = body.type as BankAccountType;
    if (!Object.values(BankAccountType).includes(type)) throw new BadRequestException('Cash or bank account type is invalid');
    return this.masterCreate(actor, 'BANK_ACCOUNT', async (tx) => {
      const companyId = body.companyId ? BigInt(body.companyId) : actor.companyIds.length === 1 ? BigInt(actor.companyIds[0]) : null;
      if (!companyId || !actor.companyIds.includes(companyId.toString())) throw new BadRequestException('Select an active company for the bank account.');
      requirePermissionAtCompany(actor, 'banking.account.create', companyId);
      this.assertResourceId(actor, 'account', glAccountId, companyId);
      const company = await tx.company.findFirst({ where: { id: companyId, active: true } });
      const account = await tx.account.findFirst({ where: { id: glAccountId, ...this.resourceIdScope(actor, 'account', companyId) } });
      if (!account || !account.postingAllowed || account.type !== AccountType.ASSET) throw new BadRequestException('An active asset GL account is required');
      if (!company) throw new BadRequestException('The selected company is unavailable.');
      const canonicalCode = this.requiredText(body.code, 'Account code').toUpperCase();
      const physicalCode = company.code === 'DEFAULT' ? canonicalCode : `${company.code}-${canonicalCode}`;
      const name = this.requiredText(body.name, 'Account name');
      const bank = await tx.bankAccount.create({ data: {
        tenantId: actor.tenantId, glAccountId, type, code: physicalCode, name,
        currency: String(body.currency || 'EGP').toUpperCase(), bankName: body.bankName || null, accountNumber: body.accountNumber || null,
      } });
      const wrapper = await tx.financialResource.findUnique({ where: { linkedBankAccountId: bank.id } });
      if (!wrapper) throw new ConflictException('Bank account provisioning did not create its private resource wrapper.');
      await tx.financialResource.update({ where: { id: wrapper.id }, data: { companyId, code: canonicalCode, name } });
      return bank;
    });
  }

  async createPeriod(actor: Actor, body: any) {
    requirePermission(actor, 'accounting.period.manage');
    const year = Number(body.year), month = Number(body.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException('A valid fiscal year and month are required');
    const range = accountingFilters({ from: this.requiredText(body.startDate, 'Start date'), to: this.requiredText(body.endDate, 'End date') });
    const startDate = this.date(range.from, 'start date'), endDate = this.date(range.to, 'end date');
    return this.masterCreate(actor, 'FISCAL_PERIOD', async (tx) => {
      if (await tx.fiscalPeriod.findFirst({ where: { startDate: { lte: endDate }, endDate: { gte: startDate } } })) throw new BadRequestException('Fiscal periods must not overlap.');
      return tx.fiscalPeriod.create({ data: {
        tenantId: actor.tenantId, year, month, name: this.requiredText(body.name, 'Period name'), startDate, endDate, status: 'OPEN',
      } });
    });
  }

  async listDocuments(actor: Actor, type?: string, status?: string) {
    if (type && !Object.values(DocumentType).includes(type as DocumentType)) throw new BadRequestException('Document type is invalid');
    const candidates = type ? [type as DocumentType] : Object.values(DocumentType);
    const clauses: Prisma.DocumentWhereInput[] = candidates.flatMap((candidate) => {
      const permission = `${this.documentModule(candidate)}.${this.documentPermissionResource(candidate)}.view`;
      const branches = this.branchesForPermissions(actor, [permission]);
      return branches.length ? [{ AND: [
        { type: candidate, branchId: { in: branches } },
        this.documentScope(actor, this.documentResource(candidate), this.documentModule(candidate)),
      ] }] : [];
    });
    if (!clauses.length) throw new ForbiddenException('No document view permission is effective in an assigned company branch.');
    return this.withTenant(actor, async (tx) => {
      const documents = await tx.document.findMany({
        where: {
          ...(status ? { status: status as WorkflowStatus } : {}), OR: clauses,
        },
        include: { customer: true, supplier: true, branch: true, warehouse: true, salesEmployee: true, sourceDocument: true, journalEntry: true, _count: { select: { lines: true, targetDocuments: true } } },
        orderBy: { createdAt: 'desc' }, take: 200,
      });
      const receivableDocuments = await this.receivables.decorateInvoices(tx, documents);
      const payableDocuments = await this.purchaseBillSettlementDocuments(
        tx,
        receivableDocuments.filter((document) => document.type === DocumentType.PURCHASE_BILL),
      );
      const payableById = new Map(payableDocuments.map((document) => [document.id.toString(), document]));
      return receivableDocuments.map((document) => this.documentForActor(actor, payableById.get(document.id.toString()) || document));
    });
  }

  async salesDocuments(actor: Actor, query: any = {}) {
    if (query.type && !Object.values(DocumentType).includes(query.type as DocumentType)) throw new BadRequestException('Document type is invalid');
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize || 20)));
    const search = String(query.search || '').trim();
    const type = query.type && Object.values(DocumentType).includes(query.type as DocumentType) ? query.type as DocumentType : undefined;
    const status = String(query.status || '') === 'PENDING_APPROVAL' ? WorkflowStatus.SUBMITTED
      : query.status && Object.values(WorkflowStatus).includes(query.status as WorkflowStatus) ? query.status as WorkflowStatus : undefined;
    if (query.branchId) this.assertBranch(actor, BigInt(query.branchId));
    const candidates = type ? [type] : [...SALES_TYPES];
    const typeClauses: Prisma.DocumentWhereInput[] = candidates.flatMap((candidate) => {
      const permission = `${this.documentModule(candidate)}.${this.documentPermissionResource(candidate)}.view`;
      const branches = this.branchesForPermissions(actor, [permission]).filter((branchId) => !query.branchId || branchId === BigInt(query.branchId));
      return branches.length ? [{ AND: [
        { type: candidate, branchId: { in: branches } },
        this.documentScope(actor, this.documentResource(candidate), 'sales'),
      ] }] : [];
    });
    if (!typeClauses.length) throw new ForbiddenException('No sales-document view permission is effective in the requested company branch.');
    const searchClauses: Prisma.DocumentWhereInput[] = search ? [
      { number: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
      { salesEmployee: { name: { contains: search, mode: 'insensitive' } } },
      { sourceDocument: { number: { contains: search, mode: 'insensitive' } } },
      { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
    ] : [];
    const where: Prisma.DocumentWhereInput = {
      AND: [{ OR: typeClauses }, ...(searchClauses.length ? [{ OR: searchClauses }] : [])],
      ...(status ? { status } : {}),
      ...(query.salespersonId ? { salespersonId: BigInt(query.salespersonId) } : {}),
      ...(query.currency ? { currency: String(query.currency).toUpperCase() } : {}),
      ...(query.dateFrom || query.dateTo ? { documentDate: {
        ...(query.dateFrom ? { gte: this.date(query.dateFrom, 'start date') } : {}),
        ...(query.dateTo ? { lte: this.date(query.dateTo, 'end date') } : {}),
      } } : {}),
    };
    const sortFields: Record<string, Prisma.DocumentOrderByWithRelationInput> = {
      number: { number: query.direction === 'asc' ? 'asc' : 'desc' },
      date: { documentDate: query.direction === 'asc' ? 'asc' : 'desc' },
      total: { totalMinor: query.direction === 'asc' ? 'asc' : 'desc' },
      updated: { updatedAt: query.direction === 'asc' ? 'asc' : 'desc' },
    };
    return this.withTenant(actor, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.document.count({ where }),
        tx.document.findMany({
          where,
          include: { customer: true, branch: true, warehouse: true, salesEmployee: true, sourceDocument: true, targetDocuments: true },
          orderBy: sortFields[String(query.sort || 'updated')] || sortFields.updated,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      const decorated = await this.receivables.decorateInvoices(tx, rows);
      return {
        rows: decorated.map((row) => this.documentForActor(actor, {
          ...row,
          customer: row.customer ? this.customerForActor(actor, row.customer) : null,
          editState: documentEditState(row.status, Boolean(row.journalEntryId || row.postedAt || row.paidMinor > 0n)),
        })),
        pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      };
    });
  }

  async salesOverview(actor: Actor) {
    const overviewBranches = this.branchesForPermissions(actor, ['sales.overview.view']);
    const overviewCompanies = this.companiesForPermissions(actor, ['sales.overview.view']);
    if (!can(actor, 'system.super_admin') && !overviewBranches.length) requirePermission(actor, 'sales.overview.view');
    return this.withTenant(actor, async (tx) => {
      const branchScope: Prisma.DocumentWhereInput = { AND: [this.documentScope(actor, 'report', 'sales'), { branchId: { in: overviewBranches } }] };
      const now = new Date();
      const soon = new Date(now.valueOf() + 14 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [awaitingApproval, expiringSoon, invoices, monthlyInvoices, recent, recentCustomers, activity] = await Promise.all([
        tx.document.count({ where: { ...branchScope, type: { in: [...SALES_TYPES] }, status: WorkflowStatus.SUBMITTED } }),
        tx.document.count({ where: { ...branchScope, type: DocumentType.QUOTATION, status: { in: [WorkflowStatus.DRAFT, WorkflowStatus.SUBMITTED, WorkflowStatus.APPROVED] }, dueDate: { gte: now, lte: soon } } }),
        tx.document.findMany({ where: { ...branchScope, type: DocumentType.SALES_INVOICE, status: WorkflowStatus.POSTED } }),
        tx.document.findMany({ where: { ...branchScope, type: DocumentType.SALES_INVOICE, status: WorkflowStatus.POSTED, documentDate: { gte: monthStart } } }),
        tx.document.findMany({ where: { ...branchScope, type: { in: [...SALES_TYPES] } }, include: { customer: true, branch: true, salesEmployee: true }, orderBy: { updatedAt: 'desc' }, take: 12 }),
        tx.customer.findMany({ where: {
          active: true,
          AND: [this.customerScope(actor), { companyId: { in: overviewCompanies } }, { defaultBranchId: { in: overviewBranches } }],
        }, include: { defaultBranch: true }, orderBy: { id: 'desc' }, take: 6 }),
        tx.auditEvent.findMany({ where: {
          entityType: { in: ['CUSTOMER', 'DOCUMENT'] },
          ...this.auditVisibilityScope(actor, overviewCompanies, overviewBranches),
        }, include: { user: publicUser }, orderBy: { createdAt: 'desc' }, take: 8 }),
      ]);
      const invoiceSettlements = await this.receivables.settlements(tx, invoices, now);
      return {
        metrics: {
          awaitingApproval,
          expiringSoon,
          unpaidMinor: invoices.reduce((sum, invoice) => sum + invoiceSettlements.get(invoice.id.toString())!.baseRemainingMinor, 0n),
          overdueMinor: invoices.filter((invoice) => invoice.dueDate && invoice.dueDate < now).reduce((sum, invoice) => sum + invoiceSettlements.get(invoice.id.toString())!.baseRemainingMinor, 0n),
          salesMonthMinor: monthlyInvoices.reduce((sum, invoice) => sum + receivableBaseMinor(invoice.totalMinor, invoice.exchangeRateMicros), 0n),
        },
        recent: recent.map((document) => this.documentForActor(actor, { ...document, customer: document.customer ? this.customerForActor(actor, document.customer) : null })),
        recentCustomers: recentCustomers.map((customer) => this.customerForActor(actor, customer)),
        activity: activity.map((entry) => this.auditForActor(actor, entry)),
      };
    });
  }

  async salesEmployees(actor: Actor, branchId?: string) {
    const permittedBranches = this.branchesForPermissions(actor, ['sales.quotation.view', 'sales.quotation.create', 'sales.order.view']);
    if (!can(actor, 'system.super_admin') && !permittedBranches.length) this.requireAny(actor, 'sales.quotation.view', 'sales.quotation.create', 'sales.order.view');
    if (branchId) this.assertBranch(actor, BigInt(branchId));
    return this.withTenant(actor, async (tx) => {
      const employees = await tx.employee.findMany({
        where: { active: true, AND: [this.employeeScope(actor), { OR: [{ salesEligible: true }, { department: { code: 'SALES', active: true } }] }] },
        include: { department: true },
        orderBy: { name: 'asc' },
      });
      return employees.filter((employee) => {
        const branchIds = employee.branchIds as string[];
        return (!branchId || branchIds.includes(branchId)) && (can(actor, 'system.super_admin') || branchIds.some((id) => permittedBranches.some((candidate) => candidate.toString() === id)));
      }).map((employee) => this.employeeForActor(actor, employee));
    });
  }

  async employees(actor: Actor, query: any = {}) {
    const permittedBranches = this.branchesForPermissions(actor, ['hr.employee.view']);
    if (!can(actor, 'system.super_admin') && !permittedBranches.length) requirePermission(actor, 'hr.employee.view');
    const search = String(query.search || '').trim();
    if (query.branchId) this.assertBranch(actor, BigInt(query.branchId));
    return this.withTenant(actor, async (tx) => (await tx.employee.findMany({
      where: {
        AND: [this.employeeScope(actor), ...(query.branchId ? [{ branchIds: { array_contains: [String(query.branchId)] } }] : []), ...(query.departmentId ? [{ departmentId: BigInt(query.departmentId) }] : [])],
        ...(query.status === 'INACTIVE' ? { active: false } : query.status === 'ALL' ? {} : { active: true }),
        ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }, { jobTitle: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      include: { department: true },
      orderBy: { name: 'asc' },
    })).filter((employee) => can(actor, 'system.super_admin') || ((employee.branchIds as string[]).length > 0 && (employee.branchIds as string[]).every((branchId) => permittedBranches.some((candidate) => candidate.toString() === branchId))))
      .map((employee) => this.employeeForActor(actor, employee)));
  }

  private async hrEmployee(tx: Tx, actor: Actor, employeeId: bigint, permission: string) {
    const employee = await tx.employee.findFirst({ where: { tenantId: actor.tenantId, id: employeeId, AND: [this.employeeScope(actor)] }, include: { department: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    const branches = employee.branchIds as string[];
    const permitted = this.branchesForPermissions(actor, [permission]).map(String);
    if (!can(actor, 'system.super_admin') && (!branches.length || branches.some((id) => !permitted.includes(id)))) throw new ForbiddenException('Employee is outside your access scope.');
    return employee;
  }

  async hrProfile(actor: Actor, employeeId: bigint, yearValue?: string) {
    const year = yearValue ? Number(yearValue) : Number(new Intl.DateTimeFormat('en', { timeZone: 'Africa/Cairo', year: 'numeric' }).format(new Date()));
    if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new BadRequestException('Select a valid leave year.');
    return this.withTenant(actor, async (tx) => {
      const employee = await this.hrEmployee(tx, actor, employeeId, 'hr.employee.view');
      const canView = (kind: string) => can(actor, 'system.super_admin') || (employee.branchIds as string[]).every((id) => this.branchesForPermissions(actor, [`hr.${kind}.view`]).map(String).includes(id));
      const kinds = ['attendance','leave','payroll'].filter((kind) => canView(kind) && (kind !== 'payroll' || fieldAccess(actor, 'employee', 'salaryMinor') !== 'HIDDEN'));
      const records = await tx.hrRecord.findMany({ where: { tenantId: actor.tenantId, employeeId, kind: { in: kinds } }, orderBy: { createdAt: 'desc' } });
      const leave = records.filter((row) => row.kind === 'leave');
      const attendance = records.filter((row) => row.kind === 'attendance' && String((row.data as any).date).startsWith(`${year}-`));
      return { employee: this.employeeForActor(actor, employee), year,
        leaveBalance: canView('leave') ? leaveBalance(employee.annualLeaveDays, leave.map((row) => ({ status: row.status, data: row.data })), year) : null,
        attendanceSummary: canView('attendance') ? { present: attendance.filter((row) => (row.data as any).attendanceStatus === 'PRESENT').length, absent: attendance.filter((row) => (row.data as any).attendanceStatus === 'ABSENT').length, remote: attendance.filter((row) => (row.data as any).attendanceStatus === 'REMOTE').length } : null,
        records: records.filter((row) => row.kind === 'leave' ? (row.data as any).startDate <= `${year}-12-31` && (row.data as any).endDate >= `${year}-01-01` : row.recordKey.startsWith(`${year}-`)), visibleSections: kinds };
    });
  }

  async cancelHrLeave(actor: Actor, recordId: bigint, body: any) {
    const reason = String(body.reason || '').trim().slice(0,2000);
    if (!reason) throw new BadRequestException('Enter a reason for cancelling the leave.');
    return this.withTenant(actor, async (tx) => {
      const row = await tx.hrRecord.findFirst({ where: { tenantId: actor.tenantId, id: recordId, kind: 'leave' } });
      if (!row) throw new NotFoundException('HR request not found.');
      await this.hrEmployee(tx, actor, row.employeeId, 'hr.leave.cancel');
      if (!['SUBMITTED','APPROVED'].includes(row.status)) throw new BadRequestException('Only a pending or approved leave can be cancelled.');
      const result = await tx.hrRecord.update({ where: { id: recordId }, data: { status: 'CANCELLED', reviewedBy: actor.userId, data: { ...(row.data as any), cancellationReason: reason } } });
      await this.audit(tx, actor, 'CANCEL', 'HR_LEAVE', recordId, { employeeId: String(row.employeeId), reason });
      return result;
    });
  }

  async hrDepartments(actor: Actor) {
    return this.withTenant(actor, (tx) => tx.department.findMany({ where: { tenantId: actor.tenantId }, orderBy: { name: 'asc' } }));
  }

  async saveHrDepartment(actor: Actor, body: any, departmentId?: bigint) {
    requirePermission(actor, departmentId ? 'hr.department.edit' : 'hr.department.create');
    const code = String(body.code || '').trim(), name = String(body.name || '').trim();
    if (!code || !name || code.length > 50 || name.length > 200) throw new BadRequestException('Enter a department code and name.');
    return this.withTenant(actor, async (tx) => {
      if (departmentId && !await tx.department.findFirst({ where: { id: departmentId, tenantId: actor.tenantId } })) throw new NotFoundException('Department not found.');
      if (await tx.department.findFirst({ where: { tenantId: actor.tenantId, code, ...(departmentId ? { id: { not: departmentId } } : {}) } })) throw new BadRequestException('Department code already exists.');
      const data = { code, name, active: body.active !== false };
      const result = departmentId ? await tx.department.update({ where: { id: departmentId }, data }) : await tx.department.create({ data: { tenantId: actor.tenantId, ...data } });
      await this.audit(tx, actor, departmentId ? 'UPDATE' : 'CREATE', 'HR_DEPARTMENT', result.id, { code, name });
      return result;
    });
  }

  async saveHrEmployee(actor: Actor, body: any, employeeId?: bigint) {
    const permission = employeeId ? 'hr.employee.edit' : 'hr.employee.create';
    const code = String(body.code || '').trim(), name = String(body.name || '').trim();
    if (!code || !name || code.length > 50 || name.length > 200 || !/^[1-9]\d*$/.test(String(body.departmentId))) throw new BadRequestException('Enter an employee code, name and department.');
    const branchIds = [...new Set<string>((Array.isArray(body.branchIds) ? body.branchIds : [body.branchId]).map(String))];
    if (!branchIds.length || branchIds.some((id) => !/^[1-9]\d*$/.test(id))) throw new BadRequestException('Select an employee branch.');
    for (const branchId of branchIds) this.requireAtBranch(actor, permission, BigInt(branchId));
    return this.withTenant(actor, async (tx) => {
      const current = employeeId ? await this.hrEmployee(tx, actor, employeeId, permission) : null;
      if (!can(actor, 'system.super_admin')) {
        const scope = this.scope(actor, 'employee');
        if ((!current && !['ALL', 'BRANCH', 'WAREHOUSE', 'DEPARTMENT'].includes(scope)) || (scope === 'DEPARTMENT' && actor.departmentId !== String(body.departmentId))) throw new ForbiddenException('Employee creation is outside your access scope.');
      }
      const department = await tx.department.findFirst({ where: { id: BigInt(body.departmentId), tenantId: actor.tenantId, active: true } });
      if (!department && current?.departmentId.toString() !== String(body.departmentId)) throw new BadRequestException('Select an active department.');
      if (await tx.branch.count({ where: { tenantId: actor.tenantId, id: { in: branchIds.map(BigInt) } } }) !== branchIds.length) throw new BadRequestException('Select a valid employee branch.');
      if (await tx.employee.findFirst({ where: { tenantId: actor.tenantId, code, ...(employeeId ? { id: { not: employeeId } } : {}) } })) throw new BadRequestException('Employee code already exists.');
      const employmentType = String(body.employmentType || current?.employmentType || 'FULL_TIME');
      if (!['FULL_TIME','PART_TIME','CONTRACT'].includes(employmentType)) throw new BadRequestException('Employment type is invalid.');
      const email = String(body.email ?? current?.email ?? '').trim();
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new BadRequestException('Enter a valid employee email.');
      const workDays = body.workDays ?? current?.workDays ?? [0,1,2,3,4];
      if (!Array.isArray(workDays) || !workDays.length || workDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new BadRequestException('Select at least one valid working day.');
      let annualLeaveDays = current?.annualLeaveDays ?? null;
      if (body.annualLeaveDays !== undefined) {
        if (body.annualLeaveDays === '' || body.annualLeaveDays === null) annualLeaveDays = null;
        else { annualLeaveDays = Number(body.annualLeaveDays); if (!Number.isInteger(annualLeaveDays) || annualLeaveDays < 0 || annualLeaveDays > 366) throw new BadRequestException('Annual leave allowance must be a whole number from 0 to 366.'); }
      }
      const profileData = { nameAr: String(body.nameAr ?? current?.nameAr ?? '').trim().slice(0,200) || null, email: email || null, phone: String(body.phone ?? current?.phone ?? '').slice(0,50) || null, hireDate: body.hireDate === undefined ? current?.hireDate : body.hireDate ? new Date(hrDate(body.hireDate)) : null, employmentType, annualLeaveDays, workDays: [...new Set(workDays)] };
      const data: Prisma.EmployeeUncheckedCreateInput = { ...profileData, tenantId: actor.tenantId, code, name, departmentId: BigInt(body.departmentId), branchIds, jobTitle: String(body.jobTitle || '').slice(0, 200), salesEligible: body.salesEligible === true, active: body.active !== false };
      if (body.salary !== undefined) {
        if (fieldAccess(actor, 'employee', 'salaryMinor') !== 'EDIT') throw new ForbiddenException('Employee salary is read-only.');
        data.salaryMinor = body.salary === '' ? null : money(body.salary, 'salary');
        if (data.salaryMinor != null && data.salaryMinor < 0n) throw new BadRequestException('Salary cannot be negative.');
      }
      const result = employeeId ? await tx.employee.update({ where: { id: employeeId }, data, include: { department: true } }) : await tx.employee.create({ data, include: { department: true } });
      await this.audit(tx, actor, employeeId ? 'UPDATE' : 'CREATE', 'HR_EMPLOYEE', result.id, { code, name, branchIds });
      return this.employeeForActor(actor, result);
    });
  }

  async hrRecords(actor: Actor, kindValue: string) {
    const kind = hrKind(kindValue);
    const permission = `hr.${kind}.view`;
    if (kind === 'payroll' && fieldAccess(actor, 'employee', 'salaryMinor') === 'HIDDEN') throw new ForbiddenException('Employee salary is restricted.');
    const branches = this.branchesForPermissions(actor, [permission]).map(String);
    return this.withTenant(actor, async (tx) => {
      const employees = await tx.employee.findMany({ where: { tenantId: actor.tenantId, AND: [this.employeeScope(actor)] }, select: { id: true, branchIds: true } });
      const ids = employees.filter((e) => can(actor, 'system.super_admin') || (e.branchIds as string[]).every((id) => branches.includes(id)) && (e.branchIds as string[]).length > 0).map((e) => e.id);
      const rows = await tx.hrRecord.findMany({ where: { tenantId: actor.tenantId, kind, employeeId: { in: ids } }, include: { employee: { include: { department: true } } }, orderBy: { createdAt: 'desc' } });
      return rows.map((row) => ({ ...row, employee: this.employeeForActor(actor, row.employee) }));
    });
  }

  async saveHrRecord(actor: Actor, kindValue: string, body: any, recordId?: bigint) {
    const kind = hrKind(kindValue);
    if (!/^[1-9]\d*$/.test(String(body.employeeId))) throw new BadRequestException('Select an employee.');
    if (kind === 'payroll' && fieldAccess(actor, 'employee', 'salaryMinor') !== 'EDIT') throw new ForbiddenException('Employee salary is read-only.');
    return this.withTenant(actor, async (tx) => {
      const employee = await this.hrEmployee(tx, actor, BigInt(body.employeeId), `hr.${kind}.${recordId ? "edit" : "create"}`);
      if (!employee.active) throw new BadRequestException('Select an active employee.');
      const current = recordId ? await tx.hrRecord.findFirst({ where: { id: recordId, tenantId: actor.tenantId, kind } }) : null;
      if (recordId && !current) throw new NotFoundException('HR request not found.');
      if (current) {
        await this.hrEmployee(tx, actor, current.employeeId, `hr.${kind}.edit`);
        if (kind !== 'attendance' && current.createdBy !== actor.userId) throw new ForbiddenException('Only the request creator can edit it.');
        if (['APPROVED','CANCELLED'].includes(current.status)) throw new BadRequestException('Approved or cancelled HR requests cannot be changed.');
      }
      const input = hrRecordInput(kind, body, employee.salaryMinor, employee.workDays as number[]);
      const duplicate = await tx.hrRecord.findFirst({ where: { tenantId: actor.tenantId, employeeId: employee.id, kind, recordKey: input.recordKey, ...(recordId ? { id: { not: recordId } } : {}) } });
      if (duplicate && kind === 'leave' && ['REJECTED','CANCELLED'].includes(duplicate.status)) input.recordKey += `:${randomUUID()}`;
      else if (duplicate) throw new BadRequestException('A record already exists for this employee and date or month. Edit the existing record.');
      if (kind === 'leave') {
        const existing = await tx.hrRecord.findMany({ where: { tenantId: actor.tenantId, employeeId: employee.id, kind, ...(recordId ? { id: { not: recordId } } : {}), status: { in: ['SUBMITTED', 'APPROVED'] } } });
        assertAnnualLeaveBalance(employee.annualLeaveDays, existing.map((row) => ({ status: row.status, data: row.data })), input.data);
        if (existing.some((row) => { const data = row.data as any; return data.startDate <= input.data.endDate! && data.endDate >= input.data.startDate!; })) throw new BadRequestException('This leave overlaps an existing request.');
      }
      const data = { tenantId: actor.tenantId, employeeId: employee.id, kind, ...input, createdBy: actor.userId, reviewedBy: null };
      const result = recordId ? await tx.hrRecord.update({ where: { id: recordId }, data }) : await tx.hrRecord.create({ data });
      await this.audit(tx, actor, recordId ? 'UPDATE' : 'CREATE', `HR_${kind.toUpperCase()}`, result.id, { employeeId: String(employee.id), recordKey: input.recordKey });
      return result;
    });
  }

  async reviewHrRecord(actor: Actor, recordId: bigint, body: any) {
    if (!['APPROVED', 'REJECTED'].includes(body.status)) throw new BadRequestException('HR review status is invalid.');
    return this.withTenant(actor, async (tx) => {
      const row = await tx.hrRecord.findFirst({ where: { id: recordId, tenantId: actor.tenantId } });
      if (!row || !['leave', 'payroll'].includes(row.kind)) throw new NotFoundException('HR request not found.');
      const employee = await this.hrEmployee(tx, actor, row.employeeId, `hr.${row.kind}.${body.status === 'APPROVED' ? 'approve' : 'reject'}`);
      if (row.kind === 'payroll' && fieldAccess(actor, 'employee', 'salaryMinor') !== 'EDIT') throw new ForbiddenException('Employee salary is read-only.');
      if (row.createdBy === actor.userId) throw new ForbiddenException('Another authorized user must review this request.');
      if (!['DRAFT', 'SUBMITTED'].includes(row.status)) throw new BadRequestException('This request has already been reviewed.');
      if (row.kind === 'leave' && body.status === 'APPROVED') {
        const existing = await tx.hrRecord.findMany({ where: { tenantId: actor.tenantId, employeeId: row.employeeId, kind: 'leave', status: 'APPROVED', id: { not: recordId } } });
        assertAnnualLeaveBalance(employee.annualLeaveDays, existing.map((entry) => ({ status: entry.status, data: entry.data })), row.data, false);
      }
      const reviewReason = String(body.reason || '').trim().slice(0,2000);
      if (body.status === 'REJECTED' && !reviewReason) throw new BadRequestException('Enter a reason for rejecting the request.');
      const result = await tx.hrRecord.update({ where: { id: recordId }, data: { status: body.status, reviewedBy: actor.userId, data: { ...(row.data as any), reviewReason } } });
      await this.audit(tx, actor, body.status, `HR_${row.kind.toUpperCase()}`, row.id, { employeeId: String(row.employeeId) });
      return result;
    });
  }

  async exchangeRate(actor: Actor, currency: string, dateValue?: string) {
    const targetCurrency = String(currency || '').toUpperCase();
    if (!targetCurrency) throw new BadRequestException('Currency is required.');
    return this.withTenant(actor, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const currencyRecord = await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: targetCurrency } } });
      if (!currencyRecord || !currencyRecord.active) throw new BadRequestException(`${targetCurrency} is not a registered active currency.`);
      const rateDate = dateValue ? this.date(dateValue, 'rate date') : new Date();
      if (targetCurrency === tenant.baseCurrency) return { baseCurrency: tenant.baseCurrency, targetCurrency, rateMicros: '1000000', rate: '1.000000', rateDate: rateDate.toISOString().slice(0, 10), source: 'BASE_CURRENCY' };
      const rate = await tx.currencyRate.findFirst({
        where: { baseCurrency: tenant.baseCurrency, targetCurrency, rateDate: { lte: rateDate } },
        orderBy: { rateDate: 'desc' },
      });
      if (!rate) throw new BadRequestException(`No exchange rate was found for ${targetCurrency} on ${rateDate.toISOString().slice(0, 10)}.`);
      return {
        baseCurrency: tenant.baseCurrency,
        targetCurrency,
        rateMicros: rate.rateMicros,
        rate: `${rate.rateMicros / 1_000_000n}.${(rate.rateMicros % 1_000_000n).toString().padStart(6, '0')}`,
        rateDate: rate.rateDate,
        source: rate.source,
      };
    });
  }

  async documentDetail(actor: Actor, id: bigint) {
    return this.withTenant(actor, async (tx) => {
      const document = await this.documentInScope(tx, actor, id, {
        customer: { include: { defaultBranch: true } }, supplier: true, branch: true, warehouse: true, destinationWarehouse: true, salesEmployee: { include: { department: true } },
        sourceDocument: true, targetDocuments: true, lines: { include: { item: true, uom: true, targetLines: { include: { document: true } } } },
        journalEntry: { include: { lines: { include: { account: true } } } },
        allocations: { include: { payment: true } },
        createdBy: publicUser, submittedBy: publicUser, approvedBy: publicUser, postedBy: publicUser,
      });
      if (!document) throw new NotFoundException('Document not found');
      this.requireDocumentPermission(actor, document.type, 'view', document.branchId);
      this.assertBranch(actor, document.branchId);
      const stockMovements = await tx.stockMovement.findMany({ where: { sourceType: { startsWith: document.type }, sourceId: document.id }, include: { item: true, warehouse: true } });
      const audit = await tx.auditEvent.findMany({ where: { AND: [
        { entityType: 'DOCUMENT', entityId: id.toString() },
        this.auditVisibilityScope(
          actor,
          this.companiesForPermissions(actor, ['audit.business.view']),
          this.branchesForPermissions(actor, ['audit.business.view']),
        ),
      ] }, include: { user: publicUser }, orderBy: { createdAt: 'desc' } });
      const approvals = await tx.approvalEvent.findMany({ where: { entityType: 'DOCUMENT', entityId: id }, include: { actor: publicUser }, orderBy: { createdAt: 'asc' } });
      const [decorated] = await this.receivables.decorateInvoices(tx, [document]);
      return {
        ...this.documentForActor(actor, decorated),
        customer: document.customer ? this.customerForActor(actor, document.customer) : null,
        journalEntry: this.fieldAccess(actor, 'journal', 'lines') !== 'HIDDEN' || actor.legacyPermissions.includes('invoices.view-accounting') ? document.journalEntry : null,
        editState: documentEditState(document.status, Boolean(document.journalEntryId || document.postedAt || document.paidMinor > 0n || stockMovements.length)),
        stockMovements: stockMovements.map((movement) => {
          const visible: any = { ...movement, item: this.itemForActor(actor, movement.item) };
          if (this.fieldAccess(actor, 'document', 'costMinor') === 'HIDDEN') {
            delete visible.unitCostMinor; delete visible.totalCostMinor; delete visible.runningValueMinor;
          }
          return visible;
        }),
        audit: audit.map((entry) => this.auditForActor(actor, entry)),
        approvals: approvals.map((approval) => projectRecord(actor, 'approval', approval)),
        accountingEffect: this.fieldAccess(actor, 'journal', 'lines') !== 'HIDDEN' || actor.legacyPermissions.includes('invoices.view-accounting')
          ? document.journalEntryId ? 'Posted journal linked below' : 'No general-ledger impact for this document type'
          : 'Accounting details are restricted.',
      };
    });
  }

  async createDocument(actor: Actor, body: any) {
    const type = body.type as DocumentType;
    if (!Object.values(DocumentType).includes(type)) throw new BadRequestException('Document type is invalid');
    return this.withTenant(actor, (tx) => this.createDocumentTx(tx, actor, type, body));
  }

  async updateDocument(actor: Actor, id: bigint, body: any) {
    return this.withTenant(actor, async (tx) => {
      const current = await this.documentInScope(tx, actor, id);
      if (!current) throw new NotFoundException('Document not found');
      const hasStock = await tx.stockMovement.count({ where: { sourceType: { startsWith: current.type }, sourceId: current.id } });
      const state = documentEditState(current.status, Boolean(current.journalEntryId || current.postedAt || current.paidMinor > 0n || hasStock));
      if (!state.editable) throw new BadRequestException(state.reason || 'This document is locked.');
      if (current.sourceDocumentId && body.lines !== undefined) {
        throw new BadRequestException('Lines on a source-linked document cannot be replaced. Create a new conversion to preserve source-line traceability.');
      }

      const branchId = BigInt(body.branchId || current.branchId);
      if (this.companyIdForBranch(actor, current.branchId) !== this.companyIdForBranch(actor, branchId)) throw new ConflictException('A document cannot be moved to another company. Create a new document in that company.');
      const companyId = this.requireDocumentPermission(actor, current.type, 'edit', current.branchId);
      this.requireDocumentPermission(actor, current.type, 'edit', branchId);
      if (body.notes !== undefined) this.requireFieldEdit(actor, 'document', 'notes', 'Internal document notes');
      const warehouseId = body.warehouseId === undefined ? current.warehouseId : body.warehouseId ? BigInt(body.warehouseId) : null;
      await this.assertBranchWarehouse(tx, actor, branchId, warehouseId);
      const customerId = body.customerId === undefined ? current.customerId : body.customerId ? BigInt(body.customerId) : null;
      if (SALES_TYPES.has(current.type) && !customerId) throw new BadRequestException('Customer is required.');
      if (customerId && !await tx.customer.findFirst({ where: { id: customerId, companyId, active: true } })) throw new BadRequestException('The selected customer is not available for this company.');

      let salespersonId = body.salespersonId === undefined ? current.salespersonId : body.salespersonId ? BigInt(body.salespersonId) : null;
      let salesperson = current.salesperson;
      if (SALES_TYPES.has(current.type)) {
        if (!salespersonId && (current.type === DocumentType.QUOTATION || current.type === DocumentType.SALES_ORDER)) throw new BadRequestException('Select an active Sales employee.');
        if (salespersonId) {
          const employee = await tx.employee.findUnique({ where: { id: salespersonId }, include: { department: true } });
          const branchIds = employee?.branchIds as string[] | undefined;
          if (!employee || !employee.active || (!employee.salesEligible && employee.department.code !== 'SALES')) throw new BadRequestException('The selected employee is not an active Sales employee.');
          if (!branchIds?.includes(branchId.toString())) throw new BadRequestException('The selected salesperson is not assigned to this branch.');
          salesperson = employee.name;
        }
      }

      const documentDate = body.documentDate ? this.date(body.documentDate, 'document date') : current.documentDate;
      const dueDate = body.dueDate === undefined ? current.dueDate : body.dueDate ? this.date(body.dueDate, 'due date') : null;
      if (dueDate && dueDate < documentDate) throw new BadRequestException('Due or expiry date cannot be before the document date.');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const currency = String(body.currency || current.currency || tenant.baseCurrency).toUpperCase();
      const currencyRecord = await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: currency } } });
      if (!currencyRecord?.active) throw new BadRequestException(`${currency} is not a registered active currency.`);
      let exchangeRateMicros = 1_000_000n;
      let exchangeRateDate: Date | null = documentDate;
      let manualExchangeRate = false;
      if (currency !== tenant.baseCurrency) {
        if (body.manualExchangeRate) {
          this.requireAtBranch(actor, 'sales.exchange_rate.edit', branchId);
          exchangeRateMicros = parseFixed(body.exchangeRate, 6, 'exchange rate');
          exchangeRateDate = body.exchangeRateDate ? this.date(body.exchangeRateDate, 'exchange rate date') : documentDate;
          manualExchangeRate = true;
          if (!String(body.exchangeRateOverrideReason || '').trim()) throw new BadRequestException('An exchange-rate override reason is required.');
        } else {
          const rate = await tx.currencyRate.findFirst({ where: { baseCurrency: tenant.baseCurrency, targetCurrency: currency, rateDate: { lte: documentDate } }, orderBy: { rateDate: 'desc' } });
          if (!rate) throw new BadRequestException(`No exchange rate was found for ${currency} on ${documentDate.toISOString().slice(0, 10)}.`);
          exchangeRateMicros = rate.rateMicros;
          exchangeRateDate = rate.rateDate;
        }
      }

      let totals = { subtotal: current.subtotalMinor, discount: current.discountMinor, tax: current.taxMinor, total: current.totalMinor };
      let lineCreates: any[] | undefined;
      let priceOverride = false;
      if (body.lines !== undefined) {
        if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException('At least one line is required.');
        const itemIds = body.lines.map((line: any) => BigInt(line.itemId || 0));
        const items = await tx.item.findMany({ where: { id: { in: itemIds }, active: true } });
        const itemMap = new Map(items.map((item) => [item.id.toString(), item]));
        let subtotal = 0n, discount = 0n, tax = 0n, total = 0n;
        lineCreates = body.lines.map((line: any, index: number) => {
          const item = itemMap.get(String(line.itemId));
          if (!item) throw new BadRequestException(`Line ${index + 1}: item is invalid.`);
          const lineQuantity = quantity(line.quantity, `line ${index + 1} quantity`);
          const standardPrice = currency === tenant.baseCurrency ? item.salePriceMinor : roundDiv(item.salePriceMinor * 1_000_000n, exchangeRateMicros);
          const unitPrice = line.unitPrice === undefined ? standardPrice : money(line.unitPrice, `line ${index + 1} unit price`);
          if (unitPrice !== standardPrice && !canAtCompany(actor, 'sales.price.edit', companyId)) throw new ForbiddenException(`Line ${index + 1}: you do not have permission to override the selling price.`);
          if (unitPrice !== standardPrice) priceOverride = true;
          const lineDiscount = money(line.discount || '0', `line ${index + 1} discount`);
          const taxMode = String(body.taxMode || current.taxMode);
          const calculated = calculateDocumentLine(lineQuantity, unitPrice, lineDiscount, BigInt(line.taxRateBps ?? item.taxRateBps), taxMode);
          subtotal += taxMode === 'INCLUSIVE' ? calculated.taxableMinor + lineDiscount : calculated.grossMinor;
          discount += lineDiscount;
          tax += calculated.taxMinor;
          total += calculated.totalMinor;
          return {
            tenant: { connect: { id: actor.tenantId } },
            item: { connect: { id: item.id } },
            uom: { connect: { id: item.uomId } },
            description: String(line.description || item.name),
            quantityMilli: lineQuantity,
            unitPriceMinor: unitPrice,
            discountMinor: lineDiscount,
            taxableMinor: calculated.taxableMinor,
            taxMinor: calculated.taxMinor,
            totalMinor: calculated.totalMinor,
            unitCostMinor: item.purchasePriceMinor,
          };
        });
        totals = { subtotal, discount, tax, total };
        if (priceOverride && !String(body.priceOverrideReason || '').trim()) throw new BadRequestException('A price override reason is required.');
        await tx.documentLine.deleteMany({ where: { documentId: id } });
      }

      const updated = await tx.document.update({ where: { id }, data: {
        branchId,
        warehouseId,
        customerId,
        documentDate,
        dueDate,
        currency,
        exchangeRateMicros,
        exchangeRateDate,
        manualExchangeRate,
        priceList: body.priceList === undefined ? current.priceList : body.priceList || null,
        taxMode: body.taxMode || current.taxMode,
        paymentTerms: body.paymentTerms === undefined ? current.paymentTerms : body.paymentTerms || null,
        salespersonId,
        salesperson,
        notes: body.notes === undefined ? current.notes : body.notes || null,
        subtotalMinor: totals.subtotal,
        discountMinor: totals.discount,
        taxMinor: totals.tax,
        totalMinor: totals.total,
        ...(lineCreates ? { lines: { create: lineCreates } } : {}),
      }, include: { lines: true } });
      await this.audit(tx, actor, 'UPDATE', 'DOCUMENT', id, {
        number: updated.number,
        status: updated.status,
        totalMinor: updated.totalMinor.toString(),
      }, {
        number: current.number,
        status: current.status,
        totalMinor: current.totalMinor.toString(),
      });
      if (manualExchangeRate) await this.audit(tx, actor, 'EXCHANGE_RATE_OVERRIDE', 'DOCUMENT', id, {
        number: updated.number,
        exchangeRateMicros: exchangeRateMicros.toString(),
        reason: String(body.exchangeRateOverrideReason || 'Manual rate authorized during document update'),
      });
      if (priceOverride) await this.audit(tx, actor, 'PRICE_OVERRIDE', 'DOCUMENT', id, {
        number: updated.number,
        reason: String(body.priceOverrideReason || 'Authorized line price override during document update'),
      });
      return this.documentForActor(actor, updated);
    });
  }

  private async createDocumentTx(tx: Tx, actor: Actor, type: DocumentType, body: any, trustedSourceConversion = false) {
    const branchId = BigInt(body.branchId || 0);
    const companyId = this.requireDocumentPermission(actor, type, 'create', branchId);
    if (String(body.notes || '').trim()) this.requireFieldEdit(actor, 'document', 'notes', 'Internal document notes');
    const warehouseId = body.warehouseId ? BigInt(body.warehouseId) : null;
    const destinationWarehouseId = body.destinationWarehouseId ? BigInt(body.destinationWarehouseId) : null;
    await this.assertBranchWarehouse(tx, actor, branchId, warehouseId);
    this.assertWarehouse(actor, destinationWarehouseId);
    if (Array.isArray(body.attachments) && body.attachments.length) throw new BadRequestException('Legacy embedded attachments are disabled. Upload a private attachment after creating the document.');
    if (!trustedSourceConversion && (body.sourceDocumentId || body.lines?.some((line: any) => line.sourceLineId))) {
      throw new ForbiddenException('Source document and source line identifiers are assigned only by the audited conversion workflow.');
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) throw new BadRequestException('At least one line is required');
    if (SALES_TYPES.has(type) && !body.customerId) throw new BadRequestException('Customer is required');
    if (PURCHASE_TYPES.has(type) && type !== DocumentType.PURCHASE_REQUEST && !body.supplierId) throw new BadRequestException('Supplier is required');
    if (body.supplierId) {
      const supplierId = BigInt(body.supplierId);
      this.assertResourceId(actor, 'supplier', supplierId);
      if (!await tx.supplier.findFirst({ where: { id: supplierId, companyId, active: true, ...this.resourceIdScope(actor, 'supplier') } })) throw new BadRequestException('The selected supplier is not available for this company.');
    }
    if (new Set<DocumentType>([DocumentType.DELIVERY_NOTE, DocumentType.SALES_RETURN, DocumentType.GOODS_RECEIPT, DocumentType.PURCHASE_RETURN, DocumentType.WAREHOUSE_TRANSFER, DocumentType.INVENTORY_ADJUSTMENT, DocumentType.STOCK_COUNT]).has(type) && !warehouseId) throw new BadRequestException('Warehouse is required');
    if (type === DocumentType.WAREHOUSE_TRANSFER && (!destinationWarehouseId || destinationWarehouseId === warehouseId)) throw new BadRequestException('A different destination warehouse is required');
    if (destinationWarehouseId) {
      const destination = await tx.warehouse.findUnique({ where: { id: destinationWarehouseId }, include: { branch: { include: { companyLinks: true } } } });
      const destinationCompany = destination?.branch.companyLinks.find((link) => link.active)?.companyId;
      if (!destination?.active || destinationCompany !== companyId) throw new BadRequestException('The destination warehouse is not available in this company.');
    }
    if (body.customerId) {
      const customer = await tx.customer.findFirst({ where: { id: BigInt(body.customerId), companyId } });
      if (!customer || !customer.active) throw new BadRequestException('The selected customer is not available.');
      if (customer.creditHold && SALES_TYPES.has(type)) throw new BadRequestException('This customer is on credit hold. Ask an authorized manager to review the account.');
    }
    const requiredSource: Partial<Record<DocumentType, DocumentType[]>> = {
      DELIVERY_NOTE: [DocumentType.SALES_ORDER], SALES_INVOICE: [DocumentType.DELIVERY_NOTE], SALES_RETURN: [DocumentType.SALES_INVOICE], CREDIT_NOTE: [DocumentType.SALES_INVOICE],
      GOODS_RECEIPT: [DocumentType.PURCHASE_ORDER], PURCHASE_BILL: [DocumentType.GOODS_RECEIPT], PURCHASE_RETURN: [DocumentType.GOODS_RECEIPT, DocumentType.PURCHASE_BILL],
    };
    let sourceDocument: Awaited<ReturnType<Tx['document']['findUnique']>> = null;
    if (requiredSource[type]) {
      if (!trustedSourceConversion) throw new BadRequestException(`${type} must be created through the source-document conversion workflow.`);
      if (!body.sourceDocumentId) throw new BadRequestException(`${type} must be created by converting an approved source document`);
      sourceDocument = await tx.document.findUnique({ where: { id: BigInt(body.sourceDocumentId) } });
      if (!sourceDocument || !requiredSource[type]!.includes(sourceDocument.type) || (sourceDocument.status !== WorkflowStatus.APPROVED && sourceDocument.status !== WorkflowStatus.POSTED)) throw new BadRequestException(`${type} source type or status is invalid`);
      if (this.companyIdForBranch(actor, sourceDocument.branchId) !== companyId) throw new ForbiddenException('Source and target documents must belong to the same company.');
    }
    const date = this.date(body.documentDate || new Date().toISOString().slice(0, 10), 'document date');
    const dueDate = body.dueDate ? this.date(body.dueDate, 'due date') : null;
    if (dueDate && dueDate < date) throw new BadRequestException('Due or expiry date cannot be before the document date.');
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
    const documentCurrency = String(body.currency || tenant.baseCurrency).toUpperCase();
    const currencyRecord = await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: documentCurrency } } });
    if (!currencyRecord || !currencyRecord.active) throw new BadRequestException(`${documentCurrency} is not a registered active currency.`);
    let exchangeRateMicros = 1_000_000n;
    let exchangeRateDate: Date | null = date;
    let manualExchangeRate = false;
    if (documentCurrency !== tenant.baseCurrency) {
      if (body.systemExchangeRateMicros) {
        exchangeRateMicros = BigInt(body.systemExchangeRateMicros);
        exchangeRateDate = body.exchangeRateDate ? this.date(body.exchangeRateDate, 'exchange rate date') : date;
        if (exchangeRateMicros <= 0n) throw new BadRequestException('Exchange rate must be greater than zero.');
      } else if (body.manualExchangeRate) {
        this.requireAtBranch(actor, 'sales.exchange_rate.edit', branchId);
        exchangeRateMicros = parseFixed(body.exchangeRate, 6, 'exchange rate');
        if (exchangeRateMicros <= 0n) throw new BadRequestException('Exchange rate must be greater than zero.');
        exchangeRateDate = body.exchangeRateDate ? this.date(body.exchangeRateDate, 'exchange rate date') : date;
        manualExchangeRate = true;
        if (!String(body.exchangeRateOverrideReason || '').trim()) throw new BadRequestException('An exchange-rate override reason is required.');
      } else {
        const rate = await tx.currencyRate.findFirst({
          where: { baseCurrency: tenant.baseCurrency, targetCurrency: documentCurrency, rateDate: { lte: date } },
          orderBy: { rateDate: 'desc' },
        });
        if (!rate) throw new BadRequestException(`No exchange rate was found for ${documentCurrency} on ${date.toISOString().slice(0, 10)}.`);
        exchangeRateMicros = rate.rateMicros;
        exchangeRateDate = rate.rateDate;
      }
    }
    let salespersonId: bigint | null = body.salespersonId ? BigInt(body.salespersonId) : null;
    let salespersonName: string | null = null;
    if (SALES_TYPES.has(type)) {
      if (!salespersonId && (type === DocumentType.QUOTATION || type === DocumentType.SALES_ORDER)) throw new BadRequestException('Select an active Sales employee.');
      if (salespersonId) {
        const employee = await tx.employee.findUnique({ where: { id: salespersonId }, include: { department: true } });
        const branchIds = employee?.branchIds as string[] | undefined;
        if (!employee || !employee.active || (!employee.salesEligible && employee.department.code !== 'SALES')) {
          throw new BadRequestException('The selected employee is not an active Sales employee.');
        }
        if (!branchIds?.includes(branchId.toString())) throw new BadRequestException(`The selected salesperson is not assigned to this branch.`);
        salespersonName = employee.name;
      }
    }
    if (!['EXCLUSIVE', 'INCLUSIVE', 'EXEMPT'].includes(String(body.taxMode || 'EXCLUSIVE'))) throw new BadRequestException('Tax mode is invalid');
    const itemIds = body.lines.map((line: any) => BigInt(line.itemId || 0));
    const items = await tx.item.findMany({ where: { id: { in: itemIds }, active: true } });
    const itemMap = new Map(items.map((item) => [item.id.toString(), item]));
    const sourceLineIds: Array<bigint | null> = body.lines.map((line: any) => line.sourceLineId ? BigInt(line.sourceLineId) : null);
    const sourceLines = sourceDocument
      ? await tx.documentLine.findMany({ where: { documentId: sourceDocument.id, id: { in: sourceLineIds.filter((lineId): lineId is bigint => lineId !== null) } } })
      : [];
    const sourceLineMap = new Map(sourceLines.map((line) => [line.id.toString(), line]));
    if (sourceDocument && (sourceLines.length !== body.lines.length
      || body.lines.some((line: any) => sourceLineMap.get(String(line.sourceLineId))?.itemId !== BigInt(line.itemId || 0)))) {
      throw new BadRequestException(`${type} lines must preserve valid source-line and item relationships.`);
    }
    const countBalances = type === DocumentType.STOCK_COUNT && warehouseId
      ? await tx.stockBalance.findMany({ where: { warehouseId, itemId: { in: itemIds } } })
      : [];
    const countBalanceMap = new Map(countBalances.map((balance) => [balance.itemId.toString(), balance.quantityMilli]));
    let subtotal = 0n, discount = 0n, tax = 0n, total = 0n, priceOverride = false;
    const lines = body.lines.map((line: any, index: number) => {
      const item = itemMap.get(String(line.itemId));
      if (!item) throw new BadRequestException(`Line ${index + 1}: item is invalid`);
      const systemQuantity = type === DocumentType.STOCK_COUNT ? (countBalanceMap.get(item.id.toString()) || 0n) : null;
      const countedQuantity = type === DocumentType.STOCK_COUNT ? quantity(line.countedQuantity ?? line.quantity, `line ${index + 1} counted quantity`) : null;
      const variance = systemQuantity === null || countedQuantity === null ? null : countedQuantity - systemQuantity;
      const qty = variance === null ? quantity(line.quantity, `line ${index + 1} quantity`) : (variance < 0n ? -variance : variance);
      if (qty <= 0n) throw new BadRequestException(`Line ${index + 1}: quantity must be greater than zero`);
      const baseStandardPrice = PURCHASE_TYPES.has(type) ? item.purchasePriceMinor : item.salePriceMinor;
      const standardPrice = documentCurrency === tenant.baseCurrency ? baseStandardPrice : roundDiv(baseStandardPrice * 1_000_000n, exchangeRateMicros);
      const unitPrice = line.unitPrice === undefined ? standardPrice : money(line.unitPrice, `line ${index + 1} unit price`);
      if (SALES_TYPES.has(type) && unitPrice !== standardPrice && !trustedSourceConversion && !canAtCompany(actor, 'sales.price.edit', companyId)) {
        throw new ForbiddenException(`Line ${index + 1}: you do not have permission to override the selling price.`);
      }
      if (SALES_TYPES.has(type) && unitPrice !== standardPrice) priceOverride = true;
      const lineDiscount = money(line.discount || '0', `line ${index + 1} discount`);
      const rate = BigInt(line.taxRateBps ?? item.taxRateBps);
      const taxMode = String(body.taxMode || 'EXCLUSIVE');
      const calculated = calculateDocumentLine(qty, unitPrice, lineDiscount, rate, taxMode);
      subtotal += taxMode === 'INCLUSIVE' ? calculated.taxableMinor + lineDiscount : calculated.grossMinor;
      discount += lineDiscount;
      tax += calculated.taxMinor;
      total += calculated.totalMinor;
      return {
        tenantId: actor.tenantId, itemId: item.id, uomId: item.uomId, sourceLineId: line.sourceLineId ? BigInt(line.sourceLineId) : null,
        description: String(variance === null ? (line.description || item.name) : `${variance < 0n ? 'Decrease' : 'Increase'} stock-count variance`), quantityMilli: qty,
        systemQuantityMilli: systemQuantity, countedQuantityMilli: countedQuantity, unitPriceMinor: unitPrice,
        discountMinor: lineDiscount, taxableMinor: calculated.taxableMinor, taxMinor: calculated.taxMinor, totalMinor: calculated.totalMinor,
        unitCostMinor: item.purchasePriceMinor,
      };
    });
    if (priceOverride && !trustedSourceConversion && !String(body.priceOverrideReason || '').trim()) throw new BadRequestException('A price override reason is required.');
    const number = await this.sequence(tx, actor, branchId, type, date);
    const document = await tx.document.create({ data: {
      tenantId: actor.tenantId, type, number, branchId, warehouseId, destinationWarehouseId,
      customerId: body.customerId ? BigInt(body.customerId) : null, supplierId: body.supplierId ? BigInt(body.supplierId) : null,
      sourceDocumentId: body.sourceDocumentId ? BigInt(body.sourceDocumentId) : null, documentDate: date,
      dueDate, currency: documentCurrency,
      exchangeRateMicros, exchangeRateDate, manualExchangeRate, priceList: body.priceList || null,
      taxMode: String(body.taxMode || 'EXCLUSIVE'), paymentTerms: body.paymentTerms || null, salesperson: salespersonName || body.salesperson || null, salespersonId,
      notes: body.notes || null, attachments: [], subtotalMinor: subtotal, discountMinor: discount, taxMinor: tax, totalMinor: total,
      createdById: actor.userId, lines: { create: lines },
    }, include: { lines: true } });
    await this.audit(tx, actor, 'CREATE', 'DOCUMENT', document.id, { number, type, totalMinor: total.toString() });
    if (manualExchangeRate) await this.audit(tx, actor, 'EXCHANGE_RATE_OVERRIDE', 'DOCUMENT', document.id, {
      number,
      currency: documentCurrency,
      baseCurrency: tenant.baseCurrency,
      exchangeRateMicros: exchangeRateMicros.toString(),
      reason: String(body.exchangeRateOverrideReason || 'Manual rate authorized during document creation'),
    });
    if (priceOverride) await this.audit(tx, actor, 'PRICE_OVERRIDE', 'DOCUMENT', document.id, {
      number,
      reason: trustedSourceConversion ? String(body.priceOverrideReason || 'Preserved from approved source document') : String(body.priceOverrideReason),
    });
    return this.documentForActor(actor, document);
  }

  async convertDocument(actor: Actor, id: bigint, body: any) {
    return this.withTenant(actor, async (tx) => {
      const source = await this.documentInScope(tx, actor, id, { lines: { include: { targetLines: { include: { document: true } } } } });
      if (!source) throw new NotFoundException('Source document not found');
      this.assertBranch(actor, source.branchId);
      const sourceType = source.type as DocumentType;
      const targetType = body.targetType as DocumentType;
      if (!CONVERSIONS[sourceType]?.includes(targetType)) throw new BadRequestException(`Cannot convert ${sourceType} to ${targetType}`);
      this.requireDocumentPermission(actor, sourceType, 'convert', source.branchId);
      this.requireDocumentPermission(actor, targetType, 'create', source.branchId);
      if (!documentConversionAllowed(sourceType, source.status, targetType)) {
        throw new BadRequestException('Source document must be an approved or posted document, except a draft quotation converted directly to a sales order');
      }
      const directQuotationConversion = sourceType === DocumentType.QUOTATION
        && targetType === DocumentType.SALES_ORDER
        && source.status === WorkflowStatus.DRAFT;
      const requested: Map<string, bigint> | null = Array.isArray(body.lines) ? new Map<string, bigint>(body.lines.map((line: any) => [String(line.sourceLineId), quantity(line.quantity)])) : null;
      const lines = source.lines.map((line: any) => {
        const consumed = line.targetLines.filter((target: any) => target.document.status !== WorkflowStatus.REJECTED && target.document.status !== WorkflowStatus.CANCELLED).reduce((sum: bigint, target: any) => sum + BigInt(target.quantityMilli), 0n);
        const lineQuantity = BigInt(line.quantityMilli), unitPrice = BigInt(line.unitPriceMinor), lineDiscount = BigInt(line.discountMinor);
        const remaining = lineQuantity - consumed;
        const qty = requested?.get(line.id.toString()) ?? remaining;
        if (qty <= 0n || qty > remaining) throw new BadRequestException(`Source line ${line.id}: requested quantity exceeds remaining ${remaining}`);
        const convertedDiscount = roundDiv(lineDiscount * qty, lineQuantity);
        return { itemId: line.itemId.toString(), sourceLineId: line.id.toString(), quantity: `${qty / 1000n}.${(qty % 1000n).toString().padStart(3, '0')}`, unitPrice: `${unitPrice / 100n}.${(unitPrice % 100n).toString().padStart(2, '0')}`, discount: `${convertedDiscount / 100n}.${(convertedDiscount % 100n).toString().padStart(2, '0')}` };
      });
      const target = await this.createDocumentTx(tx, actor, targetType, {
        ...body, type: targetType, branchId: source.branchId.toString(), warehouseId: body.warehouseId || source.warehouseId?.toString(),
        customerId: source.customerId?.toString(), supplierId: body.supplierId || source.supplierId?.toString(), sourceDocumentId: source.id.toString(),
        salespersonId: source.salespersonId?.toString(), currency: source.currency, systemExchangeRateMicros: source.exchangeRateMicros.toString(),
        exchangeRateDate: source.exchangeRateDate?.toISOString().slice(0, 10),
        taxMode: source.taxMode,
        paymentTerms: source.paymentTerms,
        notes: source.notes,
        dueDate: body.dueDate,
        documentDate: body.documentDate || new Date().toISOString().slice(0, 10),
        priceOverrideReason: `Preserved from source ${source.number}`,
        lines,
      }, true);
      await this.receivables.assertCreditWithinRemaining(tx, target);
      if (directQuotationConversion) {
        await tx.document.update({ where: { id: source.id }, data: { status: WorkflowStatus.POSTED, postedById: actor.userId, postedAt: new Date() } });
      }
      await this.audit(tx, actor, 'CONVERT', 'DOCUMENT', source.id, {
        targetId: target.id.toString(), targetNumber: target.number, targetType,
        sourceStatus: directQuotationConversion ? WorkflowStatus.POSTED : source.status,
      });
      return this.documentForActor(actor, target);
    });
  }

  async workflow(actor: Actor, id: bigint, action: 'submit' | 'approve' | 'reject' | 'request-changes', body: any = {}) {
    return this.withTenant(actor, async (tx) => {
      const authorize = (document: { type: DocumentType; branchId: bigint }) => {
        this.assertBranch(actor, document.branchId);
        if (action === 'submit') this.requireDocumentPermission(actor, document.type, 'edit', document.branchId);
        else if (action === 'request-changes') this.requireAtBranch(actor, 'approvals.queue.edit', document.branchId);
        else this.requireDocumentPermission(actor, document.type, action, document.branchId);
      };
      const visible = await this.documentInScope(tx, actor, id);
      if (!visible) throw new NotFoundException('Document not found');
      authorize(visible);
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM documents WHERE id = ${id} FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('Document not found');
      const document = await this.documentInScope(tx, actor, id);
      if (!document) throw new NotFoundException('Document not found');
      authorize(document);
      const now = new Date();
      if (action === 'submit') {
        if (document.status !== WorkflowStatus.DRAFT && document.status !== WorkflowStatus.REJECTED) throw new BadRequestException('Only a draft or returned document can be submitted.');
        const updated = await tx.document.update({ where: { id }, data: { status: WorkflowStatus.SUBMITTED, submittedById: actor.userId, submittedAt: now, approvedById: null, approvedAt: null } });
        await tx.approvalEvent.create({ data: { tenantId: actor.tenantId, entityType: 'DOCUMENT', entityId: id, action: 'SUBMIT', actorId: actor.userId, comment: body.comment || null } });
        await this.audit(tx, actor, 'SUBMIT', 'DOCUMENT', id, { approvalReference: updated.number });
        return this.documentForActor(actor, updated);
      }
      if (document.status !== WorkflowStatus.SUBMITTED) throw new BadRequestException('Only a submitted document can be approved or rejected');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      if (action === 'approve' && tenant.makerChecker && document.submittedById === actor.userId) throw new ForbiddenException('Maker-checker control: submitter cannot approve this document');
      if (action === 'approve') {
        this.assertApprovalLimit(actor, document.type, document.totalMinor, document.subtotalMinor, document.discountMinor);
        const companyId = this.companyIdForBranch(actor, document.branchId);
        const key = document.type === DocumentType.PURCHASE_ORDER ? 'purchasing.order_approval_amount_minor'
          : document.type === DocumentType.PURCHASE_BILL ? 'purchasing.bill_approval_amount_minor'
            : document.type === DocumentType.SALES_RETURN || document.type === DocumentType.CREDIT_NOTE ? 'sales.return_amount_minor'
              : document.type === DocumentType.SALES_ORDER || document.type === DocumentType.SALES_INVOICE ? 'sales.credit_exposure_amount_minor'
                : document.type === DocumentType.QUOTATION ? 'sales.quotation_amount_minor' : 'expenses.approval_amount_minor';
        const discountBps = document.subtotalMinor > 0n ? Number(document.discountMinor * 10_000n / document.subtotalMinor) : 0;
        let authorityAmountMinor = document.totalMinor;
        let authorityCurrency = document.currency;
        if (key === 'sales.credit_exposure_amount_minor' && document.customerId) {
          const companyBranches = (await tx.companyBranch.findMany({ where: { companyId, active: true }, select: { branchId: true } })).map(({ branchId }) => branchId);
          const [balances, openOrders, tenant] = await Promise.all([
            this.receivables.customerBalances(tx, [document.customerId], companyBranches),
            tx.document.findMany({
              where: {
                id: { not: document.id }, customerId: document.customerId, branchId: { in: companyBranches },
                type: DocumentType.SALES_ORDER, status: { in: [WorkflowStatus.SUBMITTED, WorkflowStatus.APPROVED] },
              },
              select: { totalMinor: true, exchangeRateMicros: true },
            }),
            tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { baseCurrency: true } }),
          ]);
          const postedExposure = balances.get(document.customerId.toString()) || 0n;
          const committedExposure = openOrders.reduce((sum, order) => sum + receivableBaseMinor(order.totalMinor, order.exchangeRateMicros), 0n);
          authorityAmountMinor = (postedExposure > 0n ? postedExposure : 0n)
            + committedExposure
            + receivableBaseMinor(document.totalMinor, document.exchangeRateMicros);
          authorityCurrency = tenant.baseCurrency;
        }
        await this.governance.enforceAuthorityLimit(tx, actor, { companyId, branchId: document.branchId, key, currency: authorityCurrency, amountMinor: authorityAmountMinor, documentType: document.type });
        if (SALES_TYPES.has(document.type)) {
          await this.governance.enforceAuthorityLimit(tx, actor, {
            companyId,
            branchId: document.branchId,
            key: 'sales.discount_percent',
            currency: document.currency,
            percentBps: discountBps,
            documentType: document.type,
          });
        }
      }
      const comment = String(body.comment || '').trim();
      if ((action === 'reject' || action === 'request-changes') && !comment) {
        throw new BadRequestException(action === 'reject' ? 'A rejection reason is required.' : 'Describe the changes required before sending the document back.');
      }
      const status = action === 'approve' ? WorkflowStatus.APPROVED : WorkflowStatus.REJECTED;
      const updated = await tx.document.update({ where: { id }, data: { status, ...(action === 'approve' ? { approvedById: actor.userId, approvedAt: now } : {}) } });
      const eventAction = action === 'request-changes' ? 'REQUEST_CHANGES' : action.toUpperCase();
      await tx.approvalEvent.create({ data: { tenantId: actor.tenantId, entityType: 'DOCUMENT', entityId: id, action: eventAction, actorId: actor.userId, comment: comment || null } });
      await this.audit(tx, actor, eventAction, 'DOCUMENT', id, { approvalReference: updated.number, comment: comment || null });
      return this.documentForActor(actor, updated);
    });
  }

  async commentDocument(actor: Actor, id: bigint, body: any = {}) {
    return this.withTenant(actor, async (tx) => {
      const document = await this.documentInScope(tx, actor, id);
      if (!document) throw new NotFoundException('Document not found');
      this.requireAtBranch(actor, 'approvals.queue.history', document.branchId);
      this.assertBranch(actor, document.branchId);
      if (document.status !== WorkflowStatus.SUBMITTED) throw new BadRequestException('Comments can only be added while a document is awaiting approval.');
      const comment = String(body.comment || '').trim();
      if (!comment) throw new BadRequestException('A comment is required.');
      const event = await tx.approvalEvent.create({
        data: { tenantId: actor.tenantId, entityType: 'DOCUMENT', entityId: id, action: 'COMMENT', actorId: actor.userId, comment },
        include: { actor: { select: { id: true, name: true, email: true } } },
      });
      await this.audit(tx, actor, 'APPROVAL_COMMENT', 'DOCUMENT', id, { approvalReference: document.number, comment });
      return projectRecord(actor, 'approval', event);
    });
  }

  async postDocument(actor: Actor, id: bigint) {
    return this.withTenant(actor, async (tx) => {
      const visible = await this.documentInScope(tx, actor, id);
      if (!visible) throw new NotFoundException('Document not found');
      this.requireDocumentPermission(actor, visible.type, 'post', visible.branchId);
      this.assertBranch(actor, visible.branchId); this.assertWarehouse(actor, visible.warehouseId);
      const lockedTarget = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM documents WHERE id = ${id} FOR UPDATE
      `;
      if (!lockedTarget.length) throw new NotFoundException('Document not found');
      const doc = await this.documentInScope(tx, actor, id, { lines: { include: { item: true } }, sourceDocument: true, destinationWarehouse: true });
      if (!doc) throw new NotFoundException('Document not found');
      if (doc.status !== WorkflowStatus.APPROVED) throw new BadRequestException('Only an approved document can be posted');
      await this.assertOpenPeriod(tx, actor, doc.documentDate);
      if (doc.type === DocumentType.PURCHASE_RETURN && doc.sourceDocumentId && doc.sourceDocument?.type === DocumentType.PURCHASE_BILL) {
        const lockedSource = await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT id FROM documents WHERE id = ${doc.sourceDocumentId} FOR UPDATE
        `;
        if (!lockedSource.length) throw new BadRequestException('PURCHASE_RETURN must reference a posted purchase bill.');
        const sourceBill = await tx.document.findUnique({ where: { id: doc.sourceDocumentId } });
        if (!sourceBill || sourceBill.type !== DocumentType.PURCHASE_BILL || sourceBill.status !== WorkflowStatus.POSTED
          || sourceBill.supplierId !== doc.supplierId || sourceBill.currency !== doc.currency
          || sourceBill.exchangeRateMicros !== doc.exchangeRateMicros) {
          throw new BadRequestException('PURCHASE_RETURN must preserve its posted purchase bill supplier, currency, and exchange rate.');
        }
        const [settlement] = await this.purchaseBillSettlementDocuments(tx, [sourceBill]);
        if (doc.totalMinor > settlement.remainingMinor) {
          throw new BadRequestException(
            `PURCHASE_RETURN ${doc.number} exceeds the remaining payable for ${sourceBill.number}. `
            + `Available ${settlement.remainingMinor.toString()} minor units; requested ${doc.totalMinor.toString()}. `
            + 'Supplier debit balances require an explicit refund workflow.',
          );
        }
      }
      if ((doc.type === DocumentType.SALES_RETURN || doc.type === DocumentType.CREDIT_NOTE) && doc.sourceDocumentId) {
        const lockedSource = await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT id FROM documents WHERE id = ${doc.sourceDocumentId} FOR UPDATE
        `;
        if (!lockedSource.length) throw new BadRequestException(`${doc.type} must reference a posted sales invoice.`);
      }
      await this.receivables.assertCreditWithinRemaining(tx, doc);
      let journal: any = null;
      let cost = 0n;
      const journalLines: JournalLineInput[] = [];
      if (doc.type === DocumentType.DELIVERY_NOTE) {
        for (const line of doc.lines) {
          const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'OUT', date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
          cost += movement.totalCostMinor;
          await tx.documentLine.update({ where: { id: line.id }, data: { unitCostMinor: movement.unitCostMinor, costMinor: movement.totalCostMinor } });
        }
        journalLines.push({ code: '5000', debit: cost, description: `COGS ${doc.number}` }, { code: '1200', credit: cost, description: `Inventory issue ${doc.number}` });
      } else if (doc.type === DocumentType.SALES_INVOICE) {
        const amounts = receivableJournalAmounts(doc.totalMinor, doc.taxMinor, doc.exchangeRateMicros);
        journalLines.push({ code: '1100', debit: amounts.receivableMinor, description: `Customer receivable ${doc.number}` }, { code: '4000', credit: amounts.revenueBaseMinor, description: `Revenue ${doc.number}` });
        if (amounts.taxBaseMinor) journalLines.push({ code: '2200', credit: amounts.taxBaseMinor, description: `Output VAT ${doc.number}` });
      } else if (doc.type === DocumentType.SALES_RETURN || doc.type === DocumentType.CREDIT_NOTE) {
        const amounts = receivableJournalAmounts(doc.totalMinor, doc.taxMinor, doc.exchangeRateMicros);
        journalLines.push({ code: '4000', debit: amounts.revenueBaseMinor, description: `Sales reversal ${doc.number}` });
        if (amounts.taxBaseMinor) journalLines.push({ code: '2200', debit: amounts.taxBaseMinor, description: `Output VAT reversal ${doc.number}` });
        journalLines.push({ code: '1100', credit: amounts.receivableMinor, description: `Customer credit ${doc.number}` });
        if (doc.type === DocumentType.SALES_RETURN) {
          for (const line of doc.lines) {
            const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'IN', unitCostMinor: line.unitCostMinor || line.item.purchasePriceMinor, date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
            cost += movement.totalCostMinor;
          }
          journalLines.push({ code: '1200', debit: cost, description: `Returned inventory ${doc.number}` }, { code: '5000', credit: cost, description: `COGS reversal ${doc.number}` });
        }
      } else if (doc.type === DocumentType.GOODS_RECEIPT) {
        for (const line of doc.lines) {
          const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'IN', unitCostMinor: line.unitCostMinor || line.item.purchasePriceMinor, date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
          cost += movement.totalCostMinor;
          await tx.documentLine.update({ where: { id: line.id }, data: { unitCostMinor: movement.unitCostMinor, costMinor: movement.totalCostMinor } });
        }
        journalLines.push({ code: '1200', debit: cost, description: `Inventory receipt ${doc.number}` }, { code: '2100', credit: cost, description: `Goods received not invoiced ${doc.number}` });
      } else if (doc.type === DocumentType.PURCHASE_BILL) {
        journalLines.push({ code: '2100', debit: BigInt(doc.subtotalMinor) - BigInt(doc.discountMinor), description: `Clear GRNI ${doc.number}` });
        if (doc.taxMinor) journalLines.push({ code: '1300', debit: BigInt(doc.taxMinor), description: `Recoverable VAT ${doc.number}` });
        journalLines.push({ code: '2000', credit: BigInt(doc.totalMinor), description: `Supplier payable ${doc.number}` });
      } else if (doc.type === DocumentType.PURCHASE_RETURN) {
        for (const line of doc.lines) {
          const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'OUT', date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
          cost += movement.totalCostMinor;
        }
        if (doc.sourceDocument?.type === DocumentType.PURCHASE_BILL) {
          journalLines.push({ code: '2000', debit: BigInt(doc.totalMinor), description: `Supplier debit ${doc.number}` });
          if (doc.taxMinor) journalLines.push({ code: '1300', credit: BigInt(doc.taxMinor), description: `VAT reversal ${doc.number}` });
          journalLines.push({ code: '1200', credit: cost, description: `Inventory return ${doc.number}` });
          const variance = BigInt(doc.totalMinor) - BigInt(doc.taxMinor) - cost;
          if (variance > 0n) journalLines.push({ code: '5100', credit: variance, description: `Purchase return price variance ${doc.number}` });
          if (variance < 0n) journalLines.push({ code: '5100', debit: -variance, description: `Purchase return price variance ${doc.number}` });
        } else journalLines.push({ code: '2100', debit: cost, description: `Reverse GRNI ${doc.number}` }, { code: '1200', credit: cost, description: `Inventory return ${doc.number}` });
      } else if (doc.type === DocumentType.WAREHOUSE_TRANSFER) {
        for (const line of doc.lines) {
          const issue = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'OUT', date: doc.documentDate, sourceType: `${doc.type}_OUT`, sourceId: doc.id, sourceNumber: doc.number });
          await this.stock(tx, actor, { branchId: doc.destinationWarehouse!.branchId, warehouseId: doc.destinationWarehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'IN', unitCostMinor: issue.unitCostMinor, date: doc.documentDate, sourceType: `${doc.type}_IN`, sourceId: doc.id, sourceNumber: doc.number });
          cost += issue.totalCostMinor;
        }
      } else if (doc.type === DocumentType.INVENTORY_ADJUSTMENT || doc.type === DocumentType.STOCK_COUNT) {
        for (const line of doc.lines) {
          const direction = line.description?.toLowerCase().includes('decrease') ? 'OUT' : 'IN';
          const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction, unitCostMinor: line.unitCostMinor || line.item.purchasePriceMinor, date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
          cost += movement.totalCostMinor;
          journalLines.push(direction === 'IN' ? { code: '1200', debit: movement.totalCostMinor, description: `Inventory gain ${doc.number}` } : { code: '5100', debit: movement.totalCostMinor, description: `Inventory loss ${doc.number}` });
          journalLines.push(direction === 'IN' ? { code: '5100', credit: movement.totalCostMinor, description: `Inventory gain ${doc.number}` } : { code: '1200', credit: movement.totalCostMinor, description: `Inventory loss ${doc.number}` });
        }
      }
      if (journalLines.length) journal = await this.postedJournal(tx, actor, { branchId: doc.branchId, date: doc.documentDate, description: `${doc.type} ${doc.number}`, module: SALES_TYPES.has(doc.type) ? 'SALES' : PURCHASE_TYPES.has(doc.type) ? 'PURCHASING' : 'INVENTORY', sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number, lines: journalLines });
      const updated = await tx.document.update({ where: { id }, data: { status: WorkflowStatus.POSTED, postedById: actor.userId, postedAt: new Date(), costMinor: cost, journalEntryId: journal?.id || null } });
      await this.audit(tx, actor, 'POST', 'DOCUMENT', id, { postingReference: journal?.number || 'NO_GL', documentNumber: doc.number, costMinor: cost.toString() });
      return this.documentForActor(actor, { ...updated, journal: journal ? this.journalForActor(actor, journal) : null, accountingEffect: journal ? `Journal ${journal.number}` : 'No GL impact; operational document only' });
    });
  }

  private plannedPaymentAllocations(raw: unknown, expectedAmountMinor: bigint): PlannedPaymentAllocation[] {
    if (!Array.isArray(raw) || !raw.length) throw new BadRequestException('At least one invoice or bill allocation is required');
    const seen = new Set<string>();
    const plan = raw.map((candidate: any) => {
      const documentIdText = String(candidate?.documentId || '').trim();
      if (!/^[1-9]\d*$/.test(documentIdText)) throw new BadRequestException('Every allocation must contain a valid document ID');
      if (seen.has(documentIdText)) throw new BadRequestException('A document can only appear once in a payment allocation');
      seen.add(documentIdText);
      let amountMinor: bigint;
      if (candidate?.amountMinor !== undefined) {
        const amountText = String(candidate.amountMinor).trim();
        if (!/^[1-9]\d*$/.test(amountText)) throw new BadRequestException('Saved allocation amount is invalid');
        amountMinor = BigInt(amountText);
      } else {
        amountMinor = money(candidate?.amount, 'allocation amount');
      }
      if (amountMinor <= 0n) throw new BadRequestException('Allocation amount must be greater than zero');
      return { documentId: BigInt(documentIdText), amountMinor };
    });
    if (plan.reduce((sum, row) => sum + row.amountMinor, 0n) !== expectedAmountMinor) {
      throw new BadRequestException('Allocated amount must exactly equal the receipt or payment total');
    }
    return plan;
  }

  private async purchaseBillSettlementDocuments<T extends { id: bigint; totalMinor: bigint; paidMinor: bigint }>(tx: Tx, documents: T[]) {
    if (!documents.length) return [] as Array<T & { returnedMinor: bigint; netPayableMinor: bigint; remainingMinor: bigint }>;
    const returns = await tx.document.findMany({
      where: {
        type: DocumentType.PURCHASE_RETURN,
        status: WorkflowStatus.POSTED,
        sourceDocumentId: { in: documents.map(({ id }) => id) },
      },
      select: { sourceDocumentId: true, totalMinor: true },
    });
    const returnedByBill = new Map<string, bigint>();
    for (const purchaseReturn of returns) {
      if (!purchaseReturn.sourceDocumentId) continue;
      const key = purchaseReturn.sourceDocumentId.toString();
      returnedByBill.set(key, (returnedByBill.get(key) || 0n) + purchaseReturn.totalMinor);
    }
    return documents.map((document) => {
      const returnedMinor = returnedByBill.get(document.id.toString()) || 0n;
      const netPayableMinor = document.totalMinor - returnedMinor;
      return { ...document, returnedMinor, netPayableMinor, remainingMinor: netPayableMinor - document.paidMinor };
    });
  }

  private async visiblePaymentAllocations(
    tx: Tx,
    actor: Actor,
    kind: PaymentKind,
    paymentBranchId: bigint,
    rawAllocations: any,
  ) {
    if (!Array.isArray(rawAllocations) || !rawAllocations.length) return [];
    const allocations = rawAllocations.flatMap((allocation: any) => {
      try {
        const documentId = BigInt(allocation.documentId);
        return documentId > 0n ? [{ ...allocation, documentId }] : [];
      } catch {
        return [];
      }
    });
    if (!allocations.length) return [];
    const receipt = kind === PaymentKind.RECEIPT;
    const permission = receipt ? 'sales.invoice.view' : 'purchasing.bill.view';
    const resource = receipt ? 'invoice' : 'bill';
    const module = receipt ? 'sales' : 'purchasing';
    const documentType = receipt ? DocumentType.SALES_INVOICE : DocumentType.PURCHASE_BILL;
    const permittedBranches = this.branchesForPermissions(actor, [permission]);
    if (!can(actor, 'system.super_admin') && !permittedBranches.length) return [];
    const documents = await tx.document.findMany({
      where: {
        id: { in: allocations.map(({ documentId }: { documentId: bigint }) => documentId) },
        type: documentType,
        branchId: paymentBranchId,
        AND: [
          this.documentScope(actor, resource, module),
          can(actor, 'system.super_admin') ? {} : { branchId: { in: permittedBranches } },
        ],
      },
    });
    const settledDocuments = receipt
      ? await this.receivables.decorateInvoices(tx, documents)
      : await this.purchaseBillSettlementDocuments(tx, documents);
    const visibleById = new Map(settledDocuments.map((document) => [document.id.toString(), document]));
    return allocations.flatMap((allocation: any) => {
      const document = visibleById.get(allocation.documentId.toString());
      return document ? [{ ...allocation, document }] : [];
    });
  }

  private async paymentWithVisibleDocuments(tx: Tx, actor: Actor, payment: any) {
    const visible: any = {
      ...payment,
      allocations: await this.visiblePaymentAllocations(tx, actor, payment.kind, payment.branchId, payment.allocations),
    };
    if (Array.isArray(payment.plannedAllocations)) {
      visible.plannedAllocations = await this.visiblePaymentAllocations(tx, actor, payment.kind, payment.branchId, payment.plannedAllocations);
    }
    return this.paymentForActor(actor, visible);
  }

  private async paymentDocuments(
    tx: Tx,
    actor: Actor,
    kind: PaymentKind,
    branchId: bigint,
    currency: string,
    plan: PlannedPaymentAllocation[],
    validateOutstanding = true,
  ) {
    const documentType = kind === PaymentKind.RECEIPT ? DocumentType.SALES_INVOICE : DocumentType.PURCHASE_BILL;
    const permission = kind === PaymentKind.RECEIPT ? 'sales.invoice.view' : 'purchasing.bill.view';
    const resource = kind === PaymentKind.RECEIPT ? 'invoice' : 'bill';
    const module = kind === PaymentKind.RECEIPT ? 'sales' : 'purchasing';
    this.requireAtBranch(actor, permission, branchId);
    const documentIds = plan.map(({ documentId }) => documentId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM documents WHERE id IN (${Prisma.join(documentIds)}) ORDER BY id FOR UPDATE`);
    const documents = await tx.document.findMany({ where: {
      id: { in: documentIds }, branchId, type: documentType, status: WorkflowStatus.POSTED,
      AND: [this.documentScope(actor, resource, module)],
    } });
    if (documents.length !== documentIds.length) {
      throw new ForbiddenException('One or more allocations are not posted or are outside your company, branch, or data scope.');
    }
    const partyId = kind === PaymentKind.RECEIPT ? documents[0].customerId : documents[0].supplierId;
    if (!partyId || documents.some((document) => (kind === PaymentKind.RECEIPT ? document.customerId : document.supplierId) !== partyId)) {
      throw new BadRequestException('All allocations on one payment must belong to the same customer or supplier.');
    }
    if (documents.some((document) => document.currency !== currency)) {
      throw new BadRequestException(`Use a ${documents[0].currency} bank account for these allocations.`);
    }
    const invoiceSettlements = kind === PaymentKind.RECEIPT && validateOutstanding
      ? await this.receivables.settlements(tx, documents)
      : new Map<string, { remainingMinor: bigint }>();
    const settledDocuments: Array<(typeof documents)[number] & { returnedMinor?: bigint; netPayableMinor?: bigint; remainingMinor?: bigint }> = kind === PaymentKind.PAYMENT
      ? await this.purchaseBillSettlementDocuments(tx, documents)
      : documents;
    const documentMap = new Map(settledDocuments.map((document) => [document.id.toString(), document]));
    for (const allocation of plan) {
      const document = documentMap.get(allocation.documentId.toString())!;
      const remainingMinor = kind === PaymentKind.RECEIPT
        ? invoiceSettlements.get(document.id.toString())?.remainingMinor ?? document.totalMinor - document.paidMinor
        : document.remainingMinor!;
      if (validateOutstanding && allocation.amountMinor > remainingMinor) {
        throw new BadRequestException(`Allocation exceeds net outstanding amount for ${document.number}`);
      }
    }
    const baseAmount = plan.reduce((sum, allocation) => {
      const document = documentMap.get(allocation.documentId.toString())!;
      return sum + receivableBaseMinor(allocation.amountMinor, document.exchangeRateMicros);
    }, 0n);
    return { documents: settledDocuments, partyId, baseAmount };
  }

  async payments(actor: Actor) {
    const permissions = ['payments.receipt.view', 'payments.payment.view'];
    const receiptBranches = this.branchesForPermissions(actor, ['payments.receipt.view']);
    const paymentBranches = this.branchesForPermissions(actor, ['payments.payment.view']);
    if (!can(actor, 'system.super_admin') && !receiptBranches.length && !paymentBranches.length) this.requireAny(actor, ...permissions);
    return this.withTenant(actor, async (tx) => {
      const payments = await tx.payment.findMany({ where: { AND: [
        this.paymentScope(actor),
        can(actor, 'system.super_admin') ? {} : { OR: [
          { kind: PaymentKind.RECEIPT, branchId: { in: receiptBranches } },
          { kind: PaymentKind.PAYMENT, branchId: { in: paymentBranches } },
        ] },
        { bankAccount: this.resourceIdScope(actor, 'bank_account') },
      ] }, include: {
        customer: true, supplier: true, bankAccount: true, journalEntry: true,
        createdBy: publicUser, approvedBy: publicUser, rejectedBy: publicUser,
        allocations: true,
      }, orderBy: { createdAt: 'desc' }, take: 200 });
      return Promise.all(payments.map(async (payment) => {
        let plannedAllocations: Array<{ documentId: bigint; amountMinor: bigint }> = [];
        if (payment.kind === PaymentKind.PAYMENT && payment.status === PaymentStatus.SUBMITTED) {
          try {
            plannedAllocations = this.plannedPaymentAllocations(payment.allocationPlan, payment.amountMinor);
          } catch {
            plannedAllocations = [];
          }
        }
        return this.paymentWithVisibleDocuments(tx, actor, { ...payment, plannedAllocations });
      }));
    });
  }

  async createPayment(actor: Actor, body: any) {
    return this.withTenant(actor, async (tx) => {
      const kind = body.kind as PaymentKind;
      if (!Object.values(PaymentKind).includes(kind)) throw new BadRequestException('Payment kind is invalid');
      if (!can(actor, 'system.super_admin') && this.scope(actor, 'payment') === 'NONE') {
        throw new ForbiddenException('Payment creation is outside your data scope');
      }
      const branchId = BigInt(body.branchId || 0);
      const companyId = this.requireAtBranch(actor, kind === PaymentKind.PAYMENT ? 'payments.payment.create' : 'payments.receipt.create', branchId);
      const bankAccountId = BigInt(body.bankAccountId || 0);
      this.assertResourceId(actor, 'bank_account', bankAccountId, companyId);
      const bank = await tx.bankAccount.findFirst({
        where: { id: bankAccountId, active: true, ...this.resourceIdScope(actor, 'bank_account', companyId) },
        include: { glAccount: true },
      });
      if (!bank) throw new BadRequestException('Cash or bank account is invalid');
      const date = this.date(body.postingDate || new Date().toISOString().slice(0, 10), 'posting date');
      await this.assertOpenPeriod(tx, actor, date);
      const amount = money(body.amount, 'amount');
      if (amount <= 0n) throw new BadRequestException('Amount must be greater than zero');
      const method = body.method ? body.method as PaymentMethod : PaymentMethod.BANK;
      if (!Object.values(PaymentMethod).includes(method)) throw new BadRequestException('Payment method is invalid');
      const plan = this.plannedPaymentAllocations(body.allocations, amount);
      const { documents, partyId, baseAmount } = await this.paymentDocuments(tx, actor, kind, branchId, bank.currency, plan);
      const number = await this.sequence(tx, actor, branchId, kind, date);
      const allocationPlan = plan.map(({ documentId, amountMinor }) => ({
        documentId: documentId.toString(), amountMinor: amountMinor.toString(),
      })) as Prisma.InputJsonValue;
      const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT nextval(pg_get_serial_sequence('payments', 'id'))::bigint AS id`;

      if (kind === PaymentKind.PAYMENT) {
        const payment = await tx.payment.create({ data: {
          id, tenantId: actor.tenantId, branchId, kind, status: PaymentStatus.SUBMITTED, partyType: 'SUPPLIER',
          supplierId: partyId, bankAccountId, number, postingDate: date, amountMinor: amount, method,
          reference: body.reference || null, allocationPlan, createdById: actor.userId,
        }, include: {
          customer: true, supplier: true, bankAccount: true, journalEntry: true,
          createdBy: publicUser, approvedBy: publicUser, rejectedBy: publicUser,
          allocations: true,
        } });
        const comment = String(body.comment || '').trim();
        await tx.approvalEvent.create({ data: {
          tenantId: actor.tenantId, entityType: 'PAYMENT', entityId: payment.id, action: 'SUBMIT',
          actorId: actor.userId, comment: comment || null,
        } });
        await this.audit(tx, actor, 'SUBMIT', 'PAYMENT', payment.id, {
          approvalReference: number, amountMinor: amount.toString(),
          allocationDocumentIds: plan.map(({ documentId }) => documentId.toString()),
        });
        const byId = new Map(documents.map((document) => [document.id.toString(), document]));
        return this.paymentWithVisibleDocuments(tx, actor, { ...payment, plannedAllocations: plan.map(({ documentId, amountMinor }) => ({
          documentId, amountMinor, document: byId.get(documentId.toString())!,
        })) });
      }

      await this.governance.enforceAuthorityLimit(tx, actor, {
        companyId, branchId, key: 'payments.receipt_amount_minor', currency: bank.currency, amountMinor: amount,
      });
      const journal = await this.postedJournal(tx, actor, {
        branchId, date, description: `${kind} ${number}`, module: 'BANKING', sourceType: kind, sourceId: id, sourceNumber: number,
        lines: [
          { code: bank.glAccount.code, debit: baseAmount, description: `Funds received ${number}` },
          { code: '1100', credit: baseAmount, description: `Settle receivable ${number}` },
        ],
      });
      const payment = await tx.payment.create({ data: {
        id, tenantId: actor.tenantId, branchId, kind, status: PaymentStatus.POSTED, partyType: 'CUSTOMER',
        customerId: partyId, bankAccountId, number, postingDate: date, amountMinor: amount, method,
        reference: body.reference || null, allocationPlan, journalEntryId: journal.id, createdById: actor.userId,
        allocations: { create: plan.map(({ documentId, amountMinor }) => ({ tenantId: actor.tenantId, documentId, amountMinor })) },
      }, include: {
        customer: true, supplier: true, bankAccount: true, journalEntry: true,
        createdBy: publicUser, approvedBy: publicUser, rejectedBy: publicUser,
        allocations: true,
      } });
      for (const allocation of plan) {
        await tx.document.update({ where: { id: allocation.documentId }, data: { paidMinor: { increment: allocation.amountMinor } } });
      }
      await this.audit(tx, actor, 'POST', 'PAYMENT', payment.id, {
        postingReference: journal.number, number, amountMinor: amount.toString(),
      });
      return this.paymentWithVisibleDocuments(tx, actor, payment);
    });
  }

  async paymentWorkflow(actor: Actor, id: bigint, action: 'approve' | 'reject', body: any = {}) {
    return this.withTenant(actor, async (tx) => {
      const visible = await tx.payment.findFirst({ where: { AND: [{ id }, this.paymentScope(actor)] }, select: { id: true } });
      if (!visible) throw new NotFoundException('Payment not found');
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM payments WHERE id = ${id} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Payment not found');
      const payment = await tx.payment.findFirst({
        where: { AND: [{ id }, this.paymentScope(actor)] },
        include: { bankAccount: { include: { glAccount: true } } },
      });
      if (!payment || payment.kind !== PaymentKind.PAYMENT) throw new NotFoundException('Outgoing payment not found');
      const permission = action === 'approve' ? 'payments.payment.approve' : 'payments.payment.reject';
      const companyId = this.requireAtBranch(actor, permission, payment.branchId);
      if (payment.status !== PaymentStatus.SUBMITTED) throw new BadRequestException('Only a submitted outgoing payment can be approved or rejected');
      if (payment.createdById === actor.userId) throw new ForbiddenException('Maker-checker control: payment maker cannot approve or reject their own payment');
      this.assertResourceId(actor, 'bank_account', payment.bankAccountId, companyId);
      const bank = await tx.bankAccount.findFirst({
        where: { id: payment.bankAccountId, active: true, ...this.resourceIdScope(actor, 'bank_account', companyId) },
        include: { glAccount: true },
      });
      if (!bank) throw new ForbiddenException('Cash or bank account is outside your active company or resource scope');
      const plan = this.plannedPaymentAllocations(payment.allocationPlan, payment.amountMinor);
      const { baseAmount } = await this.paymentDocuments(tx, actor, PaymentKind.PAYMENT, payment.branchId, bank.currency, plan, action === 'approve');
      const comment = String(body.comment || '').trim();

      if (action === 'reject') {
        if (comment.length < 3) throw new BadRequestException('A rejection reason of at least 3 characters is required.');
        const rejected = await tx.payment.update({ where: { id }, data: {
          status: PaymentStatus.REJECTED, rejectedById: actor.userId, rejectedAt: new Date(), decisionComment: comment,
        }, include: {
          customer: true, supplier: true, bankAccount: true, journalEntry: true,
          createdBy: publicUser, approvedBy: publicUser, rejectedBy: publicUser,
          allocations: true,
        } });
        await tx.approvalEvent.create({ data: {
          tenantId: actor.tenantId, entityType: 'PAYMENT', entityId: id, action: 'REJECT', actorId: actor.userId, comment,
        } });
        await this.audit(tx, actor, 'REJECT', 'PAYMENT', id, { approvalReference: payment.number, comment });
        return this.paymentWithVisibleDocuments(tx, actor, rejected);
      }

      await this.governance.enforceAuthorityLimit(tx, actor, {
        companyId, branchId: payment.branchId, key: 'payments.payment_amount_minor',
        currency: bank.currency, amountMinor: payment.amountMinor,
      });
      const journal = await this.postedJournal(tx, actor, {
        branchId: payment.branchId, date: payment.postingDate, description: `${payment.kind} ${payment.number}`,
        module: 'BANKING', sourceType: payment.kind, sourceId: payment.id, sourceNumber: payment.number,
        lines: [
          { code: '2000', debit: baseAmount, description: `Settle payable ${payment.number}` },
          { code: bank.glAccount.code, credit: baseAmount, description: `Funds paid ${payment.number}` },
        ],
      });
      await tx.paymentAllocation.createMany({ data: plan.map(({ documentId, amountMinor }) => ({
        tenantId: actor.tenantId, paymentId: payment.id, documentId, amountMinor,
      })) });
      for (const allocation of plan) {
        await tx.document.update({ where: { id: allocation.documentId }, data: { paidMinor: { increment: allocation.amountMinor } } });
      }
      const approved = await tx.payment.update({ where: { id }, data: {
        status: PaymentStatus.POSTED, journalEntryId: journal.id, approvedById: actor.userId,
        approvedAt: new Date(), decisionComment: comment || null,
      }, include: {
        customer: true, supplier: true, bankAccount: true, journalEntry: true,
        createdBy: publicUser, approvedBy: publicUser, rejectedBy: publicUser,
        allocations: true,
      } });
      await tx.approvalEvent.create({ data: {
        tenantId: actor.tenantId, entityType: 'PAYMENT', entityId: id, action: 'APPROVE', actorId: actor.userId,
        comment: comment || null,
      } });
      await this.audit(tx, actor, 'APPROVE', 'PAYMENT', id, {
        approvalReference: payment.number, postingReference: journal.number,
        amountMinor: payment.amountMinor.toString(), comment: comment || null,
      });
      return this.paymentWithVisibleDocuments(tx, actor, approved);
    });
  }

  private async nextAccountingCode(tx: Tx, actor: Actor, companyId: bigint, type: AccountType, parentCode?: string | null) {
    const prefix = accountCodePrefix(type, parentCode);
    const accounts = await tx.account.findMany({ where: { tenantId: actor.tenantId, code: { startsWith: prefix } }, select: { code: true } });
    const resources = await tx.financialResource.findMany({ where: { tenantId: actor.tenantId, companyId, type: FinancialResourceType.GL_ACCOUNT, code: { startsWith: prefix } }, select: { code: true } });
    return nextAvailableAccountCode([...accounts.map((account) => account.code), ...resources.map((resource) => resource.code)], prefix);
  }

  async suggestedAccountingAccountCode(actor: Actor, query: any) {
    const companyId = BigInt(accountingFilters({ accountId: query.companyId }).accountId || 0);
    if (!companyId) throw new BadRequestException('Company is required.');
    if (!can(actor, 'system.super_admin') && !actor.companyIds.includes(companyId.toString())) throw new ForbiddenException('Company is outside your active memberships.');
    requirePermissionAtCompany(actor, 'accounting.account.create', companyId);
    if (this.scope(actor, 'account') === 'NONE') throw new ForbiddenException('Accounts are outside your access scope.');
    const type = String(query.type || '') as AccountType;
    if (!Object.values(AccountType).includes(type)) throw new BadRequestException('Account type is invalid.');
    return this.withTenant(actor, async (tx) => {
      if (!await tx.company.findFirst({ where: { id: companyId, active: true } })) throw new BadRequestException('Company is invalid.');
      const parentId = query.parentId ? BigInt(accountingFilters({ accountId: query.parentId }).accountId) : null;
      const parent = parentId ? await tx.account.findFirst({ where: { id: parentId, active: true, ...this.resourceIdScope(actor, 'account') }, include: { financialResources: true } }) : null;
      if (parentId && (!parent || !parent.financialResources.some((resource) => resource.companyId === companyId && resource.active))) throw new BadRequestException('Parent account must be active and available in the selected company.');
      if (parent && parent.type !== type) throw new BadRequestException('Parent and child accounts must have the same account type.');
      return { code: await this.nextAccountingCode(tx, actor, companyId, type, parent?.code), provisional: true };
    });
  }

  async accountingAccounts(actor: Actor, query: any = {}) {
    const companies = this.companiesForPermissions(actor, ['accounting.account.view']);
    if (!can(actor, 'system.super_admin') && !companies.length) throw new ForbiddenException('Account view permission is required in an assigned company.');
    const companyId = query.companyId ? BigInt(accountingFilters({ accountId: query.companyId }).accountId) : null;
    if (companyId && !can(actor, 'system.super_admin') && !companies.includes(companyId)) throw new ForbiddenException('Company is outside your access scope.');
    return this.withTenant(actor, async (tx) => {
      const companyRows = await tx.company.findMany({ where: { active: true, ...(can(actor, 'system.super_admin') ? {} : { id: { in: companies } }) }, select: { id: true, name: true, baseCurrency: true }, orderBy: { name: 'asc' } });
      const rows = await tx.account.findMany({ where: {
        ...(query.includeInactive === 'true' ? {} : { active: true }),
        AND: [this.resourceIdScope(actor, 'account', companyId || undefined), { financialResources: { some: { companyId: { in: companyId ? [companyId] : companyRows.map((company) => company.id) }, active: true } } }],
      }, include: { financialResources: { select: { companyId: true } }, _count: { select: { journalLines: true, children: true, bankAccounts: true, bankCounterparties: true } } }, orderBy: { code: 'asc' } });
      const visible = new Set(rows.map((account) => account.id.toString()));
      return { rows: rows.map(({ financialResources, _count, ...account }) => ({ ...account, parentId: account.parentId && visible.has(account.parentId.toString()) ? account.parentId : null, hasActivity: _count.journalLines > 0, hasChildren: _count.children > 0, linkedBank: _count.bankAccounts > 0 || _count.bankCounterparties > 0, companyIds: financialResources.filter((resource) => companyRows.some((company) => company.id === resource.companyId)).map((resource) => resource.companyId), editable: financialResources.every((resource) => (can(actor, 'system.super_admin') || actor.companyIds.includes(resource.companyId.toString())) && canAtCompany(actor, 'accounting.account.edit', resource.companyId)) })), companies: companyRows };
    });
  }

  async saveAccountingAccount(actor: Actor, accountId: bigint | null, body: any) {
    const permission = accountId ? 'accounting.account.edit' : 'accounting.account.create';
    const autoCode = !accountId && body.autoCode === true;
    if (body.autoCode !== undefined && typeof body.autoCode !== 'boolean') throw new BadRequestException('autoCode must be true or false.');
    if (accountId && body.autoCode) throw new BadRequestException('An existing account code cannot be automatically changed.');
    const save = () => this.withTenant(actor, async (tx) => {
      const original = accountId ? await tx.account.findFirst({ where: { id: accountId, ...this.resourceIdScope(actor, 'account') }, include: { financialResources: true, _count: { select: { journalLines: true, children: true, bankAccounts: true, bankCounterparties: true } } } }) : null;
      if (accountId && !original) throw new NotFoundException('Account not found.');
      const companyIds = original ? original.financialResources.map((resource) => resource.companyId) : [BigInt(accountingFilters({ accountId: body.companyId }).accountId || 0)];
      if (!companyIds.length || companyIds.some((companyId) => companyId === 0n)) throw new BadRequestException('Company is required.');
      for (const companyId of companyIds) {
        if (!can(actor, 'system.super_admin') && !actor.companyIds.includes(companyId.toString())) throw new ForbiddenException('Company is outside your active memberships.');
        requirePermissionAtCompany(actor, permission, companyId);
        if (!await tx.company.findFirst({ where: { id: companyId, active: true } })) throw new BadRequestException('Company is invalid.');
      }
      if (!original && this.scope(actor, 'account') === 'NONE') throw new ForbiddenException('Accounts are outside your access scope.');
      let code = autoCode ? '' : String(body.code ?? original?.code ?? '').trim().toUpperCase();
      const name = this.requiredText(body.name ?? original?.name, 'Account name');
      if (name.length > 160) throw new BadRequestException('Account name must not exceed 160 characters.');
      const type = String(body.type ?? original?.type ?? '') as AccountType;
      if (!Object.values(AccountType).includes(type)) throw new BadRequestException('Account type is invalid.');
      for (const key of ['postingAllowed', 'active']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new BadRequestException(`${key} must be true or false.`);
      if (body.controlType !== undefined && body.controlType !== original?.controlType) throw new BadRequestException('Control account mappings cannot be changed here.');
      const postingAllowed = body.postingAllowed ?? original?.postingAllowed ?? true;
      const active = body.active ?? original?.active ?? true;
      const parentId = body.parentId === undefined ? original?.parentId || null : body.parentId ? BigInt(accountingFilters({ accountId: body.parentId }).accountId) : null;
      let parentCode: string | null = null;
      if (parentId) {
        if (parentId === accountId) throw new BadRequestException('An account cannot be its own parent.');
        const parent = await tx.account.findFirst({ where: { id: parentId, active: true, ...this.resourceIdScope(actor, 'account') }, include: { financialResources: true } });
        if (!parent || companyIds.some((companyId) => !parent.financialResources.some((resource) => resource.companyId === companyId && resource.active))) throw new BadRequestException('Parent account must be active and available in every linked company.');
        if (parent.type !== type) throw new BadRequestException('Parent and child accounts must have the same account type.');
        parentCode = parent.code;
        const visited = new Set<string>(accountId ? [accountId.toString()] : []);
        let ancestor: { id: bigint; parentId: bigint | null } | null = parent;
        while (ancestor) {
          if (visited.has(ancestor.id.toString())) throw new BadRequestException('Account hierarchy cannot contain a cycle.');
          visited.add(ancestor.id.toString());
          ancestor = ancestor.parentId ? await tx.account.findUnique({ where: { id: ancestor.parentId }, select: { id: true, parentId: true } }) : null;
        }
      }
      if (autoCode) {
        // Serialize automatic allocations per tenant. The unique indexes remain the final guard.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`odin-account-code:${actor.tenantId.toString()}`}, 0))`;
        code = await this.nextAccountingCode(tx, actor, companyIds[0], type, parentCode);
      }
      if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code)) throw new BadRequestException('Account code must contain 1 to 40 letters, numbers, dots, dashes, or underscores.');
      if (original) {
        const systemMapping = original.financialResources.some((resource) => ['1000', '1010', '1020', '1100', '1200', '1300', '2000', '2100', '2200', '4000', '5000', '5100', '5200'].includes(resource.code));
        const protectedDefinition = systemMapping || original._count.journalLines > 0 || original._count.bankAccounts > 0 || original._count.bankCounterparties > 0 || Boolean(original.controlType);
        if (protectedDefinition && (code !== original.code || type !== original.type || postingAllowed !== original.postingAllowed)) throw new BadRequestException('An account with activity or a system mapping cannot change code, type, or posting mode.');
        if (original._count.children && (type !== original.type || (!original.postingAllowed && postingAllowed))) throw new BadRequestException('An account with children must retain its type and a non-posting group cannot become posting.');
        if (!active && original.active) {
          if (systemMapping || original.controlType || original._count.bankAccounts || original._count.bankCounterparties) throw new BadRequestException('A system or bank-linked account cannot be deactivated.');
          if (await tx.account.count({ where: { parentId: original.id, active: true } })) throw new BadRequestException('Deactivate active child accounts first.');
          const unposted = await tx.journalLine.count({ where: { accountId: original.id, journalEntry: { status: { in: [JournalStatus.DRAFT, JournalStatus.SUBMITTED, JournalStatus.APPROVED] } } } });
          if (unposted) throw new BadRequestException('Account is used by an unposted journal.');
          const posted = await tx.journalLine.findMany({ where: { accountId: original.id, journalEntry: { status: JournalStatus.POSTED } }, select: { debitMinor: true, creditMinor: true, journalEntry: { select: { branchId: true } } } });
          const branchBalances = new Map<string, bigint>();
          for (const line of posted) { const branch = line.journalEntry.branchId.toString(); branchBalances.set(branch, (branchBalances.get(branch) || 0n) + line.debitMinor - line.creditMinor); }
          if ([...branchBalances.values()].some((balance) => balance !== 0n)) throw new BadRequestException('An account with a non-zero posted balance cannot be deactivated.');
        }
      }
      if (await tx.account.findFirst({ where: { code, ...(accountId ? { id: { not: accountId } } : {}) } })) throw new ConflictException('Account code already exists.');
      const data = { code, name, type, parentId, postingAllowed, active };
      const saved = original ? await tx.account.update({ where: { id: original.id }, data }) : await tx.account.create({ data: { tenantId: actor.tenantId, ...data } });
      if (!original) {
        // The legacy insert trigger maps to DEFAULT. Only this newly-created account's
        // automatic mapping is removed; existing company mappings are never moved.
        await tx.financialResource.deleteMany({ where: { linkedAccountId: saved.id, companyId: { not: companyIds[0] } } });
        const automatic = await tx.financialResource.findFirst({ where: { linkedAccountId: saved.id, companyId: companyIds[0] } });
        if (!automatic) await tx.financialResource.create({ data: { tenantId: actor.tenantId, companyId: companyIds[0], type: FinancialResourceType.GL_ACCOUNT, code, name, linkedAccountId: saved.id } });
      } else {
        await tx.financialResource.updateMany({ where: { linkedAccountId: saved.id, code: original.code }, data: { code, name } });
      }
      await tx.auditEvent.create({ data: { tenantId: actor.tenantId, userId: actor.userId, companyId: companyIds[0].toString(), action: original ? 'UPDATE' : 'CREATE', entityType: 'ACCOUNT', entityId: saved.id.toString(), previousValues: original ? serialize({ code: original.code, name: original.name, type: original.type, parentId: original.parentId, postingAllowed: original.postingAllowed, active: original.active }) as any : undefined, newValues: serialize(data) as any } });
      return saved;
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await save();
      } catch (error: any) {
        const uniqueConflict = error?.code === 'P2002' || (error?.code === 'P2010' && String(error?.meta?.code) === '23505');
        if (autoCode && attempt < 4 && uniqueConflict) continue;
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a unique account code. Please retry.');
  }

  async accountingLedger(actor: Actor, query: any = {}) {
    const branchIds = this.branchesForPermissions(actor, ['accounting.journal.view']);
    if (!can(actor, 'system.super_admin') && !branchIds.length) throw new ForbiddenException('Journal view permission is required in an assigned branch.');
    this.requireFieldView(actor, 'journal', 'lines', 'Journal entry details');
    const filters = accountingFilters(query);
    if (filters.branchId && !can(actor, 'system.super_admin') && !branchIds.some((branchId) => branchId.toString() === filters.branchId)) throw new ForbiddenException('Branch is outside your access scope.');
    return this.withTenant(actor, async (tx) => {
      let scopedBranches = can(actor, 'system.super_admin') ? undefined : branchIds;
      let selectedCompany: { id: bigint; name: string } | null = null;
      if (filters.companyId) {
        if (!can(actor, 'system.super_admin') && !actor.companyIds.includes(filters.companyId)) throw new ForbiddenException('Company is outside your access scope.');
        selectedCompany = await tx.company.findFirst({ where: { id: BigInt(filters.companyId), active: true }, select: { id: true, name: true } });
        if (!selectedCompany) throw new ForbiddenException('Company is outside your access scope.');
        const links = await tx.companyBranch.findMany({ where: { companyId: selectedCompany.id, active: true }, select: { branchId: true } });
        scopedBranches = links.map((link) => link.branchId).filter((branch) => can(actor, 'system.super_admin') || branchIds.includes(branch));
        if (filters.branchId && !scopedBranches.some((branch) => branch.toString() === filters.branchId)) throw new ForbiddenException('Branch is outside the selected company.');
      }
      const companyIds = actor.companyIds.filter((companyId) => (actor.companyBranchIds[companyId] || []).some((branch) => branchIds.some((id) => id.toString() === branch))).map(BigInt);
      const accountScope: Prisma.AccountWhereInput = { AND: [can(actor, 'system.super_admin') ? {} : { AND: [this.resourceIdScope(actor, 'account'), { financialResources: { some: { companyId: { in: companyIds }, active: true } } }] }, ...(selectedCompany ? [{ financialResources: { some: { companyId: selectedCompany.id, active: true } } }] : [])] };
      const accounts = await tx.account.findMany({ where: accountScope, orderBy: { code: 'asc' } });
      const lines = await tx.journalLine.findMany({ where: { account: accountScope, journalEntry: { status: JournalStatus.POSTED, AND: [this.journalScope(actor), ...(scopedBranches ? [{ branchId: { in: scopedBranches } }] : [])] } }, include: { account: true, journalEntry: true } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { baseCurrency: true, name: true } });
      const branch = filters.branchId ? await tx.branch.findUnique({ where: { id: BigInt(filters.branchId) }, select: { name: true } }) : null;
      return { ...buildAccountingReport('general-ledger', accounts, lines, filters, tenant.baseCurrency, true), reportContext: { company: selectedCompany?.name || tenant.name, branch: branch?.name || 'All authorized branches' } };
    });
  }

  async journalDetail(actor: Actor, journalId: bigint) {
    const branchIds = this.branchesForPermissions(actor, ['accounting.journal.view']);
    return this.withTenant(actor, async (tx) => {
      const journal = await tx.journalEntry.findFirst({ where: { id: journalId, AND: [this.journalScope(actor), ...(can(actor, 'system.super_admin') ? [] : [{ branchId: { in: branchIds } }])] }, include: { lines: { include: { account: true } }, branch: true, createdBy: publicUser, submittedBy: publicUser, approvedBy: publicUser, postedBy: publicUser, reversesEntry: { select: { id: true, number: true } }, reversedBy: { select: { id: true, number: true } } } });
      if (!journal) throw new NotFoundException('Journal not found.');
      return this.journalForActor(actor, journal);
    });
  }

  async accountingJournals(actor: Actor, query: any = {}) {
    const filters = accountingFilters(query);
    const branches = this.branchesForPermissions(actor, ['accounting.journal.view']);
    if (!can(actor, 'system.super_admin') && !branches.length) throw new ForbiddenException('Journal view permission is required in an assigned branch.');
    if (filters.branchId && !can(actor, 'system.super_admin') && !branches.some((branch) => branch.toString() === filters.branchId)) throw new ForbiddenException('Branch is outside your access scope.');
    if (query.status && !Object.values(JournalStatus).includes(query.status)) throw new BadRequestException('Journal status is invalid.');
    return this.withTenant(actor, async (tx) => {
      const where: Prisma.JournalEntryWhereInput = { AND: [this.journalScope(actor), ...(can(actor, 'system.super_admin') ? [] : [{ branchId: { in: branches } }]), ...(filters.branchId ? [{ branchId: BigInt(filters.branchId) }] : [])],
        ...(filters.from || filters.to ? { postingDate: { ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}), ...(filters.to ? { lte: new Date(`${filters.to}T00:00:00.000Z`) } : {}) } } : {}),
        ...(query.status ? { status: query.status } : {}), ...(query.sourceType ? { sourceType: String(query.sourceType) } : {}),
        ...(filters.search ? { OR: ['number', 'description', 'sourceNumber'].map((field) => ({ [field]: { contains: filters.search, mode: 'insensitive' } })) } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.journalEntry.findMany({ where, include: { lines: { include: { account: true } }, branch: true, createdBy: publicUser, approvedBy: publicUser, reversesEntry: { select: { id: true, number: true } }, reversedBy: { select: { id: true, number: true } } }, orderBy: [{ postingDate: 'desc' }, { id: 'desc' }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
        tx.journalEntry.count({ where }),
      ]);
      return { rows: rows.map((journal) => this.journalForActor(actor, journal)), pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.max(1, Math.ceil(total / filters.pageSize)) } };
    });
  }

  async journals(actor: Actor) {
    const branchIds = this.branchesForPermissions(actor, ['accounting.journal.view']);
    if (!can(actor, 'system.super_admin') && !branchIds.length) requirePermission(actor, 'accounting.journal.view');
    return this.withTenant(actor, async (tx) => (await tx.journalEntry.findMany({ where: { AND: [this.journalScope(actor), can(actor, 'system.super_admin') ? {} : { branchId: { in: branchIds } }] }, include: { lines: { include: { account: true } }, createdBy: publicUser, approvedBy: publicUser }, orderBy: { createdAt: 'desc' }, take: 200 }))
      .map((journal) => this.journalForActor(actor, journal)));
  }

  private async validateJournalDraft(tx: Tx, actor: Actor, body: any, permission: string) {
      const branchId = BigInt(body.branchId || 0); this.assertBranch(actor, branchId);
      const companyId = this.requireAtBranch(actor, permission, branchId);
      this.requireFieldEdit(actor, 'journal', 'lines', 'Journal entry details');
      const date = this.date(body.postingDate || new Date().toISOString().slice(0, 10), 'posting date');
      await this.assertOpenPeriod(tx, actor, date);
      if (!Array.isArray(body.lines) || body.lines.length < 2) throw new BadRequestException('A journal needs at least two lines');
      const accountIds = body.lines.map((line: any) => BigInt(line.accountId || 0));
      accountIds.forEach((accountId: bigint) => this.assertResourceId(actor, 'account', accountId, companyId));
      const accounts = await tx.account.findMany({ where: { active: true, AND: [{ id: { in: accountIds } }, this.resourceIdScope(actor, 'account', companyId)] } });
      const accountMap = new Map(accounts.map((account) => [account.id.toString(), account]));
      let debit = 0n, credit = 0n;
      const lines = body.lines.map((line: any, index: number) => {
        const account = accountMap.get(String(line.accountId));
        if (!account || !account.postingAllowed) throw new BadRequestException(`Line ${index + 1}: account is invalid`);
        if (account.controlType) throw new BadRequestException(`Manual posting to control account ${account.code} is blocked`);
        const dr = money(line.debit || 0, `line ${index + 1} debit`), cr = money(line.credit || 0, `line ${index + 1} credit`);
        if (dr < 0n || cr < 0n || (dr > 0n) === (cr > 0n)) throw new BadRequestException(`Line ${index + 1}: enter either debit or credit`);
        debit += dr; credit += cr;
        return { tenantId: actor.tenantId, accountId: account.id, description: String(line.description || body.description), debitMinor: dr, creditMinor: cr, costCenter: String(line.costCenter || '').trim() || null };
      });
      if (debit <= 0n || debit !== credit) throw new BadRequestException(`Journal is unbalanced: ${debit} / ${credit}`);
      const costCenterCodes = [...new Set<string>(body.lines.map((line: any) => String(line.costCenter || '').trim()).filter(Boolean))];
      if (costCenterCodes.length) {
        const assignedIds = actor.companyResourceAssignments[companyId.toString()]?.cost_center || [];
        const assigned = await tx.financialResource.count({ where: { id: { in: assignedIds }, companyId, type: FinancialResourceType.COST_CENTER, code: { in: costCenterCodes }, active: true } });
        if (assigned !== costCenterCodes.length) throw new ForbiddenException('One or more journal cost centers are not assigned in this company.');
      }
      return { branchId, date, lines, debit };
  }

  async createJournal(actor: Actor, body: any) {
    return this.withTenant(actor, async (tx) => {
      const { branchId, date, lines, debit } = await this.validateJournalDraft(tx, actor, body, 'accounting.journal.create');
      const number = await this.sequence(tx, actor, branchId, 'JOURNAL', date);
      const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT nextval(pg_get_serial_sequence('journal_entries', 'id'))::bigint AS id`;
      const journal = await tx.journalEntry.create({ data: {
        id, tenantId: actor.tenantId, branchId, number, postingDate: date, description: String(body.description || 'Manual journal'),
        sourceModule: 'GENERAL_LEDGER', sourceType: 'MANUAL', sourceId: id, sourceNumber: number, createdById: actor.userId,
        lines: { create: lines },
      }, include: { lines: true } });
      await this.audit(tx, actor, 'CREATE', 'JOURNAL', id, { number, debitMinor: debit.toString() });
      return this.journalForActor(actor, journal);
    });
  }

  async updateJournal(actor: Actor, id: bigint, body: any) {
    return this.withTenant(actor, async (tx) => {
      const visible = await tx.journalEntry.findFirst({ where: { id, ...this.journalMutationScope(actor, 'accounting.journal.edit') } });
      if (!visible) throw new NotFoundException('Journal not found');
      await tx.$queryRaw`SELECT id FROM journal_entries WHERE id = ${id} FOR UPDATE`;
      const journal = await tx.journalEntry.findFirst({ where: { id, ...this.journalMutationScope(actor, 'accounting.journal.edit') }, include: { lines: true } });
      if (!journal) throw new NotFoundException('Journal not found');
      this.requireAtBranch(actor, 'accounting.journal.edit', journal.branchId);
      if (journal.status !== JournalStatus.DRAFT) throw new BadRequestException('Posted or controlled journals are immutable; create a linked reversal');
      const description = this.requiredText(body.description ?? journal.description, 'Description');
      const hasDetails = body.lines !== undefined || body.postingDate !== undefined || body.branchId !== undefined;
      let details: Awaited<ReturnType<ErpService['validateJournalDraft']>> | undefined;
      if (hasDetails) {
        if (journal.sourceType !== 'MANUAL') throw new BadRequestException('Only manual draft journal details can be edited. Linked reversal lines must preserve the original posting.');
        const decimal = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
        details = await this.validateJournalDraft(tx, actor, {
          description,
          branchId: body.branchId ?? journal.branchId.toString(),
          postingDate: body.postingDate ?? journal.postingDate.toISOString().slice(0, 10),
          lines: body.lines ?? journal.lines.map((line) => ({ accountId: line.accountId.toString(), description: line.description, costCenter: line.costCenter, debit: decimal(line.debitMinor), credit: decimal(line.creditMinor) })),
        }, 'accounting.journal.edit');
      }
      if (details) await tx.journalLine.deleteMany({ where: { journalEntryId: id } });
      const updated = await tx.journalEntry.update({ where: { id }, data: { description, ...(details ? { branchId: details.branchId, postingDate: details.date, lines: { create: details.lines } } : {}) }, include: { lines: { include: { account: true } } } });
      await this.audit(tx, actor, 'UPDATE', 'JOURNAL', id, { number: journal.number, description, ...(details ? { debitMinor: details.debit.toString(), postingDate: details.date.toISOString().slice(0, 10), branchId: details.branchId.toString() } : {}) });
      return this.journalForActor(actor, updated);
    });
  }

  async journalWorkflow(actor: Actor, id: bigint, action: 'submit' | 'approve' | 'reject' | 'post', body: any = {}) {
    return this.withTenant(actor, async (tx) => {
      const permission = action === 'submit' ? 'accounting.journal.edit'
        : action === 'approve' ? 'accounting.journal.approve'
          : action === 'reject' ? 'accounting.journal.reject'
            : 'accounting.journal.post';
      const visible = await tx.journalEntry.findFirst({ where: { id, ...this.journalMutationScope(actor, permission) } });
      if (!visible) throw new NotFoundException('Journal not found');
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM journal_entries WHERE id = ${id} FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('Journal not found');
      const journal = await tx.journalEntry.findFirst({ where: { id, ...this.journalMutationScope(actor, permission) } });
      if (!journal) throw new NotFoundException('Journal not found');
      this.assertBranch(actor, journal.branchId);
      if (action === 'submit') this.requireFieldEdit(actor, 'journal', 'lines', 'Journal entry details');
      else this.requireFieldView(actor, 'journal', 'lines', 'Journal entry details');
      const now = new Date();
      if (action === 'submit') {
        this.requireAtBranch(actor, 'accounting.journal.edit', journal.branchId);
        if (journal.status !== JournalStatus.DRAFT) throw new BadRequestException('Only draft journals can be submitted');
        const updated = await tx.journalEntry.update({ where: { id }, data: { status: JournalStatus.SUBMITTED, submittedById: actor.userId, submittedAt: now } });
        await tx.approvalEvent.create({ data: { tenantId: actor.tenantId, entityType: 'JOURNAL', entityId: id, action: 'SUBMIT', actorId: actor.userId, comment: body.comment || null } });
        await this.audit(tx, actor, 'SUBMIT', 'JOURNAL', id, { approvalReference: journal.number }); return this.journalForActor(actor, updated);
      }
      if (action === 'approve' || action === 'reject') {
        this.requireAtBranch(actor, action === 'approve' ? 'accounting.journal.approve' : 'accounting.journal.reject', journal.branchId);
        if (journal.status !== JournalStatus.SUBMITTED) throw new BadRequestException('Only submitted journals can be approved or rejected');
        if (action === 'approve' && journal.submittedById === actor.userId) throw new ForbiddenException('Maker-checker control: submitter cannot approve this journal');
        const updated = await tx.journalEntry.update({ where: { id }, data: action === 'approve' ? { status: JournalStatus.APPROVED, approvedById: actor.userId, approvedAt: now } : { status: JournalStatus.REJECTED } });
        await tx.approvalEvent.create({ data: { tenantId: actor.tenantId, entityType: 'JOURNAL', entityId: id, action: action.toUpperCase(), actorId: actor.userId, comment: body.comment || null } });
        await this.audit(tx, actor, action.toUpperCase(), 'JOURNAL', id, { approvalReference: journal.number }); return this.journalForActor(actor, updated);
      }
      const companyId = this.requireAtBranch(actor, 'accounting.journal.post', journal.branchId);
      if (journal.status !== JournalStatus.APPROVED) throw new BadRequestException('Only approved journals can be posted');
      const totals = await tx.journalLine.aggregate({ where: { journalEntryId: id }, _sum: { debitMinor: true } });
      await this.governance.enforceAuthorityLimit(tx, actor, { companyId, branchId: journal.branchId, key: 'accounting.journal_post_amount_minor', currency: journal.currency, amountMinor: totals._sum.debitMinor || 0n });
      await this.assertOpenPeriod(tx, actor, journal.postingDate);
      const updated = await tx.journalEntry.update({ where: { id }, data: { status: JournalStatus.POSTED, postedById: actor.userId, postedAt: now } });
      await this.audit(tx, actor, 'POST', 'JOURNAL', id, { postingReference: journal.number }); return this.journalForActor(actor, updated);
    });
  }

  async reverseJournal(actor: Actor, id: bigint, body: any) {
    return this.withTenant(actor, async (tx) => {
      const original = await tx.journalEntry.findFirst({ where: { id, ...this.journalMutationScope(actor, 'accounting.journal.create') }, include: { lines: { include: { account: true } }, reversedBy: true } });
      if (!original) throw new NotFoundException('Journal not found');
      if (original.status !== JournalStatus.POSTED) throw new BadRequestException('Only posted journals can be reversed');
      const companyId = this.requireAtBranch(actor, 'accounting.journal.create', original.branchId);
      this.requireFieldEdit(actor, 'journal', 'lines', 'Journal entry details');
      if (original.reversedBy) throw new BadRequestException('Journal has already been reversed');
      const accountIds = [...new Set(original.lines.map((line) => line.accountId))];
      accountIds.forEach((accountId) => this.assertResourceId(actor, 'account', accountId, companyId));
      const authorizedAccounts = await tx.account.count({ where: {
        id: { in: accountIds },
        active: true,
        AND: [this.resourceIdScope(actor, 'account', companyId)],
      } });
      if (authorizedAccounts !== accountIds.length) throw new ForbiddenException('One or more reversal accounts are outside your company assignment.');
      if (original.sourceModule === 'AV8') throw new BadRequestException('AV8 cash journals require an approved AV8 refund or allocation correction; a standalone reversal would leave the student/academy statement inconsistent.');
      const date = this.date(body.postingDate || new Date().toISOString().slice(0, 10), 'reversal date');
      const number = await this.sequence(tx, actor, original.branchId, 'JOURNAL', date);
      await this.assertOpenPeriod(tx, actor, date);
      const [{ newId }] = await tx.$queryRaw<Array<{ newId: bigint }>>`SELECT nextval(pg_get_serial_sequence('journal_entries', 'id'))::bigint AS "newId"`;
      const reversal = await tx.journalEntry.create({ data: {
        id: newId, tenantId: actor.tenantId, branchId: original.branchId, number, postingDate: date,
        description: `Reversal of ${original.number}: ${body.reason || 'Correction'}`, status: JournalStatus.DRAFT,
        sourceModule: original.sourceModule, sourceType: 'REVERSAL', sourceId: newId, sourceNumber: number,
        reversesEntryId: original.id, reversalReason: String(body.reason || 'Correction'), createdById: actor.userId,
        lines: { create: original.lines.map((line) => ({ tenantId: actor.tenantId, accountId: line.accountId, description: `Reverse: ${line.description}`, debitMinor: line.creditMinor, creditMinor: line.debitMinor })) },
      } });
      await this.audit(tx, actor, 'REVERSAL_DRAFT_CREATED', 'JOURNAL', original.id, { reversalId: reversal.id.toString(), reversalNumber: number, reason: body.reason || 'Correction' });
      return this.journalForActor(actor, reversal);
    });
  }

  async updatePeriod(actor: Actor, id: bigint, status: string) {
    requirePermission(actor, 'accounting.period.manage');
    if (!['OPEN', 'CLOSED', 'LOCKED'].includes(status)) throw new BadRequestException('Period status is invalid');
    return this.withTenant(actor, async (tx) => {
      const period = await tx.fiscalPeriod.update({ where: { id }, data: { status } });
      await this.audit(tx, actor, 'PERIOD_STATUS', 'FISCAL_PERIOD', id, { status, period: period.name });
      return period;
    });
  }

  async posState(actor: Actor) {
    const shiftBranches = this.branchesForPermissions(actor, ['pos.register.view']);
    const saleBranches = this.branchesForPermissions(actor, ['pos.sale.view']);
    if (!can(actor, 'system.super_admin') && !shiftBranches.length) requirePermission(actor, 'pos.register.view');
    if (this.scope(actor, 'pos_terminal') === 'NONE') throw new ForbiddenException('POS terminal is outside your access scope');
    return this.withTenant(actor, async (tx) => {
      const shiftScope: Prisma.PosShiftWhereInput = can(actor, 'system.super_admin') ? {} : {
        branchId: { in: shiftBranches },
        warehouseId: { in: actor.warehouseIds.map(BigInt) },
      };
      const saleShiftScope: Prisma.PosShiftWhereInput = can(actor, 'system.super_admin') ? {} : {
        branchId: { in: saleBranches }, warehouseId: { in: actor.warehouseIds.map(BigInt) },
      };
      return {
        shifts: await tx.posShift.findMany({ where: shiftScope, include: { openedBy: publicUser, closedBy: publicUser, _count: { select: { sales: true } } }, orderBy: { openedAt: 'desc' }, take: 30 }),
        sales: (await tx.posSale.findMany({ where: { shift: saleShiftScope }, include: { customer: true, lines: { include: { item: true } }, tenders: true, shift: true, journalEntry: true }, orderBy: { createdAt: 'desc' }, take: 100 })).map((sale) => this.posSaleForActor(actor, sale)),
      };
    });
  }

  async posSaleDetail(actor: Actor, id: bigint) {
    return this.withTenant(actor, async (tx) => {
      const sale = await tx.posSale.findUnique({ where: { id }, include: {
        customer: true, shift: { include: { branch: true, warehouse: true } }, lines: { include: { item: true } }, tenders: true,
        journalEntry: { include: { lines: { include: { account: true } } } },
      } });
      if (!sale) throw new NotFoundException('POS sale not found');
      this.requireAtBranch(actor, 'pos.sale.view', sale.shift.branchId);
      this.assertWarehouse(actor, sale.shift.warehouseId);
      return this.posSaleForActor(actor, sale);
    });
  }

  async openShift(actor: Actor, body: any) {
    if (this.scope(actor, 'pos_terminal') === 'NONE') throw new ForbiddenException('POS terminal is outside your access scope');
    return this.withTenant(actor, async (tx) => {
      const branchId = BigInt(body.branchId || 0), warehouseId = BigInt(body.warehouseId || 0);
      this.requireAtBranch(actor, 'pos.shift.create', branchId);
      await this.assertBranchWarehouse(tx, actor, branchId, warehouseId);
      const existing = await tx.posShift.findFirst({ where: { registerCode: String(body.registerCode || 'REG-01'), status: PosShiftStatus.OPEN } });
      if (existing) throw new BadRequestException('This register already has an open shift');
      const shift = await tx.posShift.create({ data: { tenantId: actor.tenantId, branchId, warehouseId, registerCode: String(body.registerCode || 'REG-01'), openedById: actor.userId, openingCashMinor: money(body.openingCash || 0, 'opening cash'), expectedCashMinor: money(body.openingCash || 0, 'opening cash') } });
      await this.audit(tx, actor, 'OPEN', 'POS_SHIFT', shift.id, { registerCode: shift.registerCode, openingCashMinor: shift.openingCashMinor.toString() });
      return shift;
    });
  }

  async createPosSale(actor: Actor, body: any) {
    return this.withTenant(actor, async (tx) => {
      const shift = await tx.posShift.findUnique({ where: { id: BigInt(body.shiftId || 0) } });
      if (!shift || shift.status !== PosShiftStatus.OPEN) throw new BadRequestException('An open shift is required');
      const companyId = this.requireAtBranch(actor, 'pos.sale.create', shift.branchId);
      await this.assertBranchWarehouse(tx, actor, shift.branchId, shift.warehouseId);
      const customerId = body.customerId ? BigInt(body.customerId) : null;
      if (customerId && !await tx.customer.findFirst({ where: { id: customerId, companyId, active: true } })) throw new BadRequestException('The selected customer is not available for this company.');
      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException('Add at least one item');
      const items = await tx.item.findMany({ where: { id: { in: body.lines.map((line: any) => BigInt(line.itemId)) }, active: true } });
      const map = new Map(items.map((item) => [item.id.toString(), item]));
      let subtotal = 0n, discount = 0n, tax = 0n, total = 0n;
      const lines = body.lines.map((line: any, index: number) => {
        const item = map.get(String(line.itemId)); if (!item) throw new BadRequestException(`Line ${index + 1}: item is invalid`);
        const qty = quantity(line.quantity, 'quantity'); if (qty <= 0n) throw new BadRequestException('Quantity must be greater than zero');
        const unitPrice = line.unitPrice === undefined ? item.salePriceMinor : money(line.unitPrice, 'unit price');
        const lineDiscount = money(line.discount || 0, 'discount'), gross = roundDiv(qty * unitPrice, 1000n);
        if (lineDiscount < 0n || lineDiscount > gross) throw new BadRequestException(`Line ${index + 1}: discount is invalid`);
        const discountLimit = this.limit(actor, 'sales.discount_percent', 0);
        if (!can(actor, 'system.super_admin') && lineDiscount * 100n > gross * BigInt(Math.round(discountLimit))) throw new ForbiddenException(`Discount exceeds your configured limit of ${discountLimit}%.`);
        const taxable = gross - lineDiscount;
        const lineTax = roundDiv(taxable * BigInt(item.taxRateBps), 10_000n), lineTotal = taxable + lineTax;
        subtotal += gross; discount += lineDiscount; tax += lineTax; total += lineTotal;
        return { tenantId: actor.tenantId, itemId: item.id, quantityMilli: qty, unitPriceMinor: unitPrice, discountMinor: lineDiscount, taxMinor: lineTax, totalMinor: lineTotal };
      });
      const date = new Date(); const number = await this.sequence(tx, actor, shift.branchId, 'POS', date);
      const complete = body.hold !== true;
      const tenders = Array.isArray(body.tenders) ? body.tenders.map((tender: any) => ({ tenantId: actor.tenantId, method: tender.method as PaymentMethod, amountMinor: money(tender.amount, 'tender amount'), reference: tender.reference || null })) : [];
      if (complete && tenders.reduce((sum: bigint, tender: { amountMinor: bigint }) => sum + tender.amountMinor, 0n) !== total) throw new BadRequestException('Split tender total must exactly equal sale total');
      const sale = await tx.posSale.create({ data: { tenantId: actor.tenantId, shiftId: shift.id, customerId, number, status: complete ? PosSaleStatus.HELD : PosSaleStatus.HELD, subtotalMinor: subtotal, discountMinor: discount, taxMinor: tax, totalMinor: total, createdById: actor.userId, lines: { create: lines }, ...(tenders.length ? { tenders: { create: tenders } } : {}) }, include: { customer: true, lines: { include: { item: true } }, tenders: true } });
      if (!complete) { await this.audit(tx, actor, 'HOLD', 'POS_SALE', sale.id, { number }); return this.posSaleForActor(actor, sale); }
      return this.completePosSaleTx(tx, actor, sale.id);
    });
  }

  async resumePosSale(actor: Actor, id: bigint, body: any) {
    return this.withTenant(actor, async (tx) => {
      const sale = await tx.posSale.findUnique({ where: { id }, include: { tenders: true, shift: true } });
      if (!sale || sale.status !== PosSaleStatus.HELD) throw new BadRequestException('Held sale not found');
      this.requireAtBranch(actor, 'pos.sale.edit', sale.shift.branchId); this.assertWarehouse(actor, sale.shift.warehouseId);
      const tenders = body.tenders.map((tender: any) => ({ tenantId: actor.tenantId, saleId: id, method: tender.method as PaymentMethod, amountMinor: money(tender.amount), reference: tender.reference || null }));
      if (tenders.reduce((sum: bigint, tender: any) => sum + tender.amountMinor, 0n) !== sale.totalMinor) throw new BadRequestException('Split tender total must exactly equal sale total');
      await tx.posTender.deleteMany({ where: { saleId: id } }); await tx.posTender.createMany({ data: tenders });
      return this.completePosSaleTx(tx, actor, id);
    });
  }

  private async completePosSaleTx(tx: Tx, actor: Actor, saleId: bigint) {
    const sale = await tx.posSale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: { include: { item: true } }, tenders: true, shift: true } });
    if (!sale.tenders.length) throw new BadRequestException('Tender is required');
    let cost = 0n;
    for (const line of sale.lines) {
      const movement = await this.stock(tx, actor, { branchId: sale.shift.branchId, warehouseId: sale.shift.warehouseId, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'OUT', date: sale.createdAt, sourceType: 'POS_SALE', sourceId: sale.id, sourceNumber: sale.number });
      cost += movement.totalCostMinor; await tx.posSaleLine.update({ where: { id: line.id }, data: { costMinor: movement.totalCostMinor } });
    }
    const tenderLines = sale.tenders.map((tender) => ({ code: tender.method === PaymentMethod.CASH ? '1000' : tender.method === PaymentMethod.CARD ? '1020' : '1010', debit: tender.amountMinor, description: `${tender.method} tender ${sale.number}` }));
    const journal = await this.postedJournal(tx, actor, { branchId: sale.shift.branchId, date: sale.createdAt, description: `POS sale ${sale.number}`, module: 'POS', sourceType: 'POS_SALE', sourceId: sale.id, sourceNumber: sale.number, lines: [...tenderLines, { code: '4000', credit: sale.subtotalMinor - sale.discountMinor, description: `POS revenue ${sale.number}` }, ...(sale.taxMinor ? [{ code: '2200', credit: sale.taxMinor, description: `POS VAT ${sale.number}` }] : []), { code: '5000', debit: cost, description: `POS COGS ${sale.number}` }, { code: '1200', credit: cost, description: `POS inventory ${sale.number}` }] });
    const cash = sale.tenders.filter((tender) => tender.method === PaymentMethod.CASH).reduce((sum, tender) => sum + tender.amountMinor, 0n);
    await tx.posShift.update({ where: { id: sale.shiftId }, data: { expectedCashMinor: { increment: cash } } });
    const updated = await tx.posSale.update({ where: { id: sale.id }, data: { status: PosSaleStatus.COMPLETED, completedAt: new Date(), costMinor: cost, journalEntryId: journal.id } });
    await this.audit(tx, actor, 'COMPLETE', 'POS_SALE', sale.id, { postingReference: journal.number, number: sale.number, totalMinor: sale.totalMinor.toString() }); return this.posSaleForActor(actor, updated);
  }

  async returnPosSale(actor: Actor, id: bigint, body: any) {
    return this.withTenant(actor, async (tx) => {
      const original = await tx.posSale.findUnique({ where: { id }, include: { lines: true, tenders: true, shift: true } });
      if (!original || original.status !== PosSaleStatus.COMPLETED) throw new BadRequestException('Only a completed sale can be returned');
      this.requireAtBranch(actor, 'pos.return.create', original.shift.branchId);
      this.assertBranch(actor, original.shift.branchId); this.assertWarehouse(actor, original.shift.warehouseId);
      const number = await this.sequence(tx, actor, original.shift.branchId, 'POS_RETURN', new Date());
      let cost = 0n;
      for (const line of original.lines) {
        const movement = await this.stock(tx, actor, { branchId: original.shift.branchId, warehouseId: original.shift.warehouseId, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'IN', unitCostMinor: roundDiv(line.costMinor * 1000n, line.quantityMilli), date: new Date(), sourceType: 'POS_RETURN', sourceId: original.id, sourceNumber: number }); cost += movement.totalCostMinor;
      }
      const refund = original.tenders[0]?.method || PaymentMethod.CASH;
      const journal = await this.postedJournal(tx, actor, { branchId: original.shift.branchId, date: new Date(), description: `POS return ${number}`, module: 'POS', sourceType: 'POS_RETURN', sourceId: original.id, sourceNumber: number, lines: [{ code: '4000', debit: original.subtotalMinor - original.discountMinor, description: `Reverse revenue ${number}` }, ...(original.taxMinor ? [{ code: '2200', debit: original.taxMinor, description: `Reverse VAT ${number}` }] : []), { code: refund === PaymentMethod.CASH ? '1000' : refund === PaymentMethod.CARD ? '1020' : '1010', credit: original.totalMinor, description: `Refund ${number}` }, { code: '1200', debit: cost, description: `Inventory restored ${number}` }, { code: '5000', credit: cost, description: `COGS reversed ${number}` }] });
      await tx.posSale.update({ where: { id }, data: { status: PosSaleStatus.RETURNED } });
      if (refund === PaymentMethod.CASH) await tx.posShift.update({ where: { id: original.shiftId }, data: { expectedCashMinor: { decrement: original.totalMinor } } });
      await this.audit(tx, actor, 'RETURN', 'POS_SALE', id, { postingReference: journal.number, returnNumber: number, reason: body.reason || 'Customer return' });
      return { originalId: id, number, journalEntryId: journal.id, status: 'RETURNED' };
    });
  }

  async closeShift(actor: Actor, id: bigint, body: any) {
    return this.withTenant(actor, async (tx) => {
      const shift = await tx.posShift.findUnique({ where: { id } });
      if (!shift || shift.status !== PosShiftStatus.OPEN) throw new BadRequestException('Open shift not found');
      this.requireAtBranch(actor, 'pos.shift.edit', shift.branchId);
      this.assertBranch(actor, shift.branchId); this.assertWarehouse(actor, shift.warehouseId);
      const actual = money(body.actualCash, 'actual cash'), difference = actual - shift.expectedCashMinor;
      let journal = null;
      if (difference !== 0n) journal = await this.postedJournal(tx, actor, { branchId: shift.branchId, date: new Date(), description: `Cash count difference ${shift.registerCode}`, module: 'POS', sourceType: 'POS_SHIFT_CLOSE', sourceId: shift.id, sourceNumber: shift.registerCode, lines: difference > 0n ? [{ code: '1000', debit: difference, description: 'Cash over' }, { code: '5200', credit: difference, description: 'Cash over' }] : [{ code: '5200', debit: -difference, description: 'Cash short' }, { code: '1000', credit: -difference, description: 'Cash short' }] });
      const updated = await tx.posShift.update({ where: { id }, data: { status: PosShiftStatus.CLOSED, actualCashMinor: actual, differenceMinor: difference, closedById: actor.userId, closedAt: new Date(), closingJournalEntryId: journal?.id || null } });
      await this.audit(tx, actor, 'CLOSE', 'POS_SHIFT', id, { postingReference: journal?.number || 'NO_DIFFERENCE', expected: shift.expectedCashMinor.toString(), actual: actual.toString(), difference: difference.toString() }); return updated;
    });
  }

  async banking(actor: Actor) {
    const permissions = ['banking.account.view', 'banking.transaction.view', 'banking.statement.view'];
    const accountCompanies = this.companiesForPermissions(actor, ['banking.account.view']);
    const transactionCompanies = this.companiesForPermissions(actor, ['banking.transaction.view']);
    const statementCompanies = this.companiesForPermissions(actor, ['banking.statement.view']);
    const transactionBranches = this.branchesForPermissions(actor, ['banking.transaction.view']);
    if (!can(actor, 'system.super_admin') && !accountCompanies.length && !transactionCompanies.length && !statementCompanies.length) this.requireAny(actor, ...permissions);
    return this.withTenant(actor, async (tx) => {
      const branchScope = can(actor, 'system.super_admin') ? {} : { branchId: { in: transactionBranches } };
      const bankScope = (companyIds: bigint[]): Prisma.BankAccountWhereInput => can(actor, 'system.super_admin') ? {} : ({
        AND: [this.resourceIdScope(actor, 'bank_account'), { financialResources: { some: { companyId: { in: companyIds }, active: true } } }],
      });
      const [accounts, transactions, statements] = await Promise.all([
        tx.bankAccount.findMany({ where: bankScope(accountCompanies), include: { glAccount: true }, orderBy: { code: 'asc' } }),
        tx.bankTransaction.findMany({ where: { ...branchScope, bankAccount: bankScope(transactionCompanies) }, include: { bankAccount: true, counterpartyAccount: true, journalEntry: true }, orderBy: { postingDate: 'desc' }, take: 200 }),
        tx.bankStatement.findMany({ where: { bankAccount: bankScope(statementCompanies) }, include: { bankAccount: true, lines: { include: { transaction: true } } }, orderBy: { statementDate: 'desc' }, take: 50 }),
      ]);
      return {
        accounts: accounts.map((account) => this.bankAccountForActor(actor, account)),
        transactions: transactions.map((transaction) => ({ ...transaction, bankAccount: this.bankAccountForActor(actor, transaction.bankAccount) })),
        statements: statements.map((statement) => ({ ...statement, bankAccount: this.bankAccountForActor(actor, statement.bankAccount) })),
      };
    });
  }

  async createBankTransaction(actor: Actor, body: any) {
    return this.withTenant(actor, async (tx) => {
      const branchId = BigInt(body.branchId || 0); this.assertBranch(actor, branchId);
      const companyId = this.requireAtBranch(actor, 'banking.transaction.create', branchId);
      const bankAccountId = BigInt(body.bankAccountId || 0), counterpartyAccountId = BigInt(body.counterpartyAccountId || 0);
      this.assertResourceId(actor, 'bank_account', bankAccountId, companyId);
      this.assertResourceId(actor, 'account', counterpartyAccountId, companyId);
      const bank = await tx.bankAccount.findFirst({ where: { id: bankAccountId, ...this.resourceIdScope(actor, 'bank_account', companyId) }, include: { glAccount: true } });
      const counterparty = await tx.account.findFirst({ where: { id: counterpartyAccountId, ...this.resourceIdScope(actor, 'account', companyId) } });
      if (!bank || !counterparty || !counterparty.postingAllowed) throw new BadRequestException('Bank or counterparty account is invalid');
      const tenant=await tx.tenant.findUniqueOrThrow({where:{id:actor.tenantId},select:{baseCurrency:true}});
      if(bank.currency!==tenant.baseCurrency)throw new BadRequestException('Use AV8 Collections & academy for foreign-currency movements with explicit historical exchange rates.');
      const kind = body.kind as BankTransactionKind;
      if (!Object.values(BankTransactionKind).includes(kind)) throw new BadRequestException('Bank transaction kind is invalid');
      const date = this.date(body.postingDate || new Date().toISOString().slice(0, 10), 'posting date');
      const amount = money(body.amount, 'amount'); if (amount <= 0n) throw new BadRequestException('Amount must be greater than zero');
      await this.governance.enforceAuthorityLimit(tx, actor, { companyId, branchId, key: 'treasury.movement_amount_minor', currency: bank.currency, amountMinor: amount });
      const number = await this.sequence(tx, actor, branchId, 'BANK', date);
      const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT nextval(pg_get_serial_sequence('bank_transactions', 'id'))::bigint AS id`;
      const incoming = kind === BankTransactionKind.RECEIPT || kind === BankTransactionKind.TRANSFER_IN;
      const journal = await this.postedJournal(tx, actor, { branchId, date, description: String(body.description || `${kind} ${number}`), module: 'BANKING', sourceType: 'BANK_TRANSACTION', sourceId: id, sourceNumber: number, lines: incoming ? [{ code: bank.glAccount.code, debit: amount, description: `Bank debit ${number}` }, { code: counterparty.code, credit: amount, description: `Counterparty credit ${number}` }] : [{ code: counterparty.code, debit: amount, description: `Counterparty debit ${number}` }, { code: bank.glAccount.code, credit: amount, description: `Bank credit ${number}` }] });
      const transaction = await tx.bankTransaction.create({ data: { id, tenantId: actor.tenantId, branchId, bankAccountId: bank.id, counterpartyAccountId: counterparty.id, kind, number, postingDate: date, amountMinor: amount, reference: body.reference || null, description: String(body.description || kind), journalEntryId: journal.id, createdById: actor.userId }, include: { journalEntry: true, bankAccount: true } });
      await this.audit(tx, actor, 'POST', 'BANK_TRANSACTION', id, { postingReference: journal.number, number, amountMinor: amount.toString() }); return transaction;
    });
  }

  async createStatement(actor: Actor, body: any) {
    return this.withTenant(actor, async (tx) => {
      const bankAccountId = BigInt(body.bankAccountId || 0);
      const resource = await tx.financialResource.findFirst({ where: { linkedBankAccountId: bankAccountId, active: true, companyId: { in: actor.companyIds.map(BigInt) } } });
      if (!resource) throw new ForbiddenException('Bank account is outside your active companies.');
      requirePermissionAtCompany(actor, 'banking.statement.create', resource.companyId);
      this.assertResourceId(actor, 'bank_account', bankAccountId, resource.companyId);
      const bank = await tx.bankAccount.findFirst({ where: { id: bankAccountId, ...this.resourceIdScope(actor, 'bank_account', resource.companyId) } });
      if (!bank) throw new BadRequestException('Bank account is invalid');
      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException('Statement lines are required');
      const statement = await tx.bankStatement.create({ data: { tenantId: actor.tenantId, bankAccountId: bank.id, statementDate: this.date(body.statementDate, 'statement date'), openingMinor: money(body.opening, 'opening balance'), closingMinor: money(body.closing, 'closing balance'), createdById: actor.userId, lines: { create: body.lines.map((line: any) => ({ tenantId: actor.tenantId, lineDate: this.date(line.date, 'line date'), description: String(line.description), reference: line.reference || null, amountMinor: money(line.amount, 'line amount') })) } }, include: { lines: true } });
      await this.audit(tx, actor, 'IMPORT', 'BANK_STATEMENT', statement.id, { lineCount: statement.lines.length, closingMinor: statement.closingMinor.toString() }); return statement;
    });
  }

  async matchStatementLine(actor: Actor, lineId: bigint, transactionId: bigint) {
    return this.withTenant(actor, async (tx) => {
      const line = await tx.bankStatementLine.findUnique({ where: { id: lineId }, include: { statement: true } });
      const transaction = await tx.bankTransaction.findUnique({ where: { id: transactionId } });
      if (!line || !transaction || line.statement.bankAccountId !== transaction.bankAccountId) throw new BadRequestException('Statement line and transaction do not belong to the same account');
      const resource = await tx.financialResource.findFirst({ where: { linkedBankAccountId: line.statement.bankAccountId, active: true, companyId: { in: actor.companyIds.map(BigInt) } } });
      if (!resource) throw new ForbiddenException('Bank account is outside your active companies.');
      requirePermissionAtCompany(actor, 'banking.statement.reconcile', resource.companyId);
      this.assertResourceId(actor, 'bank_account', line.statement.bankAccountId, resource.companyId);
      if (line.matched || transaction.reconciled) throw new BadRequestException('Line or transaction is already reconciled');
      if ((line.amountMinor < 0n ? -line.amountMinor : line.amountMinor) !== transaction.amountMinor) throw new BadRequestException('Amounts do not match');
      const updated = await tx.bankStatementLine.update({ where: { id: lineId }, data: { transactionId, matched: true } });
      await tx.bankTransaction.update({ where: { id: transactionId }, data: { reconciled: true } });
      await this.audit(tx, actor, 'MATCH', 'BANK_STATEMENT_LINE', lineId, { transactionId: transactionId.toString(), transactionNumber: transaction.number }); return updated;
    });
  }

  async approvals(actor: Actor) {
    const queueBranches = this.branchesForPermissions(actor, ['approvals.queue.view']);
    if (!can(actor, 'system.super_admin') && !queueBranches.length) requirePermission(actor, 'approvals.queue.view');
    return this.withTenant(actor, async (tx) => {
      const queueScope = this.scope(actor, 'approval_queue');
      const queueRecords: Prisma.DocumentWhereInput = queueScope === 'NONE' ? { id: -1n }
        : queueScope === 'ASSIGNED' ? { id: { in: this.configuredResourceIds(actor, 'approval_queue') } }
          : {};
      const documentClauses = Object.values(DocumentType).flatMap((type) => {
        const module = this.documentModule(type);
        const resource = this.documentPermissionResource(type);
        const visibleBranches = this.branchesForPermissions(actor, [`${module}.${resource}.view`]);
        const actionBranches = this.branchesForPermissions(actor, [`${module}.${resource}.approve`, `${module}.${resource}.reject`]);
        const allowed = queueBranches.filter((branchId) => visibleBranches.includes(branchId) && actionBranches.includes(branchId));
        return allowed.length ? [{
          type,
          branchId: { in: allowed },
          ...this.documentScope(actor, this.documentResource(type), module),
        } as Prisma.DocumentWhereInput] : [];
      });
      const journalBranches = queueBranches.filter((branchId) =>
        this.branchesForPermissions(actor, ['accounting.journal.view']).includes(branchId)
        && this.branchesForPermissions(actor, ['accounting.journal.approve', 'accounting.journal.reject']).includes(branchId));
      const [documents, journals] = await Promise.all([
        tx.document.findMany({
        where: { status: WorkflowStatus.SUBMITTED, AND: [queueRecords, documentClauses.length ? { OR: documentClauses } : { id: -1n }] },
        include: { customer: true, supplier: true, branch: true, salesEmployee: true, createdBy: publicUser, submittedBy: publicUser, lines: { include: { item: true } } },
        orderBy: { submittedAt: 'asc' },
      }),
        journalBranches.length
          ? tx.journalEntry.findMany({ where: { status: JournalStatus.SUBMITTED, AND: [this.journalScope(actor), { branchId: { in: journalBranches } }] }, include: { createdBy: publicUser, submittedBy: publicUser, lines: { include: { account: true } } }, orderBy: { submittedAt: 'asc' } })
          : Promise.resolve([]),
      ]);
      return {
        documents: documents.map((document) => this.documentForActor(actor, { ...document, customer: document.customer ? this.customerForActor(actor, document.customer) : null })),
        journals: journals.map((journal) => this.journalForActor(actor, journal)),
      };
    });
  }

  async auditLog(actor: Actor) {
    const auditCompanies = this.companiesForPermissions(actor, ['audit.business.view']);
    const auditBranches = this.branchesForPermissions(actor, ['audit.business.view']);
    if (!can(actor, 'system.super_admin') && !auditCompanies.length) requirePermission(actor, 'audit.business.view');
    return this.withTenant(actor, async (tx) => (await tx.auditEvent.findMany({
      where: this.auditVisibilityScope(actor, auditCompanies, auditBranches),
      include: { user: publicUser },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })).map((entry) => this.auditForActor(actor, entry)));
  }

  async referenceEvidence(actor: Actor, reference: string) {
    const evidencePermissions = ['audit.business.view', 'approvals.queue.history'];
    const evidenceCompanies = this.companiesForPermissions(actor, evidencePermissions);
    if (!can(actor, 'system.super_admin') && !evidenceCompanies.length) this.requireAny(actor, ...evidencePermissions);
    return this.withTenant(actor, async (tx) => {
      const companyAtBranch = (branchId: bigint) => companyForBranch(actor, branchId);
      const canSeeEvidenceAtBranch = (branchId: bigint) => {
        const companyId = companyAtBranch(branchId);
        return Boolean(companyId && evidencePermissions.some((permission) => canAtCompany(actor, permission, companyId)));
      };
      const documentHeader = await tx.document.findFirst({ where: { number: reference }, select: { id: true, type: true, branchId: true } });
      const documentCompany = documentHeader ? companyAtBranch(documentHeader.branchId) : undefined;
      const documentPermission = documentHeader ? `${this.documentModule(documentHeader.type)}.${this.documentPermissionResource(documentHeader.type)}.view` : '';
      const document = documentHeader && documentCompany && canSeeEvidenceAtBranch(documentHeader.branchId) && canAtCompany(actor, documentPermission, documentCompany)
        ? await this.documentInScope(tx, actor, documentHeader.id, { customer: true, supplier: true, lines: { include: { item: true } }, journalEntry: { include: { lines: { include: { account: true } } } } })
        : null;
      if (document) {
        const visible = this.documentForActor(actor, document);
        const stockMovements = await tx.stockMovement.findMany({ where: { sourceId: document.id, sourceType: { startsWith: document.type } }, include: { item: true, warehouse: true } });
        return { kind: 'DOCUMENT', reference, status: visible.status, description: `${visible.type} · ${visible.customer?.name || visible.supplier?.name || 'Internal'}`, totalMinor: visible.totalMinor, lines: (visible.lines || []).map((line: any) => `${line.item.sku} × ${line.quantityMilli}`), journal: this.fieldAccess(actor, 'journal', 'lines') === 'HIDDEN' ? null : visible.journalEntry?.number || null, stockMovements: stockMovements.map((move) => `${move.item.sku} · ${move.warehouse.name} · in ${move.quantityInMilli} · out ${move.quantityOutMilli}`) };
      }
      const journalHeader = await tx.journalEntry.findFirst({ where: { number: reference }, select: { id: true, branchId: true } });
      const journalCompany = journalHeader ? companyAtBranch(journalHeader.branchId) : undefined;
      const journal = journalHeader && journalCompany && canSeeEvidenceAtBranch(journalHeader.branchId)
        && canAtCompany(actor, 'accounting.journal.view', journalCompany) && this.fieldAccess(actor, 'journal', 'lines') !== 'HIDDEN'
        ? await tx.journalEntry.findFirst({ where: { id: journalHeader.id, ...this.journalScope(actor) }, include: { lines: { include: { account: true } }, reversesEntry: true, reversedBy: true } }) : null;
      if (journal) {
        const visible = this.journalForActor(actor, journal);
        return { kind: 'JOURNAL', reference, status: visible.status, description: visible.description, source: visible.sourceNumber, reverses: visible.reversesEntry?.number || null, reversedBy: visible.reversedBy?.number || null, lines: (visible.lines || []).map((line: any) => `${line.account.code} ${line.account.name} · Dr ${line.debitMinor} · Cr ${line.creditMinor}`) };
      }
      const payment = await tx.payment.findFirst({ where: {
        AND: [
          { number: reference },
          this.paymentScope(actor),
          { bankAccount: this.resourceIdScope(actor, 'bank_account') },
        ],
      }, include: { journalEntry: true, customer: true, supplier: true, allocations: true } });
      if (payment) {
        const paymentCompany = companyAtBranch(payment.branchId);
        const permission = payment.kind === PaymentKind.RECEIPT ? 'payments.receipt.view' : 'payments.payment.view';
        if (paymentCompany && canSeeEvidenceAtBranch(payment.branchId) && canAtCompany(actor, permission, paymentCompany)) {
          const visible = await this.paymentWithVisibleDocuments(tx, actor, payment);
          return { kind: 'PAYMENT', reference, status: visible.status, description: `${visible.kind} · ${visible.customer?.name || visible.supplier?.name}`, totalMinor: visible.amountMinor, journal: this.fieldAccess(actor, 'journal', 'lines') === 'HIDDEN' ? null : visible.journalEntry?.number || null, lines: (visible.allocations || []).map((allocation: any) => `${allocation.document.number} · ${allocation.amountMinor}`) };
        }
      }
      const pos = await tx.posSale.findFirst({ where: { number: reference }, include: { shift: true, journalEntry: true, lines: { include: { item: true } } } });
      if (pos) {
        const posCompany = companyAtBranch(pos.shift.branchId);
        if (posCompany && canSeeEvidenceAtBranch(pos.shift.branchId) && canAtCompany(actor, 'pos.sale.view', posCompany)
          && (can(actor, 'system.super_admin') || actor.warehouseIds.includes(pos.shift.warehouseId.toString()))) {
          const visible = this.posSaleForActor(actor, pos);
          return { kind: 'POS_SALE', reference, status: visible.status, description: 'Point-of-sale transaction', totalMinor: visible.totalMinor, journal: this.fieldAccess(actor, 'journal', 'lines') === 'HIDDEN' ? null : visible.journalEntry?.number || null, lines: (visible.lines || []).map((line: any) => `${line.item.sku} × ${line.quantityMilli}`) };
        }
      }
      throw new NotFoundException('Referenced source document or journal was not found');
    });
  }

  private ledgerBalance(rows: Array<{ debitMinor: bigint; creditMinor: bigint }>) {
    return rows.reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0n);
  }

  async report(actor: Actor, name: string, outputAction?: 'export' | 'print', query: any = {}) {
    const reportResource = ['income-statement', 'balance-sheet', 'sales-profitability'].includes(name) ? 'profitability' : 'standard';
    const reportPermissions = [`reports.${reportResource}.view`, ...(outputAction ? [`reports.${reportResource}.${outputAction}`] : [])];
    const reportBranches = this.branchesForAllPermissions(actor, reportPermissions);
    if (!can(actor, 'system.super_admin') && !reportBranches.length) {
      throw new ForbiddenException('Report permission is not effective in an assigned company branch.');
    }
    if (outputAction && this.scope(actor, outputAction) === 'NONE') throw new ForbiddenException(`${outputAction} is outside your access scope`);
    const accountingReports = ['trial-balance', 'general-ledger', 'account-ledger', 'income-statement', 'balance-sheet', 'tax-report', 'cash-flow', 'reconciliation'];
    const customerReports = ['ar-aging', 'customer-balances', 'customer-statement'];
    const purchasingReports = ['ap-aging', 'supplier-statement', 'purchase-analysis'];
    const inventoryReports = ['inventory-valuation', 'stock-movements'];
    const dependencyPermissions = name === 'reconciliation' ? [
      'accounting.journal.view', 'sales.customer.view', 'sales.invoice.view',
      'purchasing.supplier.view', 'purchasing.bill.view',
      'inventory.overview.view', 'inventory.item.view',
    ] : accountingReports.includes(name) ? ['accounting.journal.view']
      : name === 'customer-statement' ? [
        'sales.customer.view', 'sales.invoice.view', 'sales.return.view', 'sales.credit_note.view', 'payments.receipt.view',
      ] : customerReports.includes(name) ? ['sales.customer.view', 'sales.invoice.view']
        : name === 'supplier-statement' ? [
          'purchasing.supplier.view', 'purchasing.bill.view', 'purchasing.return.view', 'payments.payment.view',
        ] : name === 'purchase-analysis' ? ['purchasing.supplier.view', 'purchasing.bill.view', 'purchasing.return.view']
          : purchasingReports.includes(name) ? ['purchasing.supplier.view', 'purchasing.bill.view']
            : inventoryReports.includes(name) ? ['inventory.overview.view', 'inventory.item.view', 'inventory.warehouse.view']
              : name === 'pos-shifts' ? ['pos.shift.view', 'pos.sale.view']
              : name === 'sales-profitability' ? ['sales.invoice.view', 'sales.delivery.view', 'sales.customer.view', 'sales.overview.view'] : [];
    const dependencyBranches = dependencyPermissions.length ? this.branchesForAllPermissions(actor, dependencyPermissions) : reportBranches;
    const branchIds = reportBranches.filter((branchId) => dependencyBranches.includes(branchId));
    if (!can(actor, 'system.super_admin') && !branchIds.length) {
      throw new ForbiddenException('The report dependency permission is not effective in an assigned company branch.');
    }
    if (accountingReports.includes(name) && this.fieldAccess(actor, 'journal', 'lines') === 'HIDDEN') throw new ForbiddenException('Journal details are hidden for your role.');
    if ((customerReports.includes(name) || name === 'reconciliation') && this.fieldAccess(actor, 'customer', 'balanceMinor') === 'HIDDEN' && !actor.legacyPermissions.includes('customers.view-credit')) {
      throw new ForbiddenException('Customer balance and receivable values are hidden for your role.');
    }
    if (['inventory-valuation', 'sales-profitability', 'reconciliation'].includes(name) && this.fieldAccess(actor, 'document', 'costMinor') === 'HIDDEN' && this.fieldAccess(actor, 'item', 'costPriceMinor') === 'HIDDEN') {
      throw new ForbiddenException('Cost and profitability values are hidden for your role.');
    }
    return this.withTenant(actor, async (tx) => {
      let scopedBranchIds = can(actor, 'system.super_admin') ? undefined : branchIds;
      let selectedAccountingCompany: { id: bigint; name: string } | null = null;
      if (accountingReportNames.has(name)) {
        const filters = accountingFilters(query);
        if (filters.companyId) {
          if (!can(actor, 'system.super_admin') && !actor.companyIds.includes(filters.companyId)) throw new ForbiddenException('Company is outside your access scope.');
          selectedAccountingCompany = await tx.company.findFirst({ where: { id: BigInt(filters.companyId), active: true }, select: { id: true, name: true } });
          if (!selectedAccountingCompany) throw new ForbiddenException('Company is outside your access scope.');
          const links = await tx.companyBranch.findMany({ where: { companyId: selectedAccountingCompany.id, active: true }, select: { branchId: true } });
          scopedBranchIds = links.map((link) => link.branchId).filter((branch) => can(actor, 'system.super_admin') || branchIds.includes(branch));
          if (filters.branchId && !scopedBranchIds.some((branch) => branch.toString() === filters.branchId)) throw new ForbiddenException('Branch is outside the selected company.');
        }
      }
      const dataCompanyIds = can(actor, 'system.super_admin') ? actor.companyIds.map(BigInt) : actor.companyIds
        .filter((companyId) => (actor.companyBranchIds[companyId] || []).some((branchId) => scopedBranchIds!.some((candidate) => candidate.toString() === branchId)))
        .map(BigInt);
      const reportDocumentScope = (resource: string, module: string): Prisma.DocumentWhereInput => ({ AND: [
        this.documentScope(actor, 'report', module),
        this.documentScope(actor, resource, module),
        ...(scopedBranchIds ? [{ branchId: { in: scopedBranchIds } }] : []),
      ] });
      const invoiceReportScope = reportDocumentScope('invoice', 'sales');
      const profitabilityDeliveryScope: Prisma.DocumentWhereInput = {
        AND: [
          reportDocumentScope('delivery', 'sales'),
          { type: DocumentType.DELIVERY_NOTE, status: WorkflowStatus.POSTED },
        ],
      };
      const receivableReportScope: Prisma.DocumentWhereInput = {
        AND: [invoiceReportScope, { customer: { is: this.customerScope(actor) } }],
      };
      const customerStatementDocumentScope: Prisma.DocumentWhereInput = {
        AND: [
          { customer: { is: this.customerScope(actor) } },
          { OR: [
            { type: DocumentType.SALES_INVOICE, ...invoiceReportScope },
            { type: DocumentType.SALES_RETURN, ...reportDocumentScope('return', 'sales') },
            { type: DocumentType.CREDIT_NOTE, ...reportDocumentScope('credit_note', 'sales') },
          ] },
        ],
      };
      const billReportScope = reportDocumentScope('bill', 'purchasing');
      const payableReportScope: Prisma.DocumentWhereInput = {
        AND: [billReportScope, { supplier: { is: this.supplierScope(actor) } }],
      };
      const payableReturnReportScope: Prisma.DocumentWhereInput = {
        AND: [reportDocumentScope('purchase_return', 'purchasing'), { supplier: { is: this.supplierScope(actor) } }],
      };
      const reportJournalScope: Prisma.JournalEntryWhereInput = { AND: [
        this.journalScope(actor, 'report'),
        this.journalScope(actor, 'journal'),
        ...(scopedBranchIds ? [{ branchId: { in: scopedBranchIds } }] : []),
      ] };
      const warehouseIds = this.inventoryWarehouseIds(actor);
      const inventoryReportAllowed = can(actor, 'system.super_admin') || ['ALL', 'BRANCH', 'WAREHOUSE'].includes(this.scope(actor, 'report'));
      const inventoryScope: Prisma.StockBalanceWhereInput = inventoryReportAllowed ? {
        ...(warehouseIds ? { warehouseId: { in: warehouseIds }, warehouse: { branchId: { in: scopedBranchIds || [] } } } : {}),
        item: this.inventoryItemScope(actor),
      } : { itemId: -1n };
      const movementScope: Prisma.StockMovementWhereInput = inventoryReportAllowed ? {
        ...(warehouseIds ? { warehouseId: { in: warehouseIds }, warehouse: { branchId: { in: scopedBranchIds || [] } } } : {}),
        item: this.inventoryItemScope(actor),
      } : { id: -1n };
      const accountScope: Prisma.AccountWhereInput = { AND: [can(actor, 'system.super_admin') ? {} : { AND: [
        this.resourceIdScope(actor, 'account'),
        { financialResources: { some: { companyId: { in: dataCompanyIds }, active: true } } },
      ] }, ...(selectedAccountingCompany ? [{ financialResources: { some: { companyId: selectedAccountingCompany.id, active: true } } }] : [])] };
      const accountingDataAllowed = can(actor, 'system.super_admin')
        || (this.scope(actor, 'report') !== 'NONE' && this.scope(actor, 'journal') !== 'NONE');
      const accounts = accountingDataAllowed
        ? await tx.account.findMany({ where: accountScope, orderBy: { code: 'asc' } })
        : [];
      const journalLines = await tx.journalLine.findMany({ where: { account: accountScope, journalEntry: { status: JournalStatus.POSTED, AND: [reportJournalScope] } }, include: { account: true, journalEntry: true } });
      if (accountingReportNames.has(name)) {
        const filters = accountingFilters(query);
        if (filters.branchId && !can(actor, 'system.super_admin') && !branchIds.some((branchId) => branchId.toString() === filters.branchId)) throw new ForbiddenException('Branch is outside your access scope.');
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { baseCurrency: true, name: true } });
        const branch = filters.branchId ? await tx.branch.findUnique({ where: { id: BigInt(filters.branchId) }, select: { name: true } }) : null;
        return { ...buildAccountingReport(name, accounts, journalLines, filters, tenant.baseCurrency), reportContext: { company: selectedAccountingCompany?.name || tenant.name, branch: branch?.name || 'All authorized branches' } };
      }
      const byAccount = accounts.map((account) => {
        const lines = journalLines.filter((line) => line.accountId === account.id);
        const debitMinor = lines.reduce((sum, line) => sum + line.debitMinor, 0n), creditMinor = lines.reduce((sum, line) => sum + line.creditMinor, 0n);
        return { id: account.id, code: account.code, name: account.name, type: account.type, debitMinor, creditMinor, balanceMinor: debitMinor - creditMinor };
      });
      if (name === 'ar-aging') {
        const rows = await this.receivables.ageing(tx, { branchIds: scopedBranchIds, documentScope: receivableReportScope });
        return { name: 'Accounts receivable aging', rows, totals: { outstandingMinor: rows.reduce((sum, row) => sum + row.outstandingMinor, 0n) } };
      }
      if (name === 'ap-aging') {
        const docs = await tx.document.findMany({
          where: { ...payableReportScope, type: DocumentType.PURCHASE_BILL, status: WorkflowStatus.POSTED, totalMinor: { gt: 0 } },
          include: { supplier: true, targetDocuments: { where: {
            type: DocumentType.PURCHASE_RETURN,
            status: WorkflowStatus.POSTED,
            ...(scopedBranchIds ? { branchId: { in: scopedBranchIds } } : {}),
            supplier: { is: this.supplierScope(actor) },
          } } },
        });
        const today = Date.now();
        const rows = docs.map((doc) => { const credits = doc.targetDocuments.filter((target) => target.status === WorkflowStatus.POSTED && target.type === DocumentType.PURCHASE_RETURN).reduce((sum, target) => sum + target.totalMinor, 0n); const outstandingMinor = doc.totalMinor - doc.paidMinor - credits; const days = Math.max(0, Math.floor((today - (doc.dueDate || doc.documentDate).valueOf()) / 86_400_000)); return { number: doc.number, party: doc.supplier?.name, dueDate: doc.dueDate, outstandingMinor, bucket: days <= 0 ? 'Current' : days <= 30 ? '1–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : 'More than 90 days' }; }).filter((row) => row.outstandingMinor > 0n);
        return { name: 'Accounts payable aging', rows, totals: { outstandingMinor: rows.reduce((sum, row) => sum + row.outstandingMinor, 0n) } };
      }
      if (name === 'customer-balances') {
        const customers = await tx.customer.findMany({
          where: { AND: [this.customerScope(actor), ...(scopedBranchIds ? [{ companyId: { in: dataCompanyIds }, defaultBranchId: { in: scopedBranchIds } }] : [])] },
          orderBy: { code: 'asc' },
        });
        const balances = await this.receivables.customerBalances(tx, customers.map((customer) => customer.id), scopedBranchIds, invoiceReportScope);
        const tenant = await tx.tenant.findFirstOrThrow({ select: { baseCurrency: true } });
        const rows = customers.map((customer) => ({
          customerCode: customer.code,
          customer: customer.name,
          currency: tenant.baseCurrency,
          outstandingMinor: balances.get(customer.id.toString()) || 0n,
          status: customer.active ? 'ACTIVE' : 'INACTIVE',
        }));
        return { name: 'Customer balances', rows, totals: { outstandingMinor: rows.reduce((sum, row) => sum + row.outstandingMinor, 0n) } };
      }
      if (name === 'customer-statement' || name === 'supplier-statement') {
        const customerSide = name === 'customer-statement';
        if (customerSide) {
          const statement = await this.receivables.customerStatement(tx, {
            branchIds: scopedBranchIds,
            documentScope: customerStatementDocumentScope,
            paymentScope: { AND: [
              this.paymentScope(actor),
              { customer: { is: this.customerScope(actor) } },
              { allocations: { some: { document: receivableReportScope } } },
            ] },
            allocationDocumentScope: receivableReportScope,
          });
          const rows = statement.map(({ customerId: _customerId, ...row }) => row);
          return { name: 'Customer statement', rows, totals: { balanceMinor: rows.reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0n) } };
        }
        const documents = await tx.document.findMany({ where: {
          status: WorkflowStatus.POSTED,
          OR: [
            { type: DocumentType.PURCHASE_BILL, ...payableReportScope },
            { type: DocumentType.PURCHASE_RETURN, ...payableReturnReportScope },
          ],
        }, include: { customer: true, supplier: true } });
        const payments = await tx.payment.findMany({ where: { AND: [
          this.paymentScope(actor),
          { kind: customerSide ? PaymentKind.RECEIPT : PaymentKind.PAYMENT, status: PaymentStatus.POSTED },
          { supplier: { is: this.supplierScope(actor) } },
          { allocations: { some: { document: payableReportScope } } },
          scopedBranchIds ? { branchId: { in: scopedBranchIds } } : {},
        ] }, include: {
          customer: true,
          supplier: true,
          allocations: { where: { document: payableReportScope }, select: { amountMinor: true } },
        } });
        const rows = [
          ...documents.map((doc) => { const credit = new Set<DocumentType>([DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE, DocumentType.PURCHASE_RETURN]).has(doc.type); return { date: doc.documentDate, party: doc.customer?.name || doc.supplier?.name, reference: doc.number, transaction: credit ? doc.type.replaceAll('_', ' ') : customerSide ? 'Invoice' : 'Supplier bill', debitMinor: credit ? 0n : doc.totalMinor, creditMinor: credit ? doc.totalMinor : 0n }; }),
          ...payments.map((payment) => ({
            date: payment.postingDate,
            party: payment.customer?.name || payment.supplier?.name,
            reference: payment.number,
            transaction: customerSide ? 'Receipt' : 'Supplier payment',
            debitMinor: 0n,
            creditMinor: payment.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0n),
          })).filter((row) => row.creditMinor > 0n),
        ].sort((a, b) => a.date.valueOf() - b.date.valueOf());
        return { name: 'Supplier statement', rows, totals: { balanceMinor: rows.reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0n) } };
      }
      if (name === 'inventory-valuation') {
        const rows = await tx.stockBalance.findMany({ where: inventoryScope, include: { item: true, warehouse: true }, orderBy: [{ warehouse: { code: 'asc' } }, { item: { sku: 'asc' } }] });
        return { name: 'Inventory valuation', rows: rows.map((row) => ({ warehouse: row.warehouse.name, sku: row.item.sku, item: row.item.name, quantityMilli: row.quantityMilli, valueMinor: row.valueMinor })), totals: { valueMinor: rows.reduce((sum, row) => sum + row.valueMinor, 0n) } };
      }
      if (name === 'stock-movements') {
        const movements = await tx.stockMovement.findMany({ where: movementScope, include: { item: true, warehouse: true }, orderBy: [{ postingDate: 'desc' }, { id: 'desc' }], take: 500 });
        return { name: 'Stock movements', rows: movements.map((movement) => {
          const visible: any = { ...movement, item: this.itemForActor(actor, movement.item) };
          if (this.fieldAccess(actor, 'document', 'costMinor') === 'HIDDEN') {
            delete visible.unitCostMinor; delete visible.totalCostMinor; delete visible.runningValueMinor;
          }
          return visible;
        }) };
      }
      if (name === 'tax-report') {
        const output = byAccount.find((row) => row.code === '2200'), input = byAccount.find((row) => row.code === '1300');
        return { name: 'VAT report', rows: [output, input].filter(Boolean), totals: { outputVatMinor: -(output?.balanceMinor || 0n), inputVatMinor: input?.balanceMinor || 0n, netPayableMinor: -(output?.balanceMinor || 0n) - (input?.balanceMinor || 0n) } };
      }
      if (name === 'sales-profitability') {
        const docs = await tx.document.findMany({
          where: {
            ...receivableReportScope,
            type: DocumentType.SALES_INVOICE,
            status: WorkflowStatus.POSTED,
            sourceDocument: { is: profitabilityDeliveryScope },
          },
          include: { customer: true, sourceDocument: { select: { costMinor: true } } },
        });
        const rows = docs.map((doc) => {
          const costMinor = doc.sourceDocument!.costMinor;
          return { number: doc.number, customer: doc.customer?.name, revenueMinor: doc.subtotalMinor - doc.discountMinor, costMinor, marginMinor: doc.subtotalMinor - doc.discountMinor - costMinor };
        });
        return { name: 'Sales and profitability', rows, totals: { revenueMinor: rows.reduce((sum, row) => sum + row.revenueMinor, 0n), costMinor: rows.reduce((sum, row) => sum + row.costMinor, 0n), marginMinor: rows.reduce((sum, row) => sum + row.marginMinor, 0n) } };
      }
      if (name === 'purchase-analysis') {
        const docs = await tx.document.findMany({ where: {
          status: WorkflowStatus.POSTED,
          OR: [
            { type: DocumentType.PURCHASE_BILL, ...payableReportScope },
            { type: DocumentType.PURCHASE_RETURN, ...payableReturnReportScope },
          ],
        }, include: { supplier: true } });
        return { name: 'Purchase analysis', rows: docs.map((doc) => ({ number: doc.number, supplier: doc.supplier?.name, type: doc.type, amountMinor: doc.type === DocumentType.PURCHASE_RETURN ? -doc.totalMinor : doc.totalMinor })) };
      }
      if (name === 'cash-flow') {
        const rows = byAccount.filter((row) => ['1000', '1010', '1020'].includes(row.code));
        return { name: 'Cash and bank position', rows, totals: { cashMinor: rows.reduce((sum, row) => sum + row.balanceMinor, 0n) } };
      }
      if (name === 'pos-shifts') {
        const shifts = await tx.posShift.findMany({ where: { AND: [
          this.posShiftDataScope(actor, 'report'),
          this.posShiftDataScope(actor, 'pos_terminal'),
          scopedBranchIds ? { branchId: { in: scopedBranchIds } } : {},
        ] }, include: { branch: true, openedBy: publicUser, closedBy: publicUser, sales: { where: { status: { in: [PosSaleStatus.COMPLETED, PosSaleStatus.RETURNED] } } } }, orderBy: { openedAt: 'desc' }, take: 100 });
        const rows = shifts.map((shift) => ({ register: shift.registerCode, branch: shift.branch.name, openedAt: shift.openedAt, closedAt: shift.closedAt, openedBy: shift.openedBy.name, closedBy: shift.closedBy?.name || 'Open', salesCount: shift.sales.length, openingCashMinor: shift.openingCashMinor, expectedCashMinor: shift.expectedCashMinor, actualCashMinor: shift.actualCashMinor || 0n, differenceMinor: shift.differenceMinor || 0n, status: shift.status }));
        return { name: 'POS shift closing report', rows, totals: { differenceMinor: rows.reduce((sum, row) => sum + row.differenceMinor, 0n) } };
      }
      if (name === 'reconciliation') {
        const arLedger = byAccount.find((row) => row.code === '1100')?.balanceMinor || 0n, apLedger = -(byAccount.find((row) => row.code === '2000')?.balanceMinor || 0n), inventoryLedger = byAccount.find((row) => row.code === '1200')?.balanceMinor || 0n;
        const reconciliationCustomers = await tx.customer.findMany({ where: this.customerScope(actor), select: { id: true } });
        const arBalances = await this.receivables.customerBalances(tx, reconciliationCustomers.map(({ id }) => id), scopedBranchIds, invoiceReportScope);
        const arSubledger = [...arBalances.values()].reduce((sum, balance) => sum + balance, 0n);
        const apDocs = await tx.document.aggregate({ where: { ...payableReportScope, type: DocumentType.PURCHASE_BILL, status: WorkflowStatus.POSTED }, _sum: { totalMinor: true, paidMinor: true } });
        const apCredits = await tx.document.aggregate({ where: {
          type: DocumentType.PURCHASE_RETURN,
          status: WorkflowStatus.POSTED,
          sourceDocument: { is: { ...payableReportScope, type: DocumentType.PURCHASE_BILL, status: WorkflowStatus.POSTED } },
        }, _sum: { totalMinor: true } });
        const stock = await tx.stockBalance.aggregate({ where: inventoryScope, _sum: { valueMinor: true } });
        const apSubledger = (apDocs._sum.totalMinor || 0n) - (apDocs._sum.paidMinor || 0n) - (apCredits._sum.totalMinor || 0n), inventorySubledger = stock._sum.valueMinor || 0n;
        return { name: 'Control account reconciliation', rows: [{ control: 'Accounts receivable', ledgerMinor: arLedger, subledgerMinor: arSubledger, differenceMinor: arLedger - arSubledger }, { control: 'Accounts payable', ledgerMinor: apLedger, subledgerMinor: apSubledger, differenceMinor: apLedger - apSubledger }, { control: 'Inventory', ledgerMinor: inventoryLedger, subledgerMinor: inventorySubledger, differenceMinor: inventoryLedger - inventorySubledger }] };
      }
      throw new NotFoundException('Report not found');
    });
  }

  async reportOutput(actor: Actor, name: string, action: 'export' | 'print', query: any = {}) {
    const resource = ['income-statement', 'balance-sheet', 'sales-profitability'].includes(name) ? 'profitability' : 'standard';
    const permissions = [`reports.${resource}.view`, `reports.${resource}.${action}`];
    if (!can(actor, 'system.super_admin') && !this.companiesForAllPermissions(actor, permissions).length) {
      throw new ForbiddenException('Report view and output permissions must be effective in the same company.');
    }
    if (this.scope(actor, action) === 'NONE') throw new ForbiddenException(`${action} is outside your access scope`);
    return this.report(actor, name, action, query);
  }

  async documentOutput(actor: Actor, id: bigint, action: 'print' | 'export') {
    if (this.scope(actor, action) === 'NONE') throw new ForbiddenException(`${action} is outside your access scope`);
    await this.withTenant(actor, async (tx) => {
      const header = await tx.document.findUnique({ where: { id }, select: { type: true, branchId: true } });
      if (!header) throw new NotFoundException('Document not found');
      this.requireDocumentPermission(actor, header.type, action, header.branchId);
      return true;
    });
    return this.documentDetail(actor, id);
  }

  async dashboard(actor: Actor) {
    const dashboardBranches = this.branchesForPermissions(actor, ['dashboard.overview.view']);
    const dashboardCompanies = this.companiesForPermissions(actor, ['dashboard.overview.view']);
    if (!can(actor, 'system.super_admin') && !dashboardBranches.length) requirePermission(actor, 'dashboard.overview.view');
    return this.withTenant(actor, async (tx) => {
      const permittedDashboardBranches = (permissions: readonly string[]) => {
        const permitted = this.branchesForPermissions(actor, permissions);
        return dashboardBranches.filter((branchId) => permitted.includes(branchId));
      };
      const scopeForBranches = (branches: bigint[]): Prisma.DocumentWhereInput => ({ AND: [this.documentScope(actor, 'report'), { branchId: { in: branches } }] });
      const salesBranches = permittedDashboardBranches(['sales.invoice.view', 'sales.overview.view']);
      const purchaseBranches = permittedDashboardBranches(['purchasing.bill.view', 'purchasing.overview.view']);
      const inventoryBranches = permittedDashboardBranches(['inventory.overview.view', 'inventory.item.view']);
      const cashBranches = permittedDashboardBranches(['banking.account.view', 'accounting.journal.view']);
      const receivableBranches = permittedDashboardBranches(['sales.customer.view', 'sales.invoice.view', 'sales.overview.view']);
      const approvalBranches = permittedDashboardBranches(['approvals.queue.view']);
      const warehouseIds = can(actor, 'system.super_admin') ? undefined : actor.warehouseIds.map(BigInt);
      const stockScope: Prisma.StockBalanceWhereInput = can(actor, 'system.super_admin') ? {} : {
        warehouseId: { in: warehouseIds || [] }, warehouse: { branchId: { in: inventoryBranches } },
      };
      const canSeeSales = salesBranches.length > 0;
      const canSeePurchases = purchaseBranches.length > 0;
      const canSeeInventory = inventoryBranches.length > 0;
      const canSeeInventoryValue = canSeeInventory && (this.fieldAccess(actor, 'document', 'costMinor') !== 'HIDDEN' || this.fieldAccess(actor, 'item', 'costPriceMinor') !== 'HIDDEN');
      const canSeeCash = cashBranches.length > 0 && this.fieldAccess(actor, 'bankAccount', 'accountNumber') !== 'HIDDEN';
      const canSeeReceivables = receivableBranches.length > 0 && this.fieldAccess(actor, 'customer', 'balanceMinor') !== 'HIDDEN';
      const cashCompanies = actor.companyIds.filter((companyId) => (actor.companyBranchIds[companyId] || []).some((branchId) => cashBranches.some((candidate) => candidate.toString() === branchId))).map(BigInt);
      const scopedReceivables = async () => {
        if (!canSeeReceivables) return 0n;
        if (this.scope(actor, 'report') !== 'OWN' && this.scope(actor, 'report') !== 'ASSIGNED') return this.receivables.totalReceivables(tx, receivableBranches);
        const customers = await tx.customer.findMany({ where: this.customerScope(actor), select: { id: true } });
        const balances = await this.receivables.customerBalances(tx, customers.map(({ id }) => id), receivableBranches);
        return [...balances.values()].reduce((sum, value) => sum + value, 0n);
      };
      const [sales, salesCredits, purchases, purchaseCredits, inventory, pending, lowStock, activity, bankAccounts, receivablesMinor] = await Promise.all([
        tx.document.aggregate({ where: { ...scopeForBranches(salesBranches), type: DocumentType.SALES_INVOICE, status: WorkflowStatus.POSTED }, _sum: { totalMinor: true, paidMinor: true } }),
        tx.document.aggregate({ where: { ...scopeForBranches(salesBranches), type: { in: [DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE] }, status: WorkflowStatus.POSTED }, _sum: { totalMinor: true } }),
        tx.document.aggregate({ where: { ...scopeForBranches(purchaseBranches), type: DocumentType.PURCHASE_BILL, status: WorkflowStatus.POSTED }, _sum: { totalMinor: true, paidMinor: true } }),
        tx.document.aggregate({ where: { ...scopeForBranches(purchaseBranches), type: DocumentType.PURCHASE_RETURN, status: WorkflowStatus.POSTED, sourceDocument: { type: DocumentType.PURCHASE_BILL } }, _sum: { totalMinor: true } }),
        tx.stockBalance.aggregate({ where: stockScope, _sum: { valueMinor: true } }),
        approvalBranches.length ? tx.document.count({ where: { ...scopeForBranches(approvalBranches), status: WorkflowStatus.SUBMITTED } }) : Promise.resolve(0),
        canSeeInventory ? tx.stockBalance.findMany({ where: stockScope, include: { item: true, warehouse: true }, orderBy: { quantityMilli: 'asc' }, take: 8 }) : Promise.resolve([]),
        tx.auditEvent.findMany({ where: this.auditVisibilityScope(actor, dashboardCompanies, dashboardBranches), include: { user: publicUser }, orderBy: { createdAt: 'desc' }, take: 8 }),
        canSeeCash ? tx.bankAccount.findMany({ where: { active: true, AND: [this.resourceIdScope(actor, 'bank_account'), { financialResources: { some: { companyId: { in: cashCompanies }, active: true } } }] }, select: { glAccountId: true } }) : Promise.resolve([]),
        scopedReceivables(),
      ]);
      const cashLedger = await tx.journalLine.aggregate({
        where: { accountId: { in: bankAccounts.map((account) => account.glAccountId) }, journalEntry: { status: JournalStatus.POSTED, AND: [this.journalScope(actor, 'report'), { branchId: { in: cashBranches } }] } },
        _sum: { debitMinor: true, creditMinor: true },
      });
      return {
        kpis: {
          salesMinor: canSeeSales ? (sales._sum.totalMinor || 0n) - (salesCredits._sum.totalMinor || 0n) : 0n,
          purchasesMinor: canSeePurchases ? (purchases._sum.totalMinor || 0n) - (purchaseCredits._sum.totalMinor || 0n) : 0n,
          cashMinor: canSeeCash ? (cashLedger._sum.debitMinor || 0n) - (cashLedger._sum.creditMinor || 0n) : 0n,
          receivablesMinor: canSeeReceivables ? receivablesMinor : 0n,
          payablesMinor: canSeePurchases ? (purchases._sum.totalMinor || 0n) - (purchases._sum.paidMinor || 0n) - (purchaseCredits._sum.totalMinor || 0n) : 0n,
          inventoryMinor: canSeeInventoryValue ? inventory._sum.valueMinor || 0n : 0n,
          pendingApprovals: pending,
        },
        lowStock: lowStock.map((row) => {
          const visible: any = { ...row, item: this.itemForActor(actor, row.item) };
          if (!canSeeInventoryValue) delete visible.valueMinor;
          return visible;
        }),
        activity: activity.map((entry) => this.auditForActor(actor, entry)),
      };
    });
  }

  async reset(actor: Actor, body: any) {
    requirePermission(actor, 'settings.system.reset');
    if (!demoResetEnabled()) throw new ForbiddenException('Tenant demo reset is disabled in this deployment.');
    if (body.confirmation !== 'RESET ODIN') throw new BadRequestException('Type RESET ODIN to confirm');
    const user = await this.db.admin.user.findUnique({ where: { id: actor.userId } });
    if (!user || !(await compare(String(body.password || ''), user.passwordHash))) throw new ForbiddenException('Administrator password is incorrect');
    await seed(actor.email, actor.tenantId);
    const journals = await this.db.admin.journalEntry.findMany({ where: { tenantId: actor.tenantId, status: JournalStatus.POSTED }, include: { lines: true } });
    const balanced = journals.every((journal) => journal.lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n) === 0n);
    const stock = await this.db.admin.stockBalance.aggregate({ where: { tenantId: actor.tenantId }, _sum: { valueMinor: true }, _min: { quantityMilli: true, valueMinor: true } });
    const inventoryLines = await this.db.admin.journalLine.findMany({ where: { tenantId: actor.tenantId, account: { code: '1200' }, journalEntry: { status: JournalStatus.POSTED } } });
    const inventoryLedger = inventoryLines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n);
    const integrity = { postedJournalsBalanced: balanced, postedJournalCount: journals.length, negativeStockRows: (stock._min.quantityMilli || 0n) < 0n || (stock._min.valueMinor || 0n) < 0n ? 1 : 0, inventoryDifferenceMinor: (inventoryLedger - (stock._sum.valueMinor || 0n)).toString() };
    return { reset: true, sessionInvalidated: true, integrity, message: 'Odin demo tenant rebuilt from deterministic PostgreSQL seed' };
  }
}
