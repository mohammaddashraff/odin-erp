import { canAtCompany, evaluateSodRules, resolveEffectiveAccess } from './access-governance';
import { AccessGovernanceService } from './access-governance.service';
import type { Actor } from './auth';
import { projectRecord } from './field-projection';

const now = new Date('2026-08-09T12:00:00.000Z');
const role = (permissions: string[]) => ({
  id: 1n, key: 'operator', name: 'Operator', active: true, permissions: [], limits: [], dataScopes: [], fieldPermissions: [],
  permissionAssignments: permissions.map((key) => ({ permission: { key } })),
});
const company = (id: bigint, branchId: bigint) => ({ id, active: true, branchLinks: [{ active: true, branchId }], financialResources: [] });
const membership = (companyId: bigint, branchId: bigint, membershipRole: 'MEMBER' | 'ADMINISTRATOR' = 'MEMBER') => ({
  id: companyId, companyId, role: membershipRole, active: true, validFrom: new Date('2026-01-01'), validUntil: null, company: company(companyId, branchId),
});
const user = (extra: Record<string, unknown> = {}) => ({
  id: 10n, tenantId: 1n, email: 'user@example.test', name: 'User', active: true, branchIds: ['11', '22'], warehouseIds: [],
  role: role(['sales.customer.view']), additionalRoles: [], permissionOverrides: [], companyMemberships: [membership(1n, 11n), membership(2n, 22n)],
  resourceAssignments: [], temporaryGrants: [], delegationsReceived: [], employee: null, mfaEnabled: false, ...extra,
});

