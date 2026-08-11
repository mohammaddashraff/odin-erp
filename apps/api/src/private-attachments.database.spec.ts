import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type DataScopeType, type FieldAccessLevel } from '@prisma/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';
import { normalizeDatabaseUrl } from './database-url';
import { PrismaService } from './prisma.service';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const PASSWORD = 'PrivateAttachmentTest2026!';
const PDF = Buffer.from('%PDF-1.7\nprivate attachment database test\n%%EOF');

type TestIdentity = {
  id: bigint;
  email: string;
  token: string;
};

describe('Private attachments HTTP and PostgreSQL integration', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let database: PrismaService;
  let tenantId: bigint;
  let companyAId: bigint;
  let companyBId: bigint;
  let branchAId: bigint;
  let branchBId: bigint;
  let uploader: TestIdentity;
  let ownViewer: TestIdentity;
  let teamViewer: TestIdentity;
  let noScopeViewer: TestIdentity;
  let companyBUser: TestIdentity;
  let happyDocumentId: bigint;
  let tamperDocumentId: bigint;
  let scopeDocumentId: bigint;
  let companyBDocumentId: bigint;

  const server = () => app.getHttpServer();
  const authenticated = (call: request.Test, identity: TestIdentity) => call.set('Authorization', `Bearer ${identity.token}`);

  async function createRole(
    name: string,
    permissions: string[],
    attachmentScope: DataScopeType,
    fieldAccess: FieldAccessLevel,
    teamUserIds: string[] = [],
  ) {
    const role = await admin.role.create({ data: { tenantId, key: name.toLowerCase().replaceAll(' ', '_'), name, permissions } });
    await admin.roleDataScope.createMany({ data: [
      { tenantId, roleId: role.id, resource: 'invoice', scope: 'ALL' },
      {
        tenantId,
        roleId: role.id,
        resource: 'attachment',
        scope: attachmentScope,
        config: attachmentScope === 'TEAM' ? { userIds: teamUserIds } : undefined,
      },
    ] });
    await admin.roleFieldPermission.create({ data: {
      tenantId,
      roleId: role.id,
      resource: 'attachment',
      field: 'metadata',
      access: fieldAccess,
    } });
    return role;
  }

  async function createUser(roleId: bigint, label: string, branchId: bigint) {
    const user = await admin.user.create({ data: {
      tenantId,
      roleId,
      email: `attachment-${label}-${tenantId}@odin.test`,
      name: `Attachment ${label}`,
      passwordHash: await hash(PASSWORD, 4),
      branchIds: [branchId.toString()],
      warehouseIds: [],
    }, select: { id: true, email: true } });
    return user;
  }

  async function login(identity: { id: bigint; email: string }): Promise<TestIdentity> {
    const response = await request(server())
      .post('/api/auth/login')
      .set('User-Agent', 'private-attachment-database-test')
      .send({ email: identity.email, password: PASSWORD, rememberMe: false })
      .expect(201);
    expect(response.body).toMatchObject({ accessToken: expect.any(String), user: { userId: identity.id.toString() } });
    return { ...identity, token: response.body.accessToken };
  }

  function upload(identity: TestIdentity, documentId: bigint, filename: string) {
    return authenticated(
      request(server())
        .post('/api/private-attachments/upload')
        .set('X-Request-ID', `attachment-upload-${documentId}-${identity.id}`)
        .attach('file', PDF, { filename, contentType: 'application/pdf' })
        .field('documentId', documentId.toString()),
      identity,
    );
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ODIN_REQUIRE_PRIVILEGED_MFA = 'false';
    process.env.ODIN_TOKEN_SECRET ||= 'odin-private-attachment-test-secret-at-least-32-characters';

    admin = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL!)) });
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
      await tx.tenant.deleteMany({ where: { name: { startsWith: 'Private attachment HTTP test ' } } });
    });

    const tenant = await admin.tenant.create({ data: {
      name: `Private attachment HTTP test ${Date.now()}`,
      baseCurrency: 'EGP',
    } });
    tenantId = tenant.id;
    companyAId = (await admin.company.findUniqueOrThrow({
      where: { tenantId_code: { tenantId, code: 'DEFAULT' } },
      select: { id: true },
    })).id;
    branchAId = (await admin.branch.create({ data: {
      tenantId,
      code: 'ATT-A',
      name: 'Attachment company A branch',
    }, select: { id: true } })).id;
    companyBId = (await admin.company.create({ data: {
      tenantId,
      code: 'ATT-B',
      name: 'Attachment company B',
      baseCurrency: 'EGP',
    }, select: { id: true } })).id;
    branchBId = (await admin.branch.create({ data: {
      tenantId,
      code: 'ATT-B',
      name: 'Attachment company B branch',
    }, select: { id: true } })).id;
    await admin.companyBranch.update({ where: { branchId: branchBId }, data: { companyId: companyBId } });

    const uploaderRole = await createRole(
      'Attachment uploader',
      ['sales.invoice.view', 'sales.invoice.edit'],
      'ALL',
      'EDIT',
    );
    const ownRole = await createRole(
      'Attachment own viewer',
      ['sales.invoice.view', 'sales.invoice.edit'],
      'OWN',
      'EDIT',
    );
    const noScopeRole = await createRole(
      'Attachment no scope viewer',
      ['sales.invoice.view'],
      'NONE',
      'VIEW',
    );
    const companyBRole = await createRole(
      'Attachment company B uploader',
      ['sales.invoice.view', 'sales.invoice.edit'],
      'ALL',
      'EDIT',
    );

    const uploaderRecord = await createUser(uploaderRole.id, 'uploader', branchAId);
    const ownRecord = await createUser(ownRole.id, 'own', branchAId);
    const noScopeRecord = await createUser(noScopeRole.id, 'none', branchAId);
    const companyBRecord = await createUser(companyBRole.id, 'company-b', branchBId);
    const teamRole = await createRole(
      'Attachment team viewer',
      ['sales.invoice.view'],
      'TEAM',
      'VIEW',
      [uploaderRecord.id.toString()],
    );
    const teamRecord = await createUser(teamRole.id, 'team', branchAId);

    const activeFrom = new Date(Date.now() - 60_000);
    await admin.companyMembership.updateMany({
      where: { tenantId, companyId: companyAId, userId: { in: [uploaderRecord.id, ownRecord.id, noScopeRecord.id, teamRecord.id] } },
      data: { validFrom: activeFrom },
    });
    await admin.companyMembership.update({
      where: { tenantId_companyId_userId: { tenantId, companyId: companyAId, userId: companyBRecord.id } },
      data: { active: false, validFrom: activeFrom },
    });
    await admin.companyMembership.create({ data: {
      tenantId,
      companyId: companyBId,
      userId: companyBRecord.id,
      role: 'MEMBER',
      validFrom: activeFrom,
    } });

    const documents = await Promise.all([
      ['HTTP-HAPPY', branchAId, uploaderRecord.id],
      ['HTTP-TAMPER', branchAId, uploaderRecord.id],
      ['HTTP-SCOPES', branchAId, uploaderRecord.id],
      ['HTTP-COMPANY-B', branchBId, companyBRecord.id],
    ].map(([number, branchId, createdById]) => admin.document.create({ data: {
      tenantId,
      type: 'SALES_INVOICE',
      number: String(number),
      branchId: BigInt(branchId),
      documentDate: new Date('2026-08-11'),
      createdById: BigInt(createdById),
    }, select: { id: true } })));
    [happyDocumentId, tamperDocumentId, scopeDocumentId, companyBDocumentId] = documents.map(({ id }) => id);

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    database = app.get(PrismaService);

    [uploader, ownViewer, teamViewer, noScopeViewer, companyBUser] = await Promise.all([
      login(uploaderRecord),
      login(ownRecord),
      login(teamRecord),
      login(noScopeRecord),
      login(companyBRecord),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (tenantId) {
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
        await tx.tenant.delete({ where: { id: tenantId } });
      });
    }
    if (app) await app.close();
    if (admin) await admin.$disconnect();
  });

  it('runs multipart upload, safe listing, signed ticket, and binary download through the real application', async () => {
    await request(server())
      .get('/api/private-attachments')
      .query({ documentId: happyDocumentId.toString() })
      .expect(401);

    const uploaded = await upload(uploader, happyDocumentId, 'invoice proof.pdf').expect(201);
    expect(uploaded.body).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      companyId: companyAId.toString(),
      documentId: happyDocumentId.toString(),
      filename: 'invoice proof.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length.toString(),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      scanStatus: 'NOT_CONFIGURED',
      scan: { malwareScannerIntegrated: false, downloadAllowed: true },
    });
    expect(JSON.stringify(uploaded.body)).not.toMatch(/"(?:content|contentBase64|storageKey|uploadedById)"\s*:/i);

    const persisted = await admin.privateAttachment.findUniqueOrThrow({ where: { id: uploaded.body.id } });
    expect(Buffer.from(persisted.content)).toEqual(PDF);
    expect(persisted.storageKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await database.app.privateAttachment.count()).toBe(0);
    await expect(database.tenant(tenantId, (tx) => tx.privateAttachment.count({ where: { id: uploaded.body.id } })))
      .resolves.toBe(1);

    const listed = await authenticated(
      request(server()).get('/api/private-attachments').query({ documentId: happyDocumentId.toString() }),
      uploader,
    ).expect(200);
    expect(listed.body).toEqual([uploaded.body]);
    expect(JSON.stringify(listed.body)).not.toMatch(/"(?:content|contentBase64|storageKey|uploadedById|ticket)"\s*:/i);

    const ticket = await authenticated(
      request(server()).post(`/api/private-attachments/${uploaded.body.id}/ticket`).set('X-Request-ID', 'attachment-ticket-happy'),
      uploader,
    ).expect(201);
    expect(ticket.body).toMatchObject({
      ticket: expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
      expiresAt: expect.any(String),
      attachment: uploaded.body,
    });

    const downloaded = await authenticated(
      request(server())
        .get(`/api/private-attachments/${uploaded.body.id}/download`)
        .query({ ticket: ticket.body.ticket })
        .set('X-Request-ID', 'attachment-download-happy'),
      uploader,
    ).expect(200);
    expect(downloaded.headers['content-type']).toMatch(/^application\/pdf/);
    expect(downloaded.headers['content-length']).toBe(PDF.length.toString());
    expect(downloaded.headers['content-disposition']).toContain('invoice proof.pdf');
    expect(downloaded.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(downloaded.body)).toEqual(PDF);

    const auditedActions = await admin.accessAuditLog.findMany({
      where: { tenantId, resourceId: uploaded.body.id },
      select: { action: true, route: true, requestId: true },
      orderBy: { id: 'asc' },
    });
    expect(auditedActions).toEqual([
      { action: 'PRIVATE_ATTACHMENT_UPLOADED', route: '/api/private-attachments/upload', requestId: `attachment-upload-${happyDocumentId}-${uploader.id}` },
      { action: 'PRIVATE_ATTACHMENT_TICKET_ISSUED', route: `/api/private-attachments/${uploaded.body.id}/ticket`, requestId: 'attachment-ticket-happy' },
      { action: 'PRIVATE_ATTACHMENT_DOWNLOADED', route: `/api/private-attachments/${uploaded.body.id}/download`, requestId: 'attachment-download-happy' },
    ]);
  });

  it('rejects malformed identifiers, ticket tampering, ticket replay by another session, and cross-company identifiers', async () => {
    const companyAUpload = await upload(uploader, tamperDocumentId, 'tamper-proof.pdf').expect(201);
    const companyBUpload = await upload(companyBUser, companyBDocumentId, 'company-b-proof.pdf').expect(201);
    const issued = await authenticated(
      request(server()).post(`/api/private-attachments/${companyAUpload.body.id}/ticket`),
      uploader,
    ).expect(201);

    await authenticated(request(server()).post('/api/private-attachments/not-a-uuid/ticket'), uploader).expect(400);
    await authenticated(request(server()).post(`/api/private-attachments/${randomUUID()}/ticket`), uploader).expect(404);

    const alteredTicket = `${issued.body.ticket.slice(0, -1)}${issued.body.ticket.endsWith('A') ? 'B' : 'A'}`;
    await authenticated(
      request(server()).get(`/api/private-attachments/${companyAUpload.body.id}/download`).query({ ticket: alteredTicket }),
      uploader,
    ).expect(401);
    await authenticated(
      request(server()).get(`/api/private-attachments/${randomUUID()}/download`).query({ ticket: issued.body.ticket }),
      uploader,
    ).expect(401);
    await authenticated(
      request(server()).get(`/api/private-attachments/${companyAUpload.body.id}/download`).query({ ticket: issued.body.ticket }),
      companyBUser,
    ).expect(401);

    await authenticated(
      request(server()).get('/api/private-attachments').query({ documentId: tamperDocumentId.toString() }),
      companyBUser,
    ).expect(403);
    await authenticated(
      request(server()).post(`/api/private-attachments/${companyAUpload.body.id}/ticket`),
      companyBUser,
    ).expect(403);
    await authenticated(
      request(server()).post(`/api/private-attachments/${companyBUpload.body.id}/ticket`),
      uploader,
    ).expect(403);

    await expect(admin.privateAttachment.create({ data: {
      tenantId,
      companyId: companyBId,
      documentId: tamperDocumentId,
      uploadedById: companyBUser.id,
      storageKey: randomUUID(),
      filename: 'invalid-binding.pdf',
      contentType: 'application/pdf',
      sizeBytes: BigInt(PDF.length),
      sha256: '0'.repeat(64),
      content: PDF,
    } })).rejects.toThrow(/Attachment company binding is invalid/i);
  });

  it('enforces persisted OWN, TEAM, and NONE attachment scopes independently of document visibility', async () => {
    const uploaderAttachment = await upload(uploader, scopeDocumentId, 'team-visible.pdf').expect(201);
    const ownAttachment = await upload(ownViewer, scopeDocumentId, 'own-visible.pdf').expect(201);

    const ownList = await authenticated(
      request(server()).get('/api/private-attachments').query({ documentId: scopeDocumentId.toString() }),
      ownViewer,
    ).expect(200);
    expect(ownList.body.map(({ id }: { id: string }) => id)).toEqual([ownAttachment.body.id]);
    await authenticated(
      request(server()).post(`/api/private-attachments/${ownAttachment.body.id}/ticket`),
      ownViewer,
    ).expect(201);
    await authenticated(
      request(server()).post(`/api/private-attachments/${uploaderAttachment.body.id}/ticket`),
      ownViewer,
    ).expect(403);

    const teamList = await authenticated(
      request(server()).get('/api/private-attachments').query({ documentId: scopeDocumentId.toString() }),
      teamViewer,
    ).expect(200);
    expect(teamList.body.map(({ id }: { id: string }) => id)).toEqual([uploaderAttachment.body.id]);
    await authenticated(
      request(server()).post(`/api/private-attachments/${uploaderAttachment.body.id}/ticket`),
      teamViewer,
    ).expect(201);
    await authenticated(
      request(server()).post(`/api/private-attachments/${ownAttachment.body.id}/ticket`),
      teamViewer,
    ).expect(403);

    await authenticated(
      request(server()).get('/api/private-attachments').query({ documentId: scopeDocumentId.toString() }),
      noScopeViewer,
    ).expect(403);
    await authenticated(
      request(server()).post(`/api/private-attachments/${uploaderAttachment.body.id}/ticket`),
      noScopeViewer,
    ).expect(403);
  });
});
