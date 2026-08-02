import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Actor } from './auth';
import { can, requirePermission } from './auth';
import { AuthorizationGuard } from './authorization.guard';
import { hasPermission, normalizePermissions, PERMISSION_REGISTRY } from './permissions';

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
});
