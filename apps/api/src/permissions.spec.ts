import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
    await expect(service.reportOutput(actor({ permissions: ['reports.standard.print', 'reports.profitability.view'] }), 'income-statement', 'print'))
      .rejects.toThrow(ForbiddenException);
    await expect(service.reportOutput(actor({ permissions: ['reports.standard.print', 'reports.standard.view'] }), 'trial-balance', 'print'))
      .resolves.toMatchObject({ name: 'Report' });
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
    await expect(service.documentOutput(actor({ permissions: ['sales.quotation.print', 'sales.invoice.view'] }), 9n, 'print'))
      .rejects.toThrow(ForbiddenException);
    await expect(service.documentOutput(actor({ permissions: ['sales.invoice.print', 'sales.invoice.view'] }), 9n, 'print'))
      .resolves.toMatchObject({ id: '9' });

    await service.posState(actor({ permissions: ['pos.register.view'], branchIds: ['4'], warehouseIds: ['7'] }));
    expect(shiftFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { branchId: { in: [4n] }, warehouseId: { in: [7n] } } }));
    expect(saleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shift: { branchId: { in: [4n] }, warehouseId: { in: [7n] } } } }));
  });
});
