import type { Actor } from './auth';
import { can } from './auth';

export function fieldAccess(actor: Actor, resource: string, field: string) {
  if (can(actor, 'system.super_admin')) return 'EDIT';
  return actor.fieldPermissions.find((entry) => entry.resource === resource && entry.field === field)?.access || 'HIDDEN';
}

function clone(value: any) {
  return value && typeof value === 'object' ? { ...value } : value;
}

type ProjectableResource = 'customer' | 'supplier' | 'item' | 'bankAccount' | 'employee' | 'document' | 'journal' | 'payment' | 'audit' | 'approval';

export function projectRecord(actor: Actor, resource: ProjectableResource, input: any, seen = new WeakSet<object>()): any {
  if (!input) return input;
  if (typeof input === 'object') {
    if (seen.has(input)) return resource === 'document'
      ? { id: input.id, type: input.type, number: input.number, status: input.status, branchId: input.branchId }
      : undefined;
    seen.add(input);
  }
  const visible = clone(input);
  if (resource === 'customer') {
    if (fieldAccess(actor, 'customer', 'creditLimitMinor') === 'HIDDEN' && !actor.legacyPermissions.includes('customers.view-credit')) delete visible.creditLimitMinor;
    if (fieldAccess(actor, 'customer', 'paymentTermsDays') === 'HIDDEN' && !actor.legacyPermissions.includes('customers.view-credit')) { delete visible.paymentTermsDays; delete visible.creditHold; }
    if (fieldAccess(actor, 'customer', 'balanceMinor') === 'HIDDEN' && !actor.legacyPermissions.includes('customers.view-credit')) { delete visible.outstandingMinor; delete visible.statement; delete visible.ageing; }
    if (fieldAccess(actor, 'party', 'taxNumber') === 'HIDDEN') { delete visible.taxNumber; delete visible.registrationNumber; }
  } else if (resource === 'supplier') {
    if (fieldAccess(actor, 'party', 'taxNumber') === 'HIDDEN') { delete visible.taxNumber; delete visible.registrationNumber; }
  } else if (resource === 'item') {
    if (fieldAccess(actor, 'item', 'purchasePriceMinor') === 'HIDDEN') delete visible.purchasePriceMinor;
    if (fieldAccess(actor, 'item', 'costPriceMinor') === 'HIDDEN') delete visible.costPriceMinor;
  } else if (resource === 'bankAccount') {
    if (fieldAccess(actor, 'bankAccount', 'accountNumber') === 'HIDDEN') delete visible.accountNumber;
  } else if (resource === 'employee') {
    if (fieldAccess(actor, 'employee', 'salaryMinor') === 'HIDDEN') delete visible.salaryMinor;
  } else if (resource === 'journal') {
    if (fieldAccess(actor, 'journal', 'lines') === 'HIDDEN' && !actor.legacyPermissions.includes('invoices.view-accounting')) delete visible.lines;
  } else if (resource === 'audit') {
    if (fieldAccess(actor, 'audit', 'values') === 'HIDDEN') { delete visible.previousValues; delete visible.newValues; delete visible.previousValue; delete visible.newValue; }
    if (fieldAccess(actor, 'audit', 'metadata') === 'HIDDEN') {
      for (const field of ['ipAddress', 'userAgent', 'sessionId', 'requestId', 'denialReason', 'dataScopeReason', 'fieldSecurityReason', 'roleLimitReason', 'route', 'httpMethod', 'companyId', 'branchId', 'warehouseId', 'resourceType', 'resourceId', 'requestedAction', 'user', 'userId', 'actorUserId', 'subjectUserId', 'subjectRoleId']) delete visible[field];
    }
    if (fieldAccess(actor, 'audit', 'references') === 'HIDDEN') { delete visible.postingReference; delete visible.approvalReference; }
  } else if (resource === 'approval') {
    if (fieldAccess(actor, 'approval', 'evidence') === 'HIDDEN') {
      for (const field of ['comment', 'actor', 'actorId', 'createdAt']) delete visible[field];
    }
  } else if (resource === 'document') {
    // Legacy attachment JSON may contain public/predictable URLs. It is never
    // projected; clients use authenticated private-attachment metadata routes.
    delete visible.attachments;
    if (fieldAccess(actor, 'document', 'notes') === 'HIDDEN') delete visible.notes;
    if (fieldAccess(actor, 'document', 'costMinor') === 'HIDDEN') delete visible.costMinor;
    if (fieldAccess(actor, 'document', 'profitMargin') === 'HIDDEN') delete visible.profitMargin;
    if (visible.customer) visible.customer = projectRecord(actor, 'customer', visible.customer, seen);
    if (visible.supplier) visible.supplier = projectRecord(actor, 'supplier', visible.supplier, seen);
    if (visible.salesEmployee) visible.salesEmployee = projectRecord(actor, 'employee', visible.salesEmployee, seen);
    if (visible.journalEntry) visible.journalEntry = projectRecord(actor, 'journal', visible.journalEntry, seen);
    if (visible.sourceDocument) visible.sourceDocument = projectRecord(actor, 'document', visible.sourceDocument, seen);
    if (Array.isArray(visible.targetDocuments)) visible.targetDocuments = visible.targetDocuments.map((document: any) => projectRecord(actor, 'document', document, seen));
    if (Array.isArray(visible.approvals)) visible.approvals = visible.approvals.map((approval: any) => projectRecord(actor, 'approval', approval, seen));
    if (Array.isArray(visible.lines)) visible.lines = visible.lines.map((line: any) => {
      const projected = clone(line);
      if (projected.item) projected.item = projectRecord(actor, 'item', projected.item, seen);
      if (Array.isArray(projected.targetLines)) projected.targetLines = projected.targetLines.map((targetLine: any) => ({
        ...targetLine,
        ...(targetLine.document ? { document: projectRecord(actor, 'document', targetLine.document, seen) } : {}),
      }));
      if (fieldAccess(actor, 'document', 'costMinor') === 'HIDDEN') { delete projected.unitCostMinor; delete projected.costMinor; }
      return projected;
    });
  } else if (resource === 'payment') {
    delete visible.allocationPlan;
    if (visible.customer) visible.customer = projectRecord(actor, 'customer', visible.customer, seen);
    if (visible.supplier) visible.supplier = projectRecord(actor, 'supplier', visible.supplier, seen);
    if (visible.bankAccount) visible.bankAccount = projectRecord(actor, 'bankAccount', visible.bankAccount, seen);
    if (visible.journalEntry) visible.journalEntry = projectRecord(actor, 'journal', visible.journalEntry, seen);
    if (Array.isArray(visible.allocations)) visible.allocations = visible.allocations.map((allocation: any) => ({
      ...allocation,
      ...(allocation.document ? { document: projectRecord(actor, 'document', allocation.document, seen) } : {}),
    }));
    if (Array.isArray(visible.plannedAllocations)) visible.plannedAllocations = visible.plannedAllocations.map((allocation: any) => ({
      ...allocation,
      ...(allocation.document ? { document: projectRecord(actor, 'document', allocation.document, seen) } : {}),
    }));
  }
  return visible;
}
