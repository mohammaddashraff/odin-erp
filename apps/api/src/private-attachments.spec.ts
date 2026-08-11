import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AttachmentScanStatus, DocumentType } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Actor } from './auth';
import { attachmentContentDisposition, PrivateAttachmentsController } from './private-attachments.controller';
import {
  attachmentPermission,
  BASE64_FALLBACK_MAX_BYTES,
  decodeCanonicalBase64,
  PrivateAttachmentsService,
  sanitizeAttachmentFilename,
} from './private-attachments.service';

const ATTACHMENT_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OTHER_ATTACHMENT_ID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const PDF = Buffer.from('%PDF-1.7\nprivate attachment\n%%EOF');

const teamRole = (id = 4n, module = 'sales') => ({
  id,
  active: true,
  permissionAssignments: [{ permission: { module, active: true } }],
});

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  userId: 7n,
  tenantId: 3n,
  email: 'attachment.user@odin.test',
  name: 'Attachment User',
  role: 'Document Manager',
  roleIds: ['4'],
  permissions: ['sales.invoice.view', 'sales.invoice.edit'],
  deniedPermissions: [],
  legacyPermissions: [],
  dataScopes: [{ resource: 'invoice', scope: 'ALL' }, { resource: 'attachment', scope: 'ALL' }],
  fieldPermissions: [{ resource: 'attachment', field: 'metadata', access: 'EDIT' }],
  limits: {},
  branchIds: ['11'],
  warehouseIds: ['21'],
  companyIds: ['31'],
  companyAdminIds: [],
  companyBranchIds: { '31': ['11'] },
  companyScopedPermissions: {},
  companyResourceAssignments: {},
  employeeId: '71',
  departmentId: '81',
  sessionId: 'session-attachment-7',
  ...overrides,
});

const document = (overrides: Record<string, unknown> = {}) => ({
  id: 101n,
  tenantId: 3n,
  type: DocumentType.SALES_INVOICE,
  branchId: 11n,
  warehouseId: 21n,
  createdById: 7n,
  salespersonId: 71n,
  salesEmployee: { departmentId: 81n },
  createdBy: { roleId: 4n, role: teamRole(), additionalRoles: [] },
  ...overrides,
});

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    tenantId: 3n,
    companyId: 31n,
    documentId: 101n,
    uploadedById: 7n,
    storageKey: '08f945d4-351a-41fe-952d-a9909e485db8',
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    sizeBytes: BigInt(PDF.length),
    sha256: createHash('sha256').update(PDF).digest('hex'),
    scanStatus: AttachmentScanStatus.NOT_CONFIGURED,
    content: PDF,
    createdAt: new Date('2026-08-09T09:00:00.000Z'),
    document: document(),
    ...overrides,
  };
}

function fixture(options: { document?: any; attachment?: any; attachments?: any[]; companyId?: bigint } = {}) {
  const owner = options.document || document();
  const stored = options.attachment || attachment({ document: owner });
  const accessAuditCreate = jest.fn().mockResolvedValue({ id: 1n });
  const privateAttachmentCreate = jest.fn().mockImplementation(async ({ data }: any) => ({
    id: ATTACHMENT_ID,
    createdAt: new Date('2026-08-09T09:00:00.000Z'),
    ...data,
  }));
  const tx = {
    document: { findFirst: jest.fn().mockResolvedValue(owner) },
    companyBranch: { findFirst: jest.fn().mockResolvedValue({ companyId: options.companyId || 31n }) },
    privateAttachment: {
      create: privateAttachmentCreate,
      findFirst: jest.fn().mockResolvedValue(stored),
      findMany: jest.fn().mockResolvedValue(options.attachments || [stored]),
    },
    accessAuditLog: { create: accessAuditCreate },
  };
  const db = {
    tenant: jest.fn().mockImplementation(async (_tenantId: bigint, work: (inner: any) => Promise<unknown>) => work(tx)),
  };
  return { tx, db, service: new PrivateAttachmentsService(db as any) };
}

