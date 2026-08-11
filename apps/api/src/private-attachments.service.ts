import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AttachmentScanStatus, DocumentType, Prisma } from '@prisma/client';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Actor } from './auth';
import { can } from './auth';
import { companyForBranch, requirePermissionAtCompany } from './access-governance';
import { fieldAccess } from './field-projection';
import { tokenSigningSecret } from './deployment-config';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

export type AttachmentRequestContext = {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  route?: string;
  httpMethod?: string;
};

export type PrivateAttachmentUpload = {
  documentId: string | bigint;
  filename: string;
  contentType: string;
  content?: Buffer;
  contentBase64?: string;
};

type TeamRole = {
  id: bigint;
  active: boolean;
  permissionAssignments: Array<{ permission: { module: string; active: boolean } }>;
};

type OwningDocument = {
  id: bigint;
  tenantId: bigint;
  type: DocumentType;
  branchId: bigint;
  warehouseId: bigint | null;
  createdById: bigint;
  salespersonId: bigint | null;
  salesEmployee: { departmentId: bigint } | null;
  createdBy: {
    roleId: bigint;
    role: TeamRole;
    additionalRoles: Array<{ roleId: bigint; role: TeamRole }>;
  };
};

type AttachmentWithOwner = {
  id: string;
  tenantId: bigint;
  companyId: bigint;
  documentId: bigint;
  uploadedById: bigint;
  filename: string;
  contentType: string;
  sizeBytes: bigint;
  sha256: string;
  scanStatus: AttachmentScanStatus;
  createdAt: Date;
  content?: Uint8Array;
  document: OwningDocument;
};

const DEFAULT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ABSOLUTE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
// Keeps the complete JSON request comfortably below Express' default parser ceiling.
export const BASE64_FALLBACK_MAX_BYTES = 48 * 1024;
export const ATTACHMENT_TICKET_DEFAULT_SECONDS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BLOCKED_SCAN_STATES = new Set<AttachmentScanStatus>([
  AttachmentScanStatus.PENDING,
  AttachmentScanStatus.QUARANTINED,
  AttachmentScanStatus.REJECTED,
]);

const CONTENT_RULES: Readonly<Record<string, (content: Buffer) => boolean>> = {
  'application/pdf': (content) => content.length >= 5 && content.subarray(0, 5).toString('ascii') === '%PDF-',
  'image/png': (content) => content.length >= 8 && content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': (content) => content.length >= 4
    && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
    && content[content.length - 2] === 0xff && content[content.length - 1] === 0xd9,
  'image/webp': (content) => content.length >= 12
    && content.subarray(0, 4).toString('ascii') === 'RIFF'
    && content.subarray(8, 12).toString('ascii') === 'WEBP',
};

const CONTENT_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const SALES_TYPES = new Set<DocumentType>([
  DocumentType.QUOTATION,
  DocumentType.SALES_ORDER,
  DocumentType.DELIVERY_NOTE,
  DocumentType.SALES_INVOICE,
  DocumentType.SALES_RETURN,
  DocumentType.CREDIT_NOTE,
]);

const PURCHASE_TYPES = new Set<DocumentType>([
  DocumentType.PURCHASE_REQUEST,
  DocumentType.PURCHASE_RFQ,
  DocumentType.PURCHASE_ORDER,
  DocumentType.GOODS_RECEIPT,
  DocumentType.PURCHASE_BILL,
  DocumentType.PURCHASE_RETURN,
]);

function configuredMaximumBytes() {
  const configured = Number(process.env.ODIN_ATTACHMENT_MAX_BYTES || DEFAULT_ATTACHMENT_MAX_BYTES);
  if (!Number.isSafeInteger(configured) || configured < 1 || configured > ABSOLUTE_ATTACHMENT_MAX_BYTES) {
    return DEFAULT_ATTACHMENT_MAX_BYTES;
  }
  return configured;
}

export function attachmentMaximumBytes() {
  return configuredMaximumBytes();
}

export function sanitizeAttachmentFilename(input: unknown) {
  const leaf = String(input || '').normalize('NFKC').replaceAll('\\', '/').split('/').at(-1) || '';
  let safe = leaf
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[^\p{L}\p{N} ._()\-]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim();
  safe = [...safe].slice(0, 160).join('');
  if (!safe || /^\.+$/.test(safe)) throw new BadRequestException('A safe attachment filename is required.');
  return safe;
}

