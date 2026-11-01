import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { compare } from 'bcryptjs';
import { createFirstOwner, firstOwnerConfiguration } from './av8-first-owner';
import { initialPolicies } from './av8-domain';
import type { PrismaService } from './prisma.service';

jest.setTimeout(120000);

/** Fresh schema-only copy, never a reset or a mutation of the source installation. */
describe('First owner on an empty PostgreSQL installation with forced RLS', () => {
  const suffix = randomBytes(7).toString('hex');
  const database = `av8_bootstrap_${suffix}`, ownerRole = `av8_boot_owner_${suffix}`, runtimeRole = `av8_boot_runtime_${suffix}`;
  const ownerPassword = randomBytes(32).toString('hex'), runtimePassword = randomBytes(32).toString('hex'), password = randomBytes(36).toString('base64url');
  const config = firstOwnerConfiguration({ AV8_HOSTING: 'hetzner', AV8_ENV: 'staging', AV8_INITIAL_SETUP: 'EMPTY_DATABASE_ONLY', AV8_INITIAL_ADMIN_EMAIL: 'synthetic-owner@example.invalid', AV8_INITIAL_ADMIN_NAME: 'Synthetic named owner', AV8_INITIAL_COMPANY_NAME: 'Synthetic empty installation', AV8_INITIAL_BRANCH_NAME: 'Synthetic initial branch', AV8_INITIAL_BRANCH_CODE: 'SYN-BOOT' });
  let control: Client, schema: Client, admin: PrismaClient, runtime: PrismaClient, databaseCreated = false, ownerCreated = false, runtimeCreated = false;
  let initialized: Awaited<ReturnType<typeof createFirstOwner>>;
  const db = () => ({ admin } as PrismaService);

  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_ADMIN_URL || 'postgresql://invalid/invalid');
    if (process.env.AV8_ENV !== 'test' || source.hostname !== '127.0.0.1' || source.port !== '5549' || source.pathname !== '/av8_test' || source.username !== 'av8_owner') throw new Error('Bootstrap regression requires the isolated local AV8 test cluster');
    control = new Client({ connectionString: source.href }); await control.connect();
    const marker = (await control.query('SELECT resource FROM av8_guard.av8_environment_identity')).rows;
    if (marker.length !== 1 || marker[0].resource !== 'av8-erp-test') throw new Error('Bootstrap source identity mismatch');
    const attributes = (await control.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
    if (!attributes.rolsuper) throw new Error('Disposable role regression requires the isolated local cluster administrator');
    // Generated names/passwords contain only a fixed prefix and hex; no external SQL identifiers are interpolated.
    await control.query(`CREATE ROLE ${ownerRole} LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`); ownerCreated = true;
    await control.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT`); runtimeCreated = true;
    await control.query(`GRANT odin_app TO ${runtimeRole}`);
    await control.query(`CREATE DATABASE ${database} OWNER ${ownerRole}`); databaseCreated = true;
    await control.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await control.query(`GRANT CONNECT ON DATABASE ${database} TO ${runtimeRole}`);
    const { stdout } = await promisify(execFile)('pg_dump', ['--schema-only', '--schema=public', '--no-owner', '--no-acl'], { env: { ...process.env, PGHOST: source.hostname, PGPORT: source.port, PGDATABASE: source.pathname.slice(1), PGUSER: source.username, PGPASSWORD: decodeURIComponent(source.password) }, maxBuffer: 20 * 1024 * 1024 });
    // pg_dump 17 emits psql \restrict commands; the schema SQL otherwise runs directly over the private connection.
    const sql = stdout.replace(/^\\(?:un)?restrict\s+.*$/gm, '');
    const ownerUrl = new URL(source); ownerUrl.pathname = `/${database}`; ownerUrl.username = ownerRole; ownerUrl.password = ownerPassword;
    schema = new Client({ connectionString: ownerUrl.href }); await schema.connect();
    // Only the newly created, empty database: pg_dump recreates this default schema.
    await schema.query('DROP SCHEMA public'); await schema.query(sql); await schema.query('SET search_path TO public');
    await schema.query('GRANT USAGE ON SCHEMA public TO odin_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO odin_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO odin_app');
    const runtimeUrl = new URL(ownerUrl); runtimeUrl.username = runtimeRole; runtimeUrl.password = runtimePassword;
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl.href, max: 2 }) });
    runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl.href, max: 2 }) });
  });

  afterAll(async () => {
    await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect(), schema?.end()]);
    if (control) {
      try {
        if (databaseCreated) await control.query(`DROP DATABASE ${database} WITH (FORCE)`);
        if (runtimeCreated) await control.query(`DROP ROLE ${runtimeRole}`);
        if (ownerCreated) await control.query(`DROP ROLE ${ownerRole}`);
      } finally { await control.end(); }
    }
  });

  it('reproduces owner NOBYPASSRLS failure, then initializes with only the privileged admin pool', async () => {
    const forced = (await schema.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='tenants'::regclass")).rows[0];
    expect(forced).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    await expect(createFirstOwner(db(), config, password)).rejects.toThrow(/row.level security/i);
    expect(await admin.tenant.count()).toBe(0);
    await control.query(`ALTER ROLE ${ownerRole} BYPASSRLS`);
    const attributes = (await schema.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    expect(attributes).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: true });
    initialized = await createFirstOwner(db(), config, password);
    const owner = await admin.user.findUniqueOrThrow({ where: { id: BigInt(initialized.userId) } });
    expect(owner).toMatchObject({ email: config.email, name: config.name, mfaRequired: true, passwordChangeRequired: true });
    expect(await compare(password, owner.passwordHash)).toBe(true);
    expect(owner.temporaryPasswordExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(owner.temporaryPasswordExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
    expect(await admin.company.count()).toBe(1); expect(await admin.branch.count()).toBe(1);
    expect(await admin.companyMembership.findFirstOrThrow()).toMatchObject({ companyId: BigInt(initialized.companyId), userId: owner.id, role: 'ADMINISTRATOR', active: true });
    expect(await admin.companyBranch.count()).toBe(1);
    expect(await admin.av8Policy.count()).toBe(initialPolicies.length);
    expect(await admin.av8Policy.count({ where: { status: { not: 'DRAFT' } } })).toBe(0);
    for (const model of [admin.customer, admin.supplier, admin.bankAccount, admin.bankTransaction, admin.journalEntry, admin.av8Application, admin.av8Fund, admin.payment, admin.stockMovement]) expect(await (model.count as () => Promise<number>)()).toBe(0);
    expect(await admin.auditEvent.count({ where: { action: 'AV8_EMPTY_INSTALLATION_INITIALIZED' } })).toBe(1);
  });

  it('keeps runtime RLS restricted and requires explicit tenant scope to read the initialized owner', async () => {
    const attributes: any[] = await runtime.$queryRaw`SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(attributes[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false });
    expect(await runtime.tenant.count()).toBe(0); expect(await runtime.user.count()).toBe(0);
    await runtime.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${initialized.tenantId}, true)`;
      expect(await tx.tenant.count()).toBe(1); expect(await tx.user.count()).toBe(1);
      expect((await tx.user.findFirstOrThrow()).email).toBe(config.email);
    });
    await expect(runtime.tenant.create({ data: { name: 'Unauthorized synthetic tenant' } })).rejects.toThrow(/row.level security/i);
  });

  it('refuses a second bootstrap without changing the owner, policies or audit history', async () => {
    const before = await admin.user.findFirstOrThrow();
    await expect(createFirstOwner(db(), { ...config, email: 'replacement@example.invalid' }, randomBytes(36).toString('base64url'))).rejects.toThrow('existing installation');
    expect(await admin.user.count()).toBe(1); expect(await admin.tenant.count()).toBe(1);
    expect((await admin.user.findFirstOrThrow()).passwordHash).toBe(before.passwordHash);
    expect(await admin.av8Policy.count()).toBe(initialPolicies.length);
    expect(await admin.auditEvent.count()).toBe(1);
  });
});