describe('company-aware effective access', () => {
  it('derives bounded Company Administrator permissions only in the administered company', () => {
    const effective = resolveEffectiveAccess(user({ companyMemberships: [membership(1n, 11n, 'ADMINISTRATOR'), membership(2n, 22n)] }), now);
    expect(canAtCompany(effective, 'settings.users_access.manage', 1n)).toBe(true);
    expect(canAtCompany(effective, 'settings.users_access.manage', 2n)).toBe(false);
    expect(effective.companyScopedPermissions['1']).toContain('settings.users_access.view');
    expect(effective.companyScopedPermissions['2']).toBeUndefined();
  });

  it('keeps temporary permissions company-local and removes them immediately at expiry', () => {
    const grant = { id: 'grant', companyId: 1n, permissions: ['sales.invoice.view'], resourceAssignments: {}, validFrom: new Date('2026-08-01'), validUntil: new Date('2026-08-10'), revokedAt: null };
    const active = resolveEffectiveAccess(user({ temporaryGrants: [grant] }), now);
    expect(canAtCompany(active, 'sales.invoice.view', 1n)).toBe(true);
    expect(canAtCompany(active, 'sales.invoice.view', 2n)).toBe(false);
    const expired = resolveEffectiveAccess(user({ temporaryGrants: [grant] }), new Date('2026-08-10T00:00:00.000Z'));
    expect(canAtCompany(expired, 'sales.invoice.view', 1n)).toBe(false);
  });

  it('drops delegated resources on partial delegator permission loss', () => {
    const bankResource = { id: '00000000-0000-4000-8000-000000000010', companyId: 1n, type: 'BANK_ACCOUNT', linkedBankAccountId: 91n, linkedAccountId: null, active: true };
    const delegator = user({
      id: 20n, role: role(['sales.customer.view']), companyMemberships: [membership(1n, 11n)],
      resourceAssignments: [{ id: 4n, validFrom: new Date('2026-01-01'), validUntil: null, revokedAt: null, resource: bankResource }],
    });
    const delegation = {
      id: 'delegation', companyId: 1n, delegatorId: 20n, permissions: ['sales.customer.view', 'payments.payment.create'],
      resourceAssignments: { bank_account: ['91'] }, validFrom: new Date('2026-08-01'), validUntil: new Date('2026-08-20'), revokedAt: null, delegator,
    };
    const effective = resolveEffectiveAccess(user({ companyMemberships: [membership(1n, 11n)], delegationsReceived: [delegation] }), now);
    expect(effective.companyScopedPermissions['1']).toContain('sales.customer.view');
    expect(effective.companyResourceAssignments['1']?.bank_account).toBeUndefined();
  });

  it('matches SoD rules through wildcard permissions', () => {
    expect(evaluateSodRules(['accounting.*'], [{ key: 'journal', name: 'Journal conflict', enforcement: 'BLOCK', active: true, leftPermissions: ['accounting.journal.create'], rightPermissions: ['accounting.journal.post'] }]))
      .toHaveLength(1);
  });

  it('normalizes persisted legacy role aliases to the canonical SoD permission model', () => {
    const primary = { ...role([]), id: 1n, permissions: ['quotations.create'] };
    const additional = { ...role([]), id: 2n, permissions: ['quotations.convert'] };
    const effective = resolveEffectiveAccess(user({
      role: primary,
      additionalRoles: [{ role: additional }],
    }), now);

    expect(effective.permissions).toEqual(expect.arrayContaining([
      'sales.quotation.create',
      'sales.quotation.convert',
    ]));
    expect(evaluateSodRules(effective.permissions, [{
      key: 'quotation-maker-converter',
      name: 'Quotation maker and converter',
      enforcement: 'BLOCK',
      active: true,
      leftPermissions: ['sales.quotation.create'],
      rightPermissions: ['sales.quotation.convert'],
    }])).toHaveLength(1);
  });

  it('keeps explicit DENY effective in safe access simulation', async () => {
    const tx = {
      permission: { count: jest.fn().mockResolvedValue(2) },
      sodRule: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const db = { tenant: jest.fn().mockImplementation(async (_tenantId: bigint, work: (inner: any) => Promise<unknown>) => work(tx)) };
    const service = new AccessGovernanceService(db as any, {} as any);
    jest.spyOn(service as any, 'assertMember').mockResolvedValue({});
    jest.spyOn(service as any, 'subjectActor').mockResolvedValue({ effective: {
      permissions: ['sales.invoice.edit', 'sales.invoice.view'],
      deniedPermissions: ['sales.invoice.edit'],
      companyScopedPermissions: { '1': [] },
    } });

    const result = await service.simulate({ userId: 10n, tenantId: 1n } as Actor, {
      companyId: '1', userId: '10',
      proposed: { permissionKeys: ['sales.invoice.view', 'sales.invoice.edit'] },
    });

    expect(result.mutated).toBe(false);
    expect(result.current.permissionKeys).toEqual(['sales.invoice.view']);
    expect(result.proposed).toMatchObject({
      requestedPermissionKeys: ['sales.invoice.edit', 'sales.invoice.view'],
      permissionKeys: ['sales.invoice.view'],
      blockedByDeny: ['sales.invoice.edit'],
    });
  });
});

describe('central projection boundaries', () => {
  const restricted = {
    permissions: ['sales.invoice.view'], deniedPermissions: [], legacyPermissions: [],
    fieldPermissions: [],
  } as unknown as Actor;

  it('redacts nested documents, approval evidence, and privileged audit metadata', () => {
    const projected = projectRecord(restricted, 'document', {
      id: 1n, notes: 'TOP_SECRET', attachments: [{ url: 'PUBLIC_URL' }], costMinor: 99n,
      sourceDocument: { id: 2n, notes: 'SOURCE_SECRET', attachments: [{ url: 'SOURCE_URL' }], costMinor: 88n },
      targetDocuments: [{ id: 3n, notes: 'TARGET_SECRET', attachments: [{ url: 'TARGET_URL' }] }],
      lines: [{ targetLines: [{ document: { id: 4n, notes: 'LINE_TARGET_SECRET', attachments: [{ url: 'LINE_URL' }] } }] }],
      approvals: [{ id: 5n, action: 'APPROVE', comment: 'PRIVATE_COMMENT', actor: { email: 'actor@example.test' }, actorId: 9n, createdAt: now }],
    });
    const json = JSON.stringify(projected, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    expect(json).not.toMatch(/SECRET|PUBLIC_URL|SOURCE_URL|TARGET_URL|LINE_URL|PRIVATE_COMMENT|actor@example/);

    const audit = projectRecord(restricted, 'audit', { newValues: { secret: true }, ipAddress: '127.0.0.1', userAgent: 'secret-agent', requestId: 'secret-request', postingReference: 'JE-1' });
    expect(audit).toEqual({});
  });

  it('preserves explicitly VIEWable fields through nested projections', () => {
    const visible = {
      ...restricted,
      fieldPermissions: [
        { resource: 'document', field: 'notes', access: 'VIEW' },
        { resource: 'document', field: 'costMinor', access: 'VIEW' },
        { resource: 'approval', field: 'evidence', access: 'VIEW' },
        { resource: 'audit', field: 'values', access: 'VIEW' },
        { resource: 'audit', field: 'metadata', access: 'VIEW' },
        { resource: 'audit', field: 'references', access: 'VIEW' },
      ],
    } as unknown as Actor;
    const projected = projectRecord(visible, 'document', {
      id: 1n,
      notes: 'VISIBLE_NOTE',
      costMinor: 99n,
      sourceDocument: { id: 2n, notes: 'VISIBLE_SOURCE_NOTE', costMinor: 88n },
      approvals: [{ id: 3n, comment: 'VISIBLE_APPROVAL', actor: { email: 'visible@example.test' }, actorId: 10n, createdAt: now }],
    });
    expect(projected).toMatchObject({
      notes: 'VISIBLE_NOTE',
      costMinor: 99n,
      sourceDocument: { notes: 'VISIBLE_SOURCE_NOTE', costMinor: 88n },
      approvals: [{ comment: 'VISIBLE_APPROVAL', actor: { email: 'visible@example.test' } }],
    });
    expect(projectRecord(visible, 'audit', {
      newValues: { state: 'APPROVED' }, ipAddress: '127.0.0.1', postingReference: 'JE-1',
    })).toEqual({ newValues: { state: 'APPROVED' }, ipAddress: '127.0.0.1', postingReference: 'JE-1' });
  });
});