function normalizeContentType(input: unknown) {
  const contentType = String(input || '').trim().toLowerCase();
  if (!Object.hasOwn(CONTENT_RULES, contentType)) {
    throw new BadRequestException('Attachment type is not allowed. Use PDF, PNG, JPEG, or WebP.');
  }
  return contentType;
}

function filenameForContentType(input: unknown, contentType: string) {
  const safe = sanitizeAttachmentFilename(input);
  const expected = CONTENT_EXTENSIONS[contentType];
  const lastDot = safe.lastIndexOf('.');
  const finalExtension = lastDot >= 0 ? safe.slice(lastDot).toLowerCase() : '';
  const compatibleJpeg = contentType === 'image/jpeg' && ['.jpg', '.jpeg'].includes(finalExtension);
  let stem = (finalExtension === expected || compatibleJpeg ? safe.slice(0, lastDot) : safe)
    .replaceAll('.', '_')
    .replace(/[_ ]+$/g, '');
  stem = [...stem].slice(0, Math.max(1, 160 - expected.length)).join('');
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `attachment_${stem}`;
  return `${stem || 'attachment'}${expected}`;
}

function decodedBase64Length(value: string) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function decodeCanonicalBase64(input: unknown, maximumBytes = BASE64_FALLBACK_MAX_BYTES) {
  const value = String(input || '');
  const maximumEncodedLength = 4 * Math.ceil(maximumBytes / 3);
  if (!value || value.length > maximumEncodedLength || value.length % 4 !== 0 || !CANONICAL_BASE64.test(value)) {
    throw new BadRequestException('Attachment content must be canonical base64 within the configured limit.');
  }
  if (decodedBase64Length(value) > maximumBytes) {
    throw new BadRequestException('Attachment exceeds the base64 fallback size limit.');
  }
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.length > maximumBytes || decoded.toString('base64') !== value) {
    throw new BadRequestException('Attachment content must be canonical base64 within the configured limit.');
  }
  return decoded;
}

function assertMagicBytes(contentType: string, content: Buffer) {
  if (!CONTENT_RULES[contentType]?.(content)) {
    throw new BadRequestException('Attachment content does not match its declared content type.');
  }
}

function documentResource(type: DocumentType) {
  const resources: Partial<Record<DocumentType, string>> = {
    QUOTATION: 'quotation',
    SALES_ORDER: 'order',
    DELIVERY_NOTE: 'delivery',
    SALES_INVOICE: 'invoice',
    SALES_RETURN: 'return',
    CREDIT_NOTE: 'credit_note',
    PURCHASE_REQUEST: 'purchase_request',
    PURCHASE_RFQ: 'rfq',
    PURCHASE_ORDER: 'purchase_order',
    GOODS_RECEIPT: 'receipt',
    PURCHASE_BILL: 'bill',
    PURCHASE_RETURN: 'purchase_return',
    WAREHOUSE_TRANSFER: 'transfer',
    INVENTORY_ADJUSTMENT: 'adjustment',
    STOCK_COUNT: 'stock_count',
  };
  return resources[type] || 'document';
}

function permissionResource(type: DocumentType) {
  const resources: Partial<Record<DocumentType, string>> = {
    PURCHASE_REQUEST: 'request',
    PURCHASE_RFQ: 'rfq',
    PURCHASE_ORDER: 'order',
    GOODS_RECEIPT: 'receipt',
    PURCHASE_BILL: 'bill',
    PURCHASE_RETURN: 'return',
  };
  return resources[type] || documentResource(type);
}

function documentModule(type: DocumentType) {
  return SALES_TYPES.has(type) ? 'sales' : PURCHASE_TYPES.has(type) ? 'purchasing' : 'inventory';
}

export function attachmentPermission(type: DocumentType, action: 'view' | 'edit') {
  return `${documentModule(type)}.${permissionResource(type)}.${action}`;
}

function parsePositiveId(value: string | bigint, label: string) {
  const text = value?.toString() || '';
  if (!/^[1-9]\d*$/.test(text)) throw new BadRequestException(`${label} is invalid.`);
  return BigInt(text);
}

function assertUuid(value: string) {
  if (!UUID.test(value)) throw new BadRequestException('Attachment identifier is invalid.');
  return value.toLowerCase();
}