describe('private attachment validation helpers', () => {
  it('maps every document kind to the exact registered document permission key', () => {
    expect(attachmentPermission(DocumentType.SALES_INVOICE, 'view')).toBe('sales.invoice.view');
    expect(attachmentPermission(DocumentType.PURCHASE_ORDER, 'edit')).toBe('purchasing.order.edit');
    expect(attachmentPermission(DocumentType.WAREHOUSE_TRANSFER, 'view')).toBe('inventory.transfer.view');
  });

  it('strips traversal, CRLF, bidi controls, and header punctuation from filenames', () => {
    const safe = sanitizeAttachmentFilename('../..\\\u202e\r\nreport";name.pdf');
    expect(safe).toBe('report__name.pdf');
    expect(safe).not.toMatch(/[\\/\r\n\u202e";]/);
    expect(() => sanitizeAttachmentFilename('../..')).toThrow(BadRequestException);
  });

  it('only decodes canonical bounded base64', () => {
    expect(decodeCanonicalBase64(PDF.toString('base64'))).toEqual(PDF);
    expect(() => decodeCanonicalBase64('not base64')).toThrow(BadRequestException);
    expect(() => decodeCanonicalBase64('Zg')).toThrow(BadRequestException);
    expect(() => decodeCanonicalBase64(Buffer.alloc(BASE64_FALLBACK_MAX_BYTES + 1).toString('base64'))).toThrow(BadRequestException);
  });
});

describe('PrivateAttachmentsService upload and metadata', () => {
  const originalMaximum = process.env.ODIN_ATTACHMENT_MAX_BYTES;

  afterEach(() => {
    if (originalMaximum === undefined) delete process.env.ODIN_ATTACHMENT_MAX_BYTES;
    else process.env.ODIN_ATTACHMENT_MAX_BYTES = originalMaximum;
  });

  it('stores opaque private content and returns only safe metadata with truthful scanner state', async () => {
    const { service, tx } = fixture();
    const result = await service.upload(actor(), {
      documentId: '101',
      filename: '../../invoice.pdf.exe\r\n',
      contentType: 'application/pdf',
      content: PDF,
    }, { route: '/api/private-attachments/upload?ticket=never-audit', httpMethod: 'POST', requestId: 'upload-1' });

    const create = tx.privateAttachment.create.mock.calls[0][0].data;
    expect(create).toMatchObject({
      tenantId: 3n,
      companyId: 31n,
      documentId: 101n,
      uploadedById: 7n,
      filename: 'invoice_pdf_exe.pdf',
      contentType: 'application/pdf',
      sizeBytes: BigInt(PDF.length),
      scanStatus: AttachmentScanStatus.NOT_CONFIGURED,
      content: PDF,
    });
    expect(create.storageKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(create.sha256).toBe(createHash('sha256').update(PDF).digest('hex'));
    expect(result).toMatchObject({
      id: ATTACHMENT_ID,
      scanStatus: AttachmentScanStatus.NOT_CONFIGURED,
      scan: { malwareScannerIntegrated: false, downloadAllowed: true },
    });
    expect((result as any).scan.warning).toMatch(/not configured/i);
    expect(result).not.toHaveProperty('content');
    expect(result).not.toHaveProperty('storageKey');
    expect(result).not.toHaveProperty('ticket');

    const audit = tx.accessAuditLog.create.mock.calls[0][0];
    const serialized = JSON.stringify(audit, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    expect(audit.data).toMatchObject({
      action: 'PRIVATE_ATTACHMENT_UPLOADED',
      route: '/api/private-attachments/upload',
      requestId: 'upload-1',
    });
    expect(serialized).not.toMatch(/never-audit|contentBase64|storageKey|private attachment\n/i);
  });

  it('accepts the deliberately small canonical-base64 fallback', async () => {
    const { service } = fixture();
    await expect(service.upload(actor(), {
      documentId: 101n,
      filename: 'invoice',
      contentType: 'application/pdf',
      contentBase64: PDF.toString('base64'),
    })).resolves.toMatchObject({ filename: 'invoice.pdf', sizeBytes: String(PDF.length) });
  });

  it.each([
    ['missing file', { filename: 'invoice.pdf', contentType: 'application/pdf' }],
    ['missing filename', { content: PDF, contentType: 'application/pdf', filename: '' }],
    ['unsupported SVG', { content: Buffer.from('<svg/>'), contentType: 'image/svg+xml', filename: 'image.svg' }],
    ['MIME spoofing', { content: Buffer.from('89504e470d0a1a0a', 'hex'), contentType: 'application/pdf', filename: 'invoice.pdf' }],
    ['content-type parameters', { content: PDF, contentType: 'application/pdf; charset=binary', filename: 'invoice.pdf' }],
  ])('rejects %s', async (_label, input) => {
    const { service, tx } = fixture();
    await expect(service.upload(actor(), { documentId: '101', ...input } as any)).rejects.toThrow(BadRequestException);
    expect(tx.privateAttachment.create).not.toHaveBeenCalled();
  });

  it('rejects decoded multipart and base64 payloads over their independent limits', async () => {
    process.env.ODIN_ATTACHMENT_MAX_BYTES = '16';
    const { service, tx } = fixture();
    await expect(service.upload(actor(), {
      documentId: '101', filename: 'invoice.pdf', contentType: 'application/pdf', content: PDF,
    })).rejects.toThrow(/between 1 and 16 bytes/i);
    await expect(service.upload(actor(), {
      documentId: '101', filename: 'invoice.pdf', contentType: 'application/pdf',
      contentBase64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(BASE64_FALLBACK_MAX_BYTES)]).toString('base64'),
    })).rejects.toThrow(BadRequestException);
    expect(tx.privateAttachment.create).not.toHaveBeenCalled();
  });

  it('lists through an explicit safe select and never returns content, storage key, or a token', async () => {
    const { service, tx } = fixture();
    const result = await service.list(actor({ fieldPermissions: [{ resource: 'attachment', field: 'metadata', access: 'VIEW' }] }), '101');
    const query = tx.privateAttachment.findMany.mock.calls[0][0];
    expect(query.select).not.toHaveProperty('content');
    expect(query.select).not.toHaveProperty('storageKey');
    expect(result[0]).not.toHaveProperty('content');
    expect(result[0]).not.toHaveProperty('storageKey');
    expect(result[0]).not.toHaveProperty('token');
    expect(result[0]).toMatchObject({ scan: { status: 'NOT_CONFIGURED', malwareScannerIntegrated: false } });
  });
});

describe('PrivateAttachmentsService authorization and ID tampering', () => {
  it('treats explicit attachment:NONE as a mandatory second scope gate', async () => {
    const { service } = fixture();
    const denied = actor({ dataScopes: [{ resource: 'invoice', scope: 'ALL' }, { resource: 'attachment', scope: 'NONE' }] });
    await expect(service.list(denied, '101')).rejects.toThrow(ForbiddenException);
    await expect(service.createDownloadTicket(denied, ATTACHMENT_ID)).rejects.toThrow(ForbiddenException);
    await expect(service.upload(denied, {
      documentId: '101', filename: 'invoice.pdf', contentType: 'application/pdf', content: PDF,
    })).rejects.toThrow(ForbiddenException);
  });

  it('defines attachment OWN as uploader ownership and permits a new self-upload', async () => {
    const foreign = fixture({ attachment: attachment({ uploadedById: 8n }) });
    const ownScope = actor({ dataScopes: [{ resource: 'invoice', scope: 'ALL' }, { resource: 'attachment', scope: 'OWN' }] });
    await foreign.service.list(ownScope, '101');
    expect(foreign.tx.privateAttachment.findMany.mock.calls[0][0].where).toMatchObject({ uploadedById: 7n });
    await expect(foreign.service.createDownloadTicket(ownScope, ATTACHMENT_ID)).rejects.toThrow(ForbiddenException);

    const own = fixture();
    await expect(own.service.createDownloadTicket(ownScope, ATTACHMENT_ID)).resolves.toHaveProperty('ticket');
    await expect(own.service.upload(ownScope, {
      documentId: '101', filename: 'invoice.pdf', contentType: 'application/pdf', content: PDF,
    })).resolves.toHaveProperty('id');
  });

  it('defines attachment TEAM as an explicit uploader allowlist', async () => {
    const scoped = actor({
      dataScopes: [{ resource: 'invoice', scope: 'ALL' }, { resource: 'attachment', scope: 'TEAM', config: { userIds: ['8'] } }],
    });
    const team = fixture({ attachment: attachment({ uploadedById: 8n }) });
    await expect(team.service.createDownloadTicket(scoped, ATTACHMENT_ID)).resolves.toHaveProperty('ticket');
    await team.service.list(scoped, '101');
    expect(team.tx.privateAttachment.findMany.mock.calls[0][0].where).toMatchObject({ uploadedById: { in: [8n] } });
    await expect(team.service.list(actor({
      dataScopes: [{ resource: 'invoice', scope: 'ALL' }, { resource: 'attachment', scope: 'TEAM' }],
    }), '101')).rejects.toThrow(ForbiddenException);
  });

  it('requires the owning document type exact view/edit permission at its company', async () => {
    const { service } = fixture();
    await expect(service.list(actor({ permissions: ['sales.quotation.view'] }), '101')).rejects.toThrow(ForbiddenException);
    await expect(service.upload(actor({ permissions: ['sales.invoice.view'] }), {
      documentId: '101', filename: 'invoice.pdf', contentType: 'application/pdf', content: PDF,
    })).rejects.toThrow(ForbiddenException);
    await expect(service.list(actor({
      permissions: [],
      companyScopedPermissions: { '31': ['sales.invoice.view'] },
      fieldPermissions: [{ resource: 'attachment', field: 'metadata', access: 'VIEW' }],
    }), '101')).resolves.toHaveLength(1);
  });

  it('enforces the attachment metadata field policy in addition to document permission', async () => {
    const { service } = fixture();
    await expect(service.list(actor({ fieldPermissions: [] }), '101')).rejects.toThrow(ForbiddenException);
    await expect(service.upload(actor({ fieldPermissions: [{ resource: 'attachment', field: 'metadata', access: 'VIEW' }] }), {
      documentId: '101', filename: 'invoice.pdf', contentType: 'application/pdf', content: PDF,
    })).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ['NONE', actor({ dataScopes: [] })],
    ['OWN other user', actor({ dataScopes: [{ resource: 'invoice', scope: 'OWN' }, { resource: 'attachment', scope: 'ALL' }] })],
    ['ASSIGNED other salesperson', actor({ dataScopes: [{ resource: 'invoice', scope: 'ASSIGNED' }, { resource: 'attachment', scope: 'ALL' }], employeeId: '999' })],
    ['WAREHOUSE other warehouse', actor({ dataScopes: [{ resource: 'invoice', scope: 'WAREHOUSE' }, { resource: 'attachment', scope: 'ALL' }], warehouseIds: ['999'] })],
    ['DEPARTMENT other department', actor({ dataScopes: [{ resource: 'invoice', scope: 'DEPARTMENT' }, { resource: 'attachment', scope: 'ALL' }], departmentId: '999' })],
  ])('denies the owning record for %s scope', async (_label, scopedActor) => {
    const { service } = fixture({ document: document({ createdById: 8n }) });
    await expect(service.list(scopedActor, '101')).rejects.toThrow(ForbiddenException);
  });

  it('enforces configured TEAM ownership and the shared-role fallback', async () => {
    const configured = fixture({ document: document({ createdById: 8n, createdBy: { roleId: 9n, role: teamRole(9n), additionalRoles: [] } }) });
    await expect(configured.service.list(actor({ dataScopes: [{ resource: 'invoice', scope: 'TEAM', config: { userIds: ['8'] } }, { resource: 'attachment', scope: 'ALL' }] }), '101')).resolves.toHaveLength(1);
    await expect(configured.service.list(actor({ dataScopes: [{ resource: 'invoice', scope: 'TEAM', config: { userIds: ['99'] } }, { resource: 'attachment', scope: 'ALL' }] }), '101')).rejects.toThrow(ForbiddenException);

    const sharedRole = fixture({ document: document({ createdById: 8n, createdBy: { roleId: 4n, role: teamRole(), additionalRoles: [] } }) });
    await expect(sharedRole.service.list(actor({ dataScopes: [{ resource: 'invoice', scope: 'TEAM' }, { resource: 'attachment', scope: 'ALL' }] }), '101')).resolves.toHaveLength(1);

    const unrelatedSharedRole = fixture({ document: document({ createdById: 8n, createdBy: { roleId: 4n, role: teamRole(4n, 'hr'), additionalRoles: [] } }) });
    await expect(unrelatedSharedRole.service.list(actor({ dataScopes: [{ resource: 'invoice', scope: 'TEAM' }, { resource: 'attachment', scope: 'ALL' }] }), '101')).rejects.toThrow(ForbiddenException);
  });

  it('denies cross-company branch membership and attachment/company corruption', async () => {
    const outside = fixture();
    await expect(outside.service.list(actor({
      branchIds: ['12'],
      companyIds: ['32'],
      companyBranchIds: { '32': ['12'] },
    }), '101')).rejects.toThrow(ForbiddenException);

    const corrupt = fixture({ attachment: attachment({ companyId: 32n }), companyId: 31n });
    await expect(corrupt.service.createDownloadTicket(actor(), ATTACHMENT_ID)).rejects.toThrow(ForbiddenException);

    const wrongOwner = fixture({ attachment: attachment({ documentId: 102n, document: document({ id: 101n }) }) });
    await expect(wrongOwner.service.createDownloadTicket(actor(), ATTACHMENT_ID)).rejects.toThrow(ForbiddenException);
  });

  it('does not accept a foreign-tenant object even if a mocked data layer returns it', async () => {
    const foreignDocument = fixture({ document: document({ tenantId: 99n }) });
    await expect(foreignDocument.service.list(actor(), '101')).rejects.toThrow(NotFoundException);
    const foreignAttachment = fixture({ attachment: attachment({ tenantId: 99n }) });
    await expect(foreignAttachment.service.createDownloadTicket(actor(), ATTACHMENT_ID)).rejects.toThrow(NotFoundException);
  });

  it('rejects malformed direct identifiers without querying attachment rows', async () => {
    const { service, tx } = fixture();
    await expect(service.createDownloadTicket(actor(), '../101')).rejects.toThrow(BadRequestException);
    expect(tx.privateAttachment.findFirst).not.toHaveBeenCalled();
  });
});

describe('PrivateAttachmentsService signed delivery', () => {
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.ODIN_ATTACHMENT_TICKET_SECONDS;
  });

  it('binds a short-lived HMAC ticket to attachment, user, tenant, and session', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-09T10:00:00.000Z'));
    process.env.ODIN_ATTACHMENT_TICKET_SECONDS = '30';
    const { service, db } = fixture();
    const owner = actor();
    const issued = await service.createDownloadTicket(owner, ATTACHMENT_ID);
    expect(issued.ticket.split('.')).toHaveLength(2);
    expect(issued.expiresAt).toBe('2026-08-09T10:00:30.000Z');
    await expect(service.download(owner, ATTACHMENT_ID, issued.ticket)).resolves.toMatchObject({
      content: PDF,
      contentType: 'application/pdf',
      scan: { status: 'NOT_CONFIGURED', malwareScannerIntegrated: false },
    });

    const callsBeforeBindingChecks = db.tenant.mock.calls.length;
    await expect(service.download(actor({ userId: 8n }), ATTACHMENT_ID, issued.ticket)).rejects.toThrow(UnauthorizedException);
    await expect(service.download(actor({ tenantId: 4n }), ATTACHMENT_ID, issued.ticket)).rejects.toThrow(UnauthorizedException);
    await expect(service.download(actor({ sessionId: 'different-session' }), ATTACHMENT_ID, issued.ticket)).rejects.toThrow(UnauthorizedException);
    await expect(service.download(owner, OTHER_ATTACHMENT_ID, issued.ticket)).rejects.toThrow(UnauthorizedException);
    expect(db.tenant).toHaveBeenCalledTimes(callsBeforeBindingChecks);
  });

  it('rejects signature tampering and expiration before any database lookup', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-09T10:00:00.000Z'));
    process.env.ODIN_ATTACHMENT_TICKET_SECONDS = '15';
    const { service, db } = fixture();
    const issued = await service.createDownloadTicket(actor(), ATTACHMENT_ID);
    const [payload, signature] = issued.ticket.split('.');
    const first = signature[0] === 'A' ? 'B' : 'A';
    const tampered = `${payload}.${first}${signature.slice(1)}`;
    const callsAfterIssue = db.tenant.mock.calls.length;
    await expect(service.download(actor(), ATTACHMENT_ID, tampered)).rejects.toThrow(UnauthorizedException);
    jest.advanceTimersByTime(15_000);
    await expect(service.download(actor(), ATTACHMENT_ID, issued.ticket)).rejects.toThrow(UnauthorizedException);
    expect(db.tenant).toHaveBeenCalledTimes(callsAfterIssue);
  });

  it.each([
    AttachmentScanStatus.PENDING,
    AttachmentScanStatus.QUARANTINED,
    AttachmentScanStatus.REJECTED,
  ])('blocks %s files before issuing a delivery ticket', async (scanStatus) => {
    const { service } = fixture({ attachment: attachment({ scanStatus }) });
    try {
      await service.createDownloadTicket(actor(), ATTACHMENT_ID);
      throw new Error('Expected scan-state rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(423);
    }
  });

  it.each([
    AttachmentScanStatus.PENDING,
    AttachmentScanStatus.QUARANTINED,
    AttachmentScanStatus.REJECTED,
  ])('also blocks a previously ticketed file if it transitions to %s', async (scanStatus) => {
    const stored: any = attachment();
    const { service } = fixture({ attachment: stored });
    const issued = await service.createDownloadTicket(actor(), ATTACHMENT_ID);
    stored.scanStatus = scanStatus;
    await expect(service.download(actor(), ATTACHMENT_ID, issued.ticket)).rejects.toMatchObject({ status: 423 });
  });

  it('rechecks current authorization after ticket issuance', async () => {
    const { service } = fixture();
    const current = actor();
    const issued = await service.createDownloadTicket(current, ATTACHMENT_ID);
    current.permissions = [];
    await expect(service.download(current, ATTACHMENT_ID, issued.ticket)).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ['content hash', attachment({ content: Buffer.from('%PDF-tampered'), sizeBytes: 13n })],
    ['stored size', attachment({ sizeBytes: BigInt(PDF.length + 1) })],
    ['stored MIME', attachment({ contentType: 'image/png' })],
  ])('fails closed when the %s no longer matches', async (_label, stored) => {
    const { service, tx } = fixture({ attachment: stored });
    const issued = await service.createDownloadTicket(actor(), ATTACHMENT_ID);
    await expect(service.download(actor(), ATTACHMENT_ID, issued.ticket)).rejects.toMatchObject({ status: 422 });
    expect(tx.accessAuditLog.create.mock.calls.filter(([call]: any[]) => call.data.action === 'PRIVATE_ATTACHMENT_DOWNLOADED')).toHaveLength(0);
  });

  it('writes a content-free, token-free download audit after integrity and authorization succeed', async () => {
    const { service, tx } = fixture();
    const issued = await service.createDownloadTicket(actor(), ATTACHMENT_ID);
    await service.download(actor(), ATTACHMENT_ID, issued.ticket, {
      route: `/api/private-attachments/${ATTACHMENT_ID}/download?ticket=${issued.ticket}`,
      httpMethod: 'GET',
      requestId: 'download-1',
      userAgent: 'test-agent',
    });
    const call = tx.accessAuditLog.create.mock.calls.map(([value]: any[]) => value).find((value: any) => value.data.action === 'PRIVATE_ATTACHMENT_DOWNLOADED');
    expect(call.data).toMatchObject({
      actorUserId: 7n,
      resourceId: ATTACHMENT_ID,
      requestedAction: 'download',
      route: `/api/private-attachments/${ATTACHMENT_ID}/download`,
      requestId: 'download-1',
    });
    const serialized = JSON.stringify(call, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    expect(serialized).not.toContain(issued.ticket);
    expect(serialized).not.toMatch(/storageKey|contentBase64|private attachment\n/i);
  });
});

