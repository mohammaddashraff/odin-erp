// Synthetic DEV/TEST browser acceptance setup. Requires the compiled API in .av8/api.
// No hosted access, no seeding/reset, no outbound provider calls.
require('reflect-metadata');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../.av8/api/src/app.module');
const { PrismaService } = require('../../.av8/api/src/prisma.service');
const { AuthService } = require('../../.av8/api/src/auth');
const { Av8Service } = require('../../.av8/api/src/av8.service');
const { Av8FinanceService } = require('../../.av8/api/src/av8-finance.service');
const { Av8OperationsService } = require('../../.av8/api/src/av8-operations.service');
const key = () => randomUUID();
async function pdf(text) {
  const document = new PDFDocument({ size: 'A4' }), chunks = [];
  const done = new Promise((resolve, reject) => { document.on('data', chunk => chunks.push(chunk)); document.on('end', () => resolve(Buffer.concat(chunks))); document.on('error', reject); });
  document.fontSize(20).text('SYNTHETIC AV8 acceptance evidence').moveDown().fontSize(12).text(text).moveDown().text('This document contains no real student or academy data.'); document.end(); return done;
}
async function main() {
  const environment = process.env.AV8_ENV;
  if (!['dev','test'].includes(environment) || process.env.AV8_HOSTING || process.env.AV8_OUTBOUND !== 'disabled' || process.env.AV8_JOBS !== 'disabled') throw new Error('Only the verified local AV8 dev/test wrapper is permitted');
  for (const [name, role] of [['DATABASE_URL','av8_runtime'],['DATABASE_ADMIN_URL','av8_owner'],['DATABASE_URL_UNPOOLED','av8_owner'],['POSTGRES_URL_NON_POOLING','av8_owner']]) {
    if (!process.env[name] && ['DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'].includes(name)) continue;
    const url = new URL(process.env[name] || 'postgresql://invalid/invalid');
    if (url.hostname !== '127.0.0.1' || url.pathname !== `/av8_${environment}` || url.port !== (environment === 'dev' ? '5548' : '5549') || url.username !== role) throw new Error('Local operations browser fixture database identity mismatch');
  }
  Object.assign(process.env, { AV8_ACADEMIC_EMAIL_ENABLED: 'false', AV8_ACADEMIC_WORKER_ENABLED: 'false', AV8_OPERATIONS_WORKER_ENABLED: 'false', AV8_SCHEDULER_ENABLED: 'false' });
  globalThis.fetch = async () => { throw new Error('Network dispatch disabled in synthetic UI setup'); };
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const db = app.get(PrismaService), auth = app.get(AuthService), av8 = app.get(Av8Service), finance = app.get(Av8FinanceService), ops = app.get(Av8OperationsService);
    for (const client of [db.admin,db.app]) {
      const marker = await client.$queryRaw`SELECT current_database() AS database, resource FROM av8_guard.av8_environment_identity`;
      if (marker.length !== 1 || marker[0].database !== `av8_${environment}` || marker[0].resource !== `av8-erp-${environment}`) throw new Error('Local operations browser fixture database marker mismatch');
    }
    const actor = async email => auth.actorFor(await db.admin.user.findFirstOrThrow({ where: { email }, include: auth.userInclude }));
    const admin = await actor('admin@av8.local'), affairs = await actor('affairs@av8.local'), refs = await av8.refs(admin);
    const source = await pdf('Original academy report: theory 85/100; 40 flight hours; phase one; instrument milestone.'), corrected = await pdf('Corrected academy report: theory 90/100; 45 flight hours; phase one complete; instrument milestone verified.');
    const originalPath = path.resolve('.av8/operations-original.pdf'), correctedPath = path.resolve('.av8/operations-corrected.pdf');
    await fs.writeFile(originalPath, source, { mode: 0o600 }); await fs.writeFile(correctedPath, corrected, { mode: 0o600 });
    const evidence = { buffer: source, originalname: 'SYNTHETIC-original-evidence.pdf', mimetype: 'application/pdf' };
    const detail = application => av8.detail(admin, BigInt(application.id));
    async function record(application, value) { const current = await detail(application); return av8.record(admin, BigInt(application.id), { ...value, version: current.version, reason: value.reason || 'Synthetic UI acceptance documented operation' }, key()); }
    async function file(application) { const row = await record(application, { kind: 'task', key: key(), title: 'Synthetic UI supporting evidence', status: 'OPEN' }); return av8.upload(admin, BigInt(application.id), BigInt(row.recordId), evidence); }
    async function application(label) {
      const name = `SYNTHETIC UI ${label} ${key().slice(0,8)}`;
      const lead = await av8.createLead(admin, { name, phone: '+201000000001', email: 'student@av8.invalid', source: 'Controlled UI acceptance', branchId: String(refs.branches[0].id), ownerId: String(admin.userId), duplicateReviewed: true }, key());
      await av8.leadAction(admin, BigInt(lead.id), { version: 1, action: 'appointment', status: 'SCHEDULED', plannedAt: '2026-01-01T10:00:00+02:00', reason: 'Synthetic UI booking' }, key());
      const before = await av8.leadDetail(admin, BigInt(lead.id));
      await av8.leadAction(admin, BigInt(lead.id), { version: before.version, action: 'appointment', recordId: String(before.records[0].id), status: 'ATTENDED', actualAt: '2026-01-01T10:00:00+02:00', reason: 'Synthetic UI attendance' }, key());
      const result = await av8.convert(admin, BigInt(lead.id), { academyId: String(refs.academies[0].id), reason: 'Synthetic UI application' }, key());
      return { ...result, id: String(result.id), name };
    }
    const admission = await application('Admission');
    let current = await detail(admission);
    await finance.receipt(admin, BigInt(admission.id), { amount: '2000', currency: 'USD', bankAccountId: String(refs.banks.find(bank => bank.currency === 'USD').id), paymentDate: '2026-10-31', method: 'BANK', chargeId: String(current.finance.schedule[0].id), usdToBaseRate: '50', reference: key(), notes: 'Synthetic UI application fee' }, key());
    current = await detail(admission); await av8.medical(admin, BigInt(admission.id), { version: current.version, outcome: 'PASSED', date: '2026-10-31', provider: 'Synthetic medical provider', reason: 'Synthetic UI verified medical pass' }, key());
    const education = await file(admission); current = await detail(admission);
    for (const document of current.records.filter(row => row.kind === 'document')) {
      if (document.key === 'family') { await record(admission, { kind: 'document', key: document.key, status: 'NOT_APPLICABLE', reason: 'Not required for this synthetic embassy application' }); continue; }
      await av8.upload(admin, BigInt(admission.id), BigInt(document.id), evidence);
      for (const status of ['RECEIVED','UNDER_REVIEW','ACCEPTED']) await record(admission, { kind: 'document', key: document.key, status, statementOwner: 'Synthetic student', relationship: 'Self' });
    }
    let admissionBlocked = false;
    try { await ops.execute(affairs, BigInt(admission.id), { kind: 'admission', status: 'APPROVED', reason: 'Synthetic prerequisite negative check' }, key()); } catch (error) { if (!error.message.includes('eligibility')) throw error; admissionBlocked = true; }
    if (!admissionBlocked) throw new Error('Admission fixture unexpectedly eligible before UI verification');
    const academic = await application('Academic Training');
    await record(academic, { kind: 'travel', status: 'DEPARTED', actualDeparture: '2026-01-31T12:00:00+02:00', exception: true, reason: 'Synthetic administrator travel exception isolates academic UI acceptance and preserves the original debt' });
    await record(academic, { kind: 'guardian', name: 'Synthetic guardian', relationship: 'Parent', phone: '+201000000002', email: 'guardian@av8.invalid', sharingScope: ['PROGRESS'], consentDate: '2026-01-01' });
    current = await detail(academic); const report = current.records.find(row => row.kind === 'progress');
    if (!report) throw new Error('Actual departure did not create an expected academic report');
    const original = await av8.upload(admin, BigInt(academic.id), BigInt(report.id), evidence), training = await file(academic);
    const affairsView = await av8.detail(affairs, BigInt(academic.id));
    if (!affairsView.attachments.some(row => String(row.id) === String(original.id))) throw new Error('Ordinary affairs cannot see original report evidence');
    const overview = await ops.overview(affairs, BigInt(academic.id));
    if (overview.configuration.emailConfigured) throw new Error('Synthetic UI fixture must keep academic email disabled');
    const output = { synthetic: true, admission: { id: admission.id, reference: admission.reference, name: admission.name, eligibilityEvidenceId: String(education.id), expectedInitialDecisionError: 'eligibility' }, academic: { id: academic.id, reference: academic.reference, name: academic.name, reportId: String(report.id), period: report.key, sourceEvidenceId: String(original.id), trainingEvidenceId: String(training.id), originalReportFilePath: originalPath, correctionReportFilePath: correctedPath, guardianConfigured: true, expectedDelivery: 'BLOCKED_CONFIGURATION', expectedOutstandingMinor: '200000', trainingState: 'NONE' } };
    await fs.writeFile(path.resolve('.av8/operations-ui-fixture.json'), JSON.stringify(output, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(output));
  } finally { await app.close(); }
}
main().catch(error => { console.error(error.name + ': ' + error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted database URL]')); process.exitCode = 1; });