function scanDisclosure(status: AttachmentScanStatus) {
  if (status === AttachmentScanStatus.NOT_CONFIGURED) {
    return {
      status,
      malwareScannerIntegrated: false,
      downloadAllowed: true,
      warning: 'Malware scanning is not configured. The file passed type and signature validation only.',
    };
  }
  return {
    status,
    // This repository has no scanner/provider integration; a stored status is
    // never presented as provider evidence.
    malwareScannerIntegrated: false,
    downloadAllowed: !BLOCKED_SCAN_STATES.has(status),
    warning: BLOCKED_SCAN_STATES.has(status) ? 'Download is blocked by the attachment scan state.' : null,
  };
}

function safeMetadata(attachment: Omit<AttachmentWithOwner, 'document' | 'content'>) {
  return {
    id: attachment.id,
    companyId: attachment.companyId.toString(),
    documentId: attachment.documentId.toString(),
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes.toString(),
    sha256: attachment.sha256,
    scanStatus: attachment.scanStatus,
    scan: scanDisclosure(attachment.scanStatus),
    createdAt: attachment.createdAt.toISOString(),
  };
}

function invalidTicket(): never {
  throw new UnauthorizedException('Download ticket is invalid or expired.');
}

function cleanContext(context: AttachmentRequestContext) {
  const route = String(context.route || '').split('?')[0].slice(0, 240) || undefined;
  return {
    ipAddress: String(context.ipAddress || '').slice(0, 80) || undefined,
    userAgent: String(context.userAgent || '').slice(0, 400) || undefined,
    requestId: String(context.requestId || '').slice(0, 120) || undefined,
    route,
    httpMethod: String(context.httpMethod || '').slice(0, 12).toUpperCase() || undefined,
  };
}

@Injectable()
export class PrivateAttachmentsService {
  constructor(private readonly db: PrismaService) {}

  private ticketSeconds() {
    const configured = Number(process.env.ODIN_ATTACHMENT_TICKET_SECONDS || ATTACHMENT_TICKET_DEFAULT_SECONDS);
    return Number.isSafeInteger(configured) ? Math.min(300, Math.max(15, configured)) : ATTACHMENT_TICKET_DEFAULT_SECONDS;
  }

  private signingKey() {
    return createHmac('sha256', tokenSigningSecret()).update('odin-private-attachment-ticket-v1').digest();
  }

