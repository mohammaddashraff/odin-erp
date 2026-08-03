import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Actor } from './auth';
import { can, requirePermission } from './auth';
import { AuthorizationGuard } from './authorization.guard';
import { hasPermission, normalizePermissions, PERMISSION_REGISTRY } from './permissions';
import { ErpService } from './erp.service';

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  userId: 1n,
  tenantId: 1n,
  email: 'permission-test@odin.test',
  name: 'Permission Test',
  role: 'Test role',
  roleIds: ['1'],
  permissions: [],
  deniedPermissions: [],
  legacyPermissions: [],
  dataScopes: [],
  fieldPermissions: [],
  limits: {},
  branchIds: ['1'],
  warehouseIds: ['1'],
  ...overrides,
});

function contextFor(testActor?: Actor) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ actor: testActor }) }),
  } as unknown as ExecutionContext;
}

describe('centralized permission policy', () => {
  it('keeps permission registry keys unique and normalized', () => {
    const keys = PERMISSION_REGISTRY.map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key === 'system.super_admin' || /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(key))).toBe(true);
    expect(normalizePermissions(['quotations.create'])).toContain('sales.quotation.create');
  });

  it('keeps literal controller permission decorators in the registry', () => {
    const registered = new Set(PERMISSION_REGISTRY.map(({ key }) => key));
    const controllers = ['erp.controller.ts', 'access-control.controller.ts'];
    const referenced = controllers.flatMap((file) => {
      const source = readFileSync(join(__dirname, file), 'utf8');
      return [...source.matchAll(/@Require(?:AnyPermission|Permissions)\(([^)]*)\)/g)]
        .flatMap((match) => [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((permission) => permission[1]));
    });
    expect([...new Set(referenced)].filter((permission) => !registered.has(permission))).toEqual([]);
  });

  it('supports exact, module wildcard, and Super Admin grants', () => {
    expect(hasPermission(['sales.quotation.create'], [], 'sales.quotation.create')).toBe(true);
    expect(hasPermission(['sales.*'], [], 'sales.invoice.post')).toBe(true);
    expect(hasPermission(['system.super_admin'], [], 'settings.users_access.manage')).toBe(true);
    expect(hasPermission(['sales.quotation.view'], [], 'sales.quotation.edit')).toBe(false);
  });

  it('makes an explicit deny win over role, wildcard, Super Admin, and legacy grants', () => {
    const denied = actor({
      permissions: ['system.super_admin', 'sales.*', 'sales.quotation.approve'],
      deniedPermissions: ['sales.quotation.approve'],
      legacyPermissions: ['*', 'quotations.approve'],
    });
    expect(can(denied, 'sales.quotation.approve')).toBe(false);
    expect(() => requirePermission(denied, 'sales.quotation.approve')).toThrow(ForbiddenException);
  });

  it('allows an authorized API policy and rejects direct unauthorized access with 403', () => {
    const getAllAndMerge = jest.fn();
    const reflector = { getAllAndMerge } as unknown as Reflector;
    const guard = new AuthorizationGuard(reflector);
    getAllAndMerge
      .mockReturnValueOnce(['sales.quotation.create'])
      .mockReturnValueOnce([]);
    expect(guard.canActivate(contextFor(actor({ permissions: ['sales.quotation.create'] })))).toBe(true);

    getAllAndMerge
      .mockReturnValueOnce(['sales.quotation.create'])
      .mockReturnValueOnce([]);
    expect(() => guard.canActivate(contextFor(actor({ permissions: ['sales.quotation.view'] })))).toThrow(ForbiddenException);
  });

  it('requires the exact report output class instead of any report print grant', async () => {
    const service = new ErpService({} as any);
    jest.spyOn(service, 'report').mockResolvedValue({ name: 'Report', rows: [] } as any);
    await expect(service.reportOutput(actor({ permissions: ['reports.standard.print', 'reports.profitability.view'], dataScopes: [{ resource: 'print', scope: 'ALL' }] }), 'income-statement', 'print'))
      .rejects.toThrow(ForbiddenException);
    await expect(service.reportOutput(actor({ permissions: ['reports.standard.print', 'reports.standard.view'], dataScopes: [{ resource: 'print', scope: 'ALL' }] }), 'trial-balance', 'print'))
      .resolves.toMatchObject({ name: 'Report' });
    await expect(service.reportOutput(actor({ permissions: ['reports.standard.print', 'reports.standard.view'] }), 'trial-balance', 'print'))
      .rejects.toThrow(ForbiddenException);
  });

  it('requires the target document print key and scopes POS list queries', async () => {
    const findUnique = jest.fn().mockResolvedValue({ type: 'SALES_INVOICE' });
    const shiftFindMany = jest.fn().mockResolvedValue([]);
    const saleFindMany = jest.fn().mockResolvedValue([]);
    const db = {
      tenant: async (_tenantId: bigint, work: (tx: any) => Promise<unknown>) => work({
        document: { findUnique },
        posShift: { findMany: shiftFindMany },
        posSale: { findMany: saleFindMany },
      }),
    };
    const service = new ErpService(db as any);
    jest.spyOn(service, 'documentDetail').mockResolvedValue({ id: '9' } as any);
    await expect(service.documentOutput(actor({ permissions: ['sales.quotation.print', 'sales.invoice.view'], dataScopes: [{ resource: 'print', scope: 'ALL' }] }), 9n, 'print'))
      .rejects.toThrow(ForbiddenException);
    await expect(service.documentOutput(actor({ permissions: ['sales.invoice.print', 'sales.invoice.view'], dataScopes: [{ resource: 'print', scope: 'ALL' }] }), 9n, 'print'))
      .resolves.toMatchObject({ id: '9' });

    await service.posState(actor({ permissions: ['pos.register.view'], branchIds: ['4'], warehouseIds: ['7'], dataScopes: [{ resource: 'pos_terminal', scope: 'BRANCH' }] }));
    expect(shiftFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { branchId: { in: [4n] }, warehouseId: { in: [7n] } } }));
    expect(saleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shift: { branchId: { in: [4n] }, warehouseId: { in: [7n] } } } }));
  });

  it.each([
    ['NONE', {}, { id: -1n }],
    ['OWN', {}, { createdById: 1n }],
    ['ASSIGNED', { employeeId: '22' }, { salespersonId: 22n }],
    ['TEAM', { dataScopes: [{ resource: 'invoice', scope: 'TEAM', config: { userIds: ['8', '9'] } }] }, { createdById: { in: [8n, 9n] } }],
    ['BRANCH', {}, { branchId: { in: [1n] } }],
    ['WAREHOUSE', {}, { warehouseId: { in: [1n] } }],
    ['DEPARTMENT', { departmentId: '12' }, { salesEmployee: { departmentId: 12n } }],
    ['ALL', {}, {}],
  ] as const)('enforces the %s document data scope at query level', (scope, extra, expected) => {
    const service = new ErpService({} as any);
    const scopedActor = actor({
      ...extra,
      dataScopes: (extra as any).dataScopes || [{ resource: 'invoice', scope }],
    });
    expect((service as any).documentScope(scopedActor, 'invoice', 'sales')).toEqual(expected);
  });

  it('defaults missing resource scopes to NONE and enforces assigned financial IDs', () => {
    const service = new ErpService({} as any);
    expect((service as any).resourceIdScope(actor(), 'bank_account')).toEqual({ id: -1n });
    const assigned = actor({ dataScopes: [{ resource: 'bank_account', scope: 'ASSIGNED', config: { resourceIds: ['41'] } }] });
    expect((service as any).resourceIdScope(assigned, 'bank_account')).toEqual({ id: { in: [41n] } });
    expect(() => (service as any).assertResourceId(assigned, 'bank_account', 42n)).toThrow(ForbiddenException);
    expect(() => (service as any).assertResourceId(assigned, 'bank_account', 41n)).not.toThrow();
  });

  it('maps purchasing document types to registered permission keys', async () => {
    const findUnique = jest.fn().mockResolvedValue({ type: 'PURCHASE_ORDER' });
    const db = { tenant: async (_tenantId: bigint, work: (tx: any) => Promise<unknown>) => work({ document: { findUnique } }) };
    const service = new ErpService(db as any);
    jest.spyOn(service, 'documentDetail').mockResolvedValue({ id: '15' } as any);
    await expect(service.documentOutput(actor({ permissions: ['purchasing.order.print', 'purchasing.order.view'], dataScopes: [{ resource: 'print', scope: 'ALL' }] }), 15n, 'print'))
      .resolves.toMatchObject({ id: '15' });
    await expect(service.documentOutput(actor({ permissions: ['purchasing.purchase_order.print', 'purchasing.order.view'], dataScopes: [{ resource: 'print', scope: 'ALL' }] }), 15n, 'print'))
      .rejects.toThrow(ForbiddenException);
  });
});