describe('PrivateAttachmentsController', () => {
  function request(overrides: Record<string, unknown> = {}) {
    return {
      actor: actor(),
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-request-id': 'controller-1', 'user-agent': 'controller-test' },
      originalUrl: '/api/private-attachments/upload',
      path: '/api/private-attachments/upload',
      method: 'POST',
      ...overrides,
    } as any;
  }

  it('forwards multipart memory content as the canonical upload path', async () => {
    const upload = jest.fn().mockResolvedValue({ id: ATTACHMENT_ID });
    const controller = new PrivateAttachmentsController({ upload } as any);
    const file = { buffer: PDF, originalname: '../invoice.pdf.exe', mimetype: 'application/pdf', size: PDF.length };
    await controller.upload(request(), { documentId: '101', contentBase64: 'must-not-win' }, file);
    expect(upload).toHaveBeenCalledWith(actor(), {
      documentId: '101',
      filename: '../invoice.pdf.exe',
      contentType: 'application/pdf',
      content: PDF,
      contentBase64: undefined,
    }, expect.objectContaining({ route: '/api/private-attachments/upload', httpMethod: 'POST' }));
  });

  it('forwards an absent multipart file only to the explicitly small base64 fallback', async () => {
    const upload = jest.fn().mockResolvedValue({ id: ATTACHMENT_ID });
    const controller = new PrivateAttachmentsController({ upload } as any);
    await controller.upload(request(), {
      documentId: '101', filename: 'invoice.pdf', contentType: 'application/pdf', contentBase64: PDF.toString('base64'),
    });
    expect(upload).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      content: undefined,
      contentBase64: PDF.toString('base64'),
    }), expect.anything());
  });

  it('emits a safe no-store download with RFC 5987 filename handling and no token reflection', async () => {
    const download = jest.fn().mockResolvedValue({
      content: PDF,
      filename: 'فاتورة\r\n"; 2026.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
    });
    const controller = new PrivateAttachmentsController({ download } as any);
    const setHeader = jest.fn();
    const response = { setHeader, status: jest.fn().mockReturnThis(), send: jest.fn() };
    const secretTicket = 'payload.signature';
    await controller.download(request({
      originalUrl: `/api/private-attachments/${ATTACHMENT_ID}/download?ticket=${secretTicket}`,
      method: 'GET',
    }), ATTACHMENT_ID, secretTicket, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith(PDF);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    const disposition = setHeader.mock.calls.find(([name]) => name === 'Content-Disposition')?.[1];
    expect(disposition).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''/);
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).not.toContain(secretTicket);
    expect(download).toHaveBeenCalledWith(actor(), ATTACHMENT_ID, secretTicket, expect.objectContaining({
      route: `/api/private-attachments/${ATTACHMENT_ID}/download`,
    }));
  });

  it('builds a traversal-safe Content-Disposition value directly', () => {
    const header = attachmentContentDisposition('../../فاتورة\r\n.pdf');
    expect(header).not.toMatch(/[\r\n\\/]/);
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain('%D9%81');
  });
});