  private assertFieldAccess(actor: Actor, action: 'view' | 'edit') {
    const access = fieldAccess(actor, 'attachment', 'metadata');
    if (access === 'HIDDEN' || (action === 'edit' && access !== 'EDIT')) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Private attachment metadata is not available for your role.',
        denial: { reason: 'FIELD_SECURITY_DENIED', fieldSecurityReason: 'ATTACHMENT_METADATA' },
      });
    }
  }

  private assertDocumentScope(actor: Actor, document: OwningDocument) {
    if (can(actor, 'system.super_admin')) return;
    const resource = documentResource(document.type);
    const scope = actor.dataScopes.find((candidate) => candidate.resource === resource)?.scope || 'NONE';
    let permitted = false;
    if (scope === 'ALL' || scope === 'BRANCH') permitted = true;
    else if (scope === 'OWN') permitted = document.createdById === actor.userId;
    else if (scope === 'ASSIGNED') permitted = actor.employeeId
      ? document.salespersonId?.toString() === actor.employeeId
      : document.createdById === actor.userId;
    else if (scope === 'WAREHOUSE') permitted = Boolean(document.warehouseId && actor.warehouseIds.includes(document.warehouseId.toString()));
    else if (scope === 'DEPARTMENT') permitted = Boolean(actor.departmentId && document.salesEmployee?.departmentId.toString() === actor.departmentId);
    else if (scope === 'TEAM') {
      const configured = actor.dataScopes.find((candidate) => candidate.resource === resource)?.config as { userIds?: string[] } | undefined;
      if (configured?.userIds?.length) permitted = configured.userIds.map(String).includes(document.createdById.toString());
      else {
        const module = documentModule(document.type);
        const creatorRoles = [document.createdBy.role, ...document.createdBy.additionalRoles.map(({ role }) => role)];
        permitted = creatorRoles.some((role) => role.active && actor.roleIds.includes(role.id.toString())
          && role.permissionAssignments.some(({ permission }) => permission.active && permission.module === module));
      }
    }
    if (!permitted) throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Attachment is outside your access scope.',
      denial: { reason: 'DATA_SCOPE_DENIED', dataScopeReason: 'ATTACHMENT_SCOPE' },
    });
  }

  private attachmentScopeDenial(): never {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Attachment is outside your access scope.',
      denial: { reason: 'DATA_SCOPE_DENIED', dataScopeReason: 'ATTACHMENT_SCOPE' },
    });
  }

  private attachmentScope(actor: Actor, document: OwningDocument) {
    if (can(actor, 'system.super_admin')) return { scope: 'ALL' as const, userIds: [] as bigint[] };
    const configured = actor.dataScopes.find((candidate) => candidate.resource === 'attachment');
    const userIds = ((configured?.config as { userIds?: unknown[] } | undefined)?.userIds || [])
      .map(String)
      .filter((value) => /^[1-9]\d*$/.test(value))
      .map(BigInt);
    const scope = configured?.scope || 'NONE';
    if (scope === 'NONE') this.attachmentScopeDenial();
    if (scope === 'WAREHOUSE' && (!document.warehouseId || !actor.warehouseIds.includes(document.warehouseId.toString()))) this.attachmentScopeDenial();
    if (scope === 'DEPARTMENT' && (!actor.departmentId || document.salesEmployee?.departmentId.toString() !== actor.departmentId)) this.attachmentScopeDenial();
    if (scope === 'ASSIGNED') {
      const assigned = actor.employeeId
        ? document.salespersonId?.toString() === actor.employeeId
        : document.createdById === actor.userId;
      if (!assigned) this.attachmentScopeDenial();
    }
    if (scope === 'TEAM' && !userIds.length) this.attachmentScopeDenial();
    return { scope, userIds };
  }

  private assertAttachmentScope(actor: Actor, document: OwningDocument, uploadedById: bigint) {
    const { scope, userIds } = this.attachmentScope(actor, document);
    if (scope === 'OWN' && uploadedById !== actor.userId) this.attachmentScopeDenial();
    if (scope === 'TEAM' && !userIds.includes(uploadedById)) this.attachmentScopeDenial();
  }

  private attachmentListScope(actor: Actor, document: OwningDocument): Prisma.PrivateAttachmentWhereInput {
    const { scope, userIds } = this.attachmentScope(actor, document);
    if (scope === 'OWN') return { uploadedById: actor.userId };
    if (scope === 'TEAM') return { uploadedById: { in: userIds } };
    return {};
  }

  private async authorizeDocument(tx: Tx, actor: Actor, document: OwningDocument, action: 'view' | 'edit', expectedCompanyId?: bigint) {
    if (document.tenantId !== actor.tenantId) throw new NotFoundException('Attachment owner was not found.');
    const companyLink = await tx.companyBranch.findFirst({
      where: { tenantId: actor.tenantId, branchId: document.branchId, active: true },
      select: { companyId: true },
    });
    if (!companyLink || (expectedCompanyId !== undefined && companyLink.companyId !== expectedCompanyId)) {
      throw new ForbiddenException('Attachment is outside your access scope.');
    }
    const companyId = companyLink.companyId;
    if (!can(actor, 'system.super_admin')) {
      const actorCompanyId = companyForBranch(actor, document.branchId);
      if (actorCompanyId !== companyId.toString() || !actor.companyIds.includes(companyId.toString()) || !actor.branchIds.includes(document.branchId.toString())) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Attachment is outside your access scope.',
          denial: { reason: 'DATA_SCOPE_DENIED', dataScopeReason: 'ATTACHMENT_SCOPE' },
        });
      }
    }
    requirePermissionAtCompany(actor, attachmentPermission(document.type, action), companyId);
    this.assertFieldAccess(actor, action);
    this.assertDocumentScope(actor, document);
    return companyId;
  }

  private documentSelect() {
    return {
      id: true,
      tenantId: true,
      type: true,
      branchId: true,
      warehouseId: true,
      createdById: true,
      salespersonId: true,
      salesEmployee: { select: { departmentId: true } },
      createdBy: { select: {
        roleId: true,
        role: { select: {
          id: true,
          active: true,
          permissionAssignments: { select: { permission: { select: { module: true, active: true } } } },
        } },
        additionalRoles: { select: {
          roleId: true,
          role: { select: {
            id: true,
            active: true,
            permissionAssignments: { select: { permission: { select: { module: true, active: true } } } },
          } },
        } },
      } },
    } as const;
  }

  private async document(tx: Tx, actor: Actor, documentId: bigint) {
    const document = await tx.document.findFirst({
      where: { id: documentId, tenantId: actor.tenantId },
      select: this.documentSelect(),
    });
    if (!document) throw new NotFoundException('Attachment owner was not found.');
    return document;
  }

  private async attachment(tx: Tx, actor: Actor, attachmentId: string, includeContent = false): Promise<AttachmentWithOwner> {
    const attachment = await tx.privateAttachment.findFirst({
      where: { id: attachmentId, tenantId: actor.tenantId },
      select: {
        id: true,
        tenantId: true,
        companyId: true,
        documentId: true,
        uploadedById: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        sha256: true,
        scanStatus: true,
        createdAt: true,
        ...(includeContent ? { content: true } : {}),
        document: { select: this.documentSelect() },
      },
    });
    if (!attachment || attachment.tenantId !== actor.tenantId) throw new NotFoundException('Attachment was not found.');
    if (attachment.documentId !== attachment.document.id) throw new ForbiddenException('Attachment is outside your access scope.');
    return attachment as AttachmentWithOwner;
  }

  private assertDownloadable(status: AttachmentScanStatus) {
    if (!BLOCKED_SCAN_STATES.has(status)) return;
    throw new HttpException({
      statusCode: HttpStatus.LOCKED,
      error: 'Locked',
      message: 'Attachment download is blocked by its scan state.',
      scanStatus: status,
    }, HttpStatus.LOCKED);
  }

  private audit(tx: Tx, actor: Actor, attachment: { id: string; companyId: bigint; documentId: bigint; filename: string; contentType: string; sizeBytes: bigint; sha256: string; scanStatus: AttachmentScanStatus }, branchId: bigint, action: string, context: AttachmentRequestContext) {
    const safe = cleanContext(context);
    return tx.accessAuditLog.create({ data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      companyId: attachment.companyId.toString(),
      branchId,
      resourceType: 'PRIVATE_ATTACHMENT',
      resourceId: attachment.id,
      requestedAction: action === 'PRIVATE_ATTACHMENT_DOWNLOADED' ? 'download' : action === 'PRIVATE_ATTACHMENT_TICKET_ISSUED' ? 'ticket' : 'upload',
      route: safe.route,
      httpMethod: safe.httpMethod,
      ipAddress: safe.ipAddress,
      userAgent: safe.userAgent,
      sessionId: actor.sessionId,
      requestId: safe.requestId,
      newValue: {
        documentId: attachment.documentId.toString(),
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes.toString(),
        sha256: attachment.sha256,
        scanStatus: attachment.scanStatus,
      },
    } });
  }

  async upload(actor: Actor, input: PrivateAttachmentUpload, context: AttachmentRequestContext = {}) {
    const documentId = parsePositiveId(input.documentId, 'Document identifier');
    const contentType = normalizeContentType(input.contentType);
    const filename = filenameForContentType(input.filename, contentType);
    const maximum = attachmentMaximumBytes();
    const content = input.content
      ? Buffer.from(input.content)
      : decodeCanonicalBase64(input.contentBase64, Math.min(maximum, BASE64_FALLBACK_MAX_BYTES));
    if (!content.length || content.length > maximum) throw new BadRequestException(`Attachment must be between 1 and ${maximum} bytes.`);
    assertMagicBytes(contentType, content);
    const sha256 = createHash('sha256').update(content).digest('hex');

    return this.db.tenant(actor.tenantId, async (tx) => {
      const document = await this.document(tx, actor, documentId);
      const companyId = await this.authorizeDocument(tx, actor, document, 'edit');
      this.assertAttachmentScope(actor, document, actor.userId);
      const created = await tx.privateAttachment.create({ data: {
        tenantId: actor.tenantId,
        companyId,
        documentId,
        uploadedById: actor.userId,
        storageKey: randomUUID(),
        filename,
        contentType,
        sizeBytes: BigInt(content.length),
        sha256,
        scanStatus: AttachmentScanStatus.NOT_CONFIGURED,
        content,
      } });
      await this.audit(tx, actor, created, document.branchId, 'PRIVATE_ATTACHMENT_UPLOADED', context);
      return safeMetadata(created);
    });
  }

  async list(actor: Actor, rawDocumentId: string | bigint) {
    const documentId = parsePositiveId(rawDocumentId, 'Document identifier');
    return this.db.tenant(actor.tenantId, async (tx) => {
      const document = await this.document(tx, actor, documentId);
      const companyId = await this.authorizeDocument(tx, actor, document, 'view');
      const attachmentScope = this.attachmentListScope(actor, document);
      const attachments = await tx.privateAttachment.findMany({
        where: { tenantId: actor.tenantId, companyId, documentId, ...attachmentScope },
        select: {
          id: true,
          tenantId: true,
          companyId: true,
          documentId: true,
          uploadedById: true,
          filename: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          scanStatus: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return attachments.map(safeMetadata);
    });
  }

  private signTicket(actor: Actor, attachmentId: string) {
    const expiresAt = Math.floor(Date.now() / 1000) + this.ticketSeconds();
    const payload = Buffer.from(JSON.stringify({
      v: 1,
      a: attachmentId,
      u: actor.userId.toString(),
      t: actor.tenantId.toString(),
      s: actor.sessionId || null,
      e: expiresAt,
      n: randomBytes(12).toString('base64url'),
    })).toString('base64url');
    const signature = createHmac('sha256', this.signingKey()).update(payload).digest('base64url');
    return { ticket: `${payload}.${signature}`, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  private verifyTicket(actor: Actor, attachmentId: string, ticket: string) {
    if (!ticket || ticket.length > 2048) invalidTicket();
    const [payloadPart, signaturePart, extra] = ticket.split('.');
    if (!payloadPart || !signaturePart || extra || !/^[A-Za-z0-9_-]+$/.test(payloadPart) || !/^[A-Za-z0-9_-]+$/.test(signaturePart)) invalidTicket();
    const expected = createHmac('sha256', this.signingKey()).update(payloadPart).digest();
    const supplied = Buffer.from(signaturePart, 'base64url');
    const comparable = supplied.length === expected.length ? supplied : Buffer.alloc(expected.length);
    const validSignature = timingSafeEqual(expected, comparable) && supplied.length === expected.length;
    if (!validSignature) invalidTicket();
    let payload: any;
    try {
      const decoded = Buffer.from(payloadPart, 'base64url');
      if (decoded.toString('base64url') !== payloadPart) invalidTicket();
      payload = JSON.parse(decoded.toString('utf8'));
    } catch {
      invalidTicket();
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload?.v !== 1 || payload.a !== attachmentId || payload.u !== actor.userId.toString()
      || payload.t !== actor.tenantId.toString() || payload.s !== (actor.sessionId || null)
      || !Number.isSafeInteger(payload.e) || payload.e <= now || payload.e > now + 300
      || typeof payload.n !== 'string' || payload.n.length < 12) invalidTicket();
  }

  async createDownloadTicket(actor: Actor, rawAttachmentId: string, context: AttachmentRequestContext = {}) {
    const attachmentId = assertUuid(rawAttachmentId);
    return this.db.tenant(actor.tenantId, async (tx) => {
      const attachment = await this.attachment(tx, actor, attachmentId);
      await this.authorizeDocument(tx, actor, attachment.document, 'view', attachment.companyId);
      this.assertAttachmentScope(actor, attachment.document, attachment.uploadedById);
      this.assertDownloadable(attachment.scanStatus);
      const ticket = this.signTicket(actor, attachment.id);
      await this.audit(tx, actor, attachment, attachment.document.branchId, 'PRIVATE_ATTACHMENT_TICKET_ISSUED', context);
      return { ...ticket, attachment: safeMetadata(attachment) };
    });
  }

  async download(actor: Actor, rawAttachmentId: string, ticket: string, context: AttachmentRequestContext = {}) {
    const attachmentId = assertUuid(rawAttachmentId);
    this.verifyTicket(actor, attachmentId, String(ticket || ''));
    return this.db.tenant(actor.tenantId, async (tx) => {
      const attachment = await this.attachment(tx, actor, attachmentId, true);
      await this.authorizeDocument(tx, actor, attachment.document, 'view', attachment.companyId);
      this.assertAttachmentScope(actor, attachment.document, attachment.uploadedById);
      this.assertDownloadable(attachment.scanStatus);
      if (!attachment.content) throw new NotFoundException('Attachment content was not found.');
      const content = Buffer.from(attachment.content);
      if (content.length !== Number(attachment.sizeBytes)
        || createHash('sha256').update(content).digest('hex') !== attachment.sha256
        || !CONTENT_RULES[attachment.contentType]?.(content)) {
        throw new HttpException('Attachment integrity verification failed.', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      await this.audit(tx, actor, attachment, attachment.document.branchId, 'PRIVATE_ATTACHMENT_DOWNLOADED', context);
      return {
        content,
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: content.length,
        sha256: attachment.sha256,
        scan: scanDisclosure(attachment.scanStatus),
      };
    });
  }
}
