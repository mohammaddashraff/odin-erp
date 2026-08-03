import { ForbiddenException, HttpStatus } from '@nestjs/common';
import type { Actor } from './auth';
import { AuthorizationDenialFilter, classifyAuthorizationDenial } from './authorization-denial.filter';

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  userId: 7n,
  tenantId: 3n,
  email: 'audited@odin.test',
  name: 'Audited User',
  role: 'Restricted',
  roleIds: ['2'],
  permissions: [],
  deniedPermissions: [],
  legacyPermissions: [],
  dataScopes: [],
  fieldPermissions: [],
  limits: {},
  branchIds: ['11'],
  warehouseIds: ['21'],
  sessionId: 'f67c978e-5a88-4eb2-9aef-646ef4f76de2',
  ...overrides,
});

describe('central authorization denial audit', () => {
  it.each([
    ['unauthenticated denial', HttpStatus.UNAUTHORIZED, { message: 'Sign in is required' }, undefined, 'AUTHENTICATION_REQUIRED', undefined],
    ['missing permission', HttpStatus.FORBIDDEN, { message: 'Permission required', permission: 'sales.invoice.export' }, actor(), 'MISSING_PERMISSION', undefined],
    ['explicit deny', HttpStatus.FORBIDDEN, { message: 'Permission required', permission: 'sales.invoice.export' }, actor({ permissions: ['sales.invoice.export'], deniedPermissions: ['sales.invoice.export'] }), 'EXPLICIT_DENY', undefined],
    ['wrong branch', HttpStatus.FORBIDDEN, { message: 'Branch is outside your access scope' }, actor(), 'DATA_SCOPE_DENIED', 'WRONG_BRANCH'],
    ['wrong warehouse', HttpStatus.FORBIDDEN, { message: 'Warehouse is outside your access scope' }, actor(), 'DATA_SCOPE_DENIED', 'WRONG_WAREHOUSE'],
    ['wrong company', HttpStatus.FORBIDDEN, { message: 'Company is outside your access scope' }, actor(), 'DATA_SCOPE_DENIED', 'WRONG_COMPANY'],
    ['wrong financial resource', HttpStatus.FORBIDDEN, { message: 'Bank account is outside your access scope' }, actor(), 'DATA_SCOPE_DENIED', 'WRONG_RESOURCE'],
    ['hidden field', HttpStatus.FORBIDDEN, { message: 'Salary field is hidden for your role' }, actor(), 'FIELD_SECURITY_DENIED', undefined],
    ['approval limit', HttpStatus.FORBIDDEN, { message: 'Document exceeds the approval limit' }, actor(), 'ROLE_LIMIT_DENIED', undefined],
    ['attachment denial', HttpStatus.FORBIDDEN, { message: 'Attachment is outside your access scope' }, actor(), 'DATA_SCOPE_DENIED', 'ATTACHMENT_SCOPE'],
    ['export denial', HttpStatus.FORBIDDEN, { message: 'Export is outside your access scope' }, actor(), 'DATA_SCOPE_DENIED', 'EXPORT_SCOPE'],
  ])('classifies %s', (_label, statusCode, body, requestActor, reason, scopeReason) => {
    expect(classifyAuthorizationDenial(statusCode as number, body, requestActor as Actor | undefined, {
      method: 'GET', originalUrl: '/api/resource/42?token=never-log', params: { id: '42' },
    })).toMatchObject({ denialReason: reason, dataScopeReason: scopeReason, resourceId: '42', route: '/api/resource/42' });
  });

  it('persists only safe request metadata and still returns 403 when the audit write fails', async () => {
    const create = jest.fn().mockRejectedValue(new Error('audit database unavailable'));
    const reply = jest.fn();
    const setHeader = jest.fn();
    const error = jest.spyOn(console, 'error').mockImplementation();
    const filter = new AuthorizationDenialFilter({ httpAdapter: { reply } } as any, { admin: { accessAuditLog: { create } } } as any);
    const request = {
      actor: actor(),
      method: 'POST',
      originalUrl: '/api/banking/42?token=query-secret',
      params: { id: '42' },
      headers: { 'x-request-id': 'denial-123', 'user-agent': 'test-agent', authorization: 'Bearer header-secret' },
      body: { password: 'body-secret', salary: 'sensitive' },
      ip: '127.0.0.1',
    };
    await filter.catch(new ForbiddenException({ message: 'Bank account is outside your access scope' }), {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader }) }),
    } as any);

    expect(reply).toHaveBeenCalledWith(expect.anything(), expect.anything(), 403);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'AUTHORIZATION_DENIED', denialReason: 'DATA_SCOPE_DENIED', dataScopeReason: 'WRONG_RESOURCE',
      requestId: 'denial-123', route: '/api/banking/42', httpMethod: 'POST', userAgent: 'test-agent', sessionId: actor().sessionId,
    }) });
    const serialized = JSON.stringify(create.mock.calls[0][0], (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    expect(serialized).not.toMatch(/query-secret|header-secret|body-secret|sensitive|password|salary/i);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('authorization_denial_audit_failed'));
    error.mockRestore();
  });
});
