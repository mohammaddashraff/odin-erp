import { PrismaPg } from '@prisma/adapter-pg';
import { DataScopeType, FieldAccessLevel, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { normalizeDatabaseUrl } from '../src/database-url';
import { DATA_SCOPE_RESOURCES, FIELD_REGISTRY } from '../src/permissions';
import { roleKeys, roleLimits, rolePermissions, roleScopes } from './seed';

const profiles = [
  { email: 'admin@odin.demo', name: 'Odin Administrator', roleName: 'Company Administrator' },
  { email: 'cfo@odin.demo', name: 'Mariam Nassar', roleName: 'Chief Financial Officer' },
  { email: 'finance@odin.demo', name: 'Omar Selim', roleName: 'Finance Manager' },
  { email: 'accountant@odin.demo', name: 'Nour Adel', roleName: 'Accountant' },
  { email: 'auditor@odin.demo', name: 'Karim Fawzy', roleName: 'Auditor' },
  { email: 'sales@odin.demo', name: 'Salma Hafez', roleName: 'Sales Manager' },
  { email: 'sales.employee@odin.demo', name: 'Ahmed Hassan', roleName: 'Sales Employee' },
  { email: 'purchasing@odin.demo', name: 'Hassan Youssef', roleName: 'Purchasing Manager' },
  { email: 'warehouse@odin.demo', name: 'Tarek Mansour', roleName: 'Warehouse Manager' },
  { email: 'cashier@odin.demo', name: 'Dina Samir', roleName: 'POS Cashier' },
  { email: 'hr@odin.demo', name: 'Mona El-Sayed', roleName: 'HR Manager' },
  { email: 'branch@odin.demo', name: 'Youssef Hamdy', roleName: 'Branch Manager' },
] as const;

const databaseUrl = process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.DATABASE_ADMIN_URL
  || process.env.DATABASE_URL;

if (!databaseUrl) throw new Error('A PostgreSQL connection URL is required to enable demo profiles');
if (String(process.env.ODIN_ALLOW_SHARED_DEMO_LOGINS).toLowerCase() !== 'true') {
  throw new Error('ODIN_ALLOW_SHARED_DEMO_LOGINS=true is required to enable shared demo profiles');
}
if (String(process.env.ODIN_ENABLE_DEMO_PROFILES).toLowerCase() !== 'true') {
  throw new Error('ODIN_ENABLE_DEMO_PROFILES=true is required for this one-time operation');
}

function dataScopeFor(roleName: string, permissions: string[], resource: string) {
  let scope = roleScopes[roleName] || DataScopeType.NONE;
  if (['company', 'team', 'pos_terminal', 'cost_center', 'project'].includes(resource)) scope = DataScopeType.NONE;
  if (resource === 'attachment') {
    const hasDocumentAccess = permissions.some((key) => /^(sales|purchasing|inventory)\..+\.(view|create|edit)$/.test(key));
    scope = hasDocumentAccess ? (roleScopes[roleName] || DataScopeType.NONE) : DataScopeType.NONE;
  }
  if (roleName === 'POS Cashier' && resource === 'pos_terminal') scope = DataScopeType.BRANCH;
  if (resource === 'supplier') scope = permissions.includes('purchasing.supplier.view') ? DataScopeType.ALL : DataScopeType.NONE;
  if (resource === 'bank_account') scope = permissions.some((key) => key.startsWith('banking.') || key.startsWith('payments.')) ? DataScopeType.ALL : DataScopeType.NONE;
  if (resource === 'account') scope = permissions.some((key) => key.startsWith('accounting.account.') || key === 'banking.transaction.create') ? DataScopeType.ALL : DataScopeType.NONE;
  return scope;
}

function fieldAccessFor(roleName: string, permissions: string[], resource: string, field: string) {
  const financialEditor = ['Super Admin', 'Finance Manager', 'Accountant'].includes(roleName);
  const financialViewer = financialEditor || ['Sales Manager', 'Branch Manager', 'Auditor', 'Purchasing Manager'].includes(roleName);
  const salaryEditor = ['Super Admin', 'HR Manager'].includes(roleName);
  if (resource === 'employee' && field === 'salaryMinor') return salaryEditor ? FieldAccessLevel.EDIT : FieldAccessLevel.HIDDEN;
  if (resource === 'customer' && ['creditLimitMinor', 'paymentTermsDays'].includes(field)) {
    return ['Sales Manager', 'Branch Manager', 'Finance Manager'].includes(roleName) ? FieldAccessLevel.EDIT
      : financialViewer || roleName === 'Sales Employee' ? FieldAccessLevel.VIEW : FieldAccessLevel.HIDDEN;
  }
  if (resource === 'customer' && field === 'balanceMinor') return financialViewer || roleName === 'Sales Employee' ? FieldAccessLevel.VIEW : FieldAccessLevel.HIDDEN;
  if (resource === 'party' && field === 'taxNumber') return financialEditor || ['Sales Manager', 'Sales Employee', 'Purchasing Manager', 'Branch Manager'].includes(roleName) ? FieldAccessLevel.EDIT : FieldAccessLevel.HIDDEN;
  if (resource === 'bankAccount') return financialEditor ? FieldAccessLevel.EDIT : financialViewer ? FieldAccessLevel.VIEW : FieldAccessLevel.HIDDEN;
  if (resource === 'journal') return financialEditor ? FieldAccessLevel.EDIT : financialViewer ? FieldAccessLevel.VIEW : FieldAccessLevel.HIDDEN;
  if (resource === 'approval') return permissions.some((key) => key.startsWith('approvals.') || key.endsWith('.approve') || key.endsWith('.reject')) ? FieldAccessLevel.VIEW : FieldAccessLevel.HIDDEN;
  if (resource === 'audit') return permissions.some((key) => key.startsWith('audit.')) ? FieldAccessLevel.VIEW : FieldAccessLevel.HIDDEN;
  if (resource === 'attachment') {
    const canEdit = permissions.some((key) => /^(sales|purchasing|inventory)\..+\.(create|edit)$/.test(key));
    const canView = permissions.some((key) => /^(sales|purchasing|inventory)\..+\.view$/.test(key));
    return canEdit ? FieldAccessLevel.EDIT : canView ? FieldAccessLevel.VIEW : FieldAccessLevel.HIDDEN;
  }
  if (resource === 'item') return financialEditor || ['Purchasing Manager', 'Warehouse Manager', 'Branch Manager'].includes(roleName) ? FieldAccessLevel.EDIT : roleName === 'Sales Manager' ? FieldAccessLevel.VIEW : FieldAccessLevel.HIDDEN;
  if (resource === 'document') return financialEditor || ['Purchasing Manager', 'Sales Manager', 'Warehouse Manager', 'Branch Manager'].includes(roleName) ? FieldAccessLevel.VIEW : FieldAccessLevel.HIDDEN;
  return FieldAccessLevel.HIDDEN;
}

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(databaseUrl!)) });
  try {
    const tenants = await db.tenant.findMany({ select: { id: true } });
    if (tenants.length !== 1) throw new Error('Demo profile enablement requires exactly one tenant');
    const tenantId = tenants[0].id;
    const [users, roles, branches, warehouses] = await Promise.all([
      db.user.findMany({
      where: { tenantId, email: { in: profiles.map(({ email }) => email) } },
      select: { id: true, email: true, active: true, mfaEnabled: true, role: { select: { name: true } } },
      }),
      db.role.findMany({
        where: { tenantId, name: { in: [...new Set(profiles.map(({ roleName }) => roleName))] }, active: true, archivedAt: null },
        select: { id: true, name: true },
      }),
      db.branch.findMany({ where: { tenantId, code: { in: ['CAI', 'ALX'] } }, select: { id: true, code: true } }),
      db.warehouse.findMany({ where: { tenantId, code: { in: ['CAI-MAIN', 'CAI-RTL', 'ALX-MAIN'] }, active: true }, select: { id: true, code: true } }),
    ]);
    const roleByName = new Map(roles.map((role) => [role.name, role]));
    const branchByCode = new Map(branches.map((branch) => [branch.code, branch]));
    const warehouseByCode = new Map(warehouses.map((warehouse) => [warehouse.code, warehouse]));
    if (!branchByCode.has('CAI') || !branchByCode.has('ALX')) throw new Error('The CAI and ALX demo branches are required');
    if (!warehouseByCode.has('CAI-MAIN') || !warehouseByCode.has('CAI-RTL') || !warehouseByCode.has('ALX-MAIN')) {
      throw new Error('The CAI-MAIN, CAI-RTL, and ALX-MAIN demo warehouses are required');
    }
    const userByEmail = new Map(users.map((user) => [user.email, user]));
    for (const user of users) {
      const expectedRole = profiles.find(({ email }) => email === user.email)?.roleName;
      if (!expectedRole || user.role.name !== expectedRole) {
        throw new Error(`${user.email} has role ${user.role.name}; expected ${expectedRole || 'a whitelisted demo role'}`);
      }
    }

    const passwordHash = await hash('password', 12);
    const now = new Date();
    await db.$transaction(async (tx) => {
      for (const roleName of [...new Set(profiles.map(({ roleName }) => roleName))]) {
        if (roleByName.has(roleName)) continue;
        const permissions = rolePermissions[roleName];
        if (!permissions) throw new Error(`No current demo role policy exists for ${roleName}`);
        const permissionRows = await tx.permission.findMany({
          where: { tenantId, key: { in: permissions }, active: true },
          select: { id: true, key: true },
        });
        if (permissionRows.length !== permissions.length) {
          const found = new Set(permissionRows.map(({ key }) => key));
          throw new Error(`Missing permission registry keys for ${roleName}: ${permissions.filter((key) => !found.has(key)).join(', ')}`);
        }
        const createdRole = await tx.role.create({
          data: { tenantId, key: roleKeys[roleName], name: roleName, description: `${roleName} access policy`, permissions },
          select: { id: true, name: true },
        });
        roleByName.set(roleName, createdRole);
        await tx.rolePermission.createMany({
          data: permissionRows.map(({ id }) => ({ tenantId, roleId: createdRole.id, permissionId: id })),
        });
        await tx.roleDataScope.createMany({
          data: DATA_SCOPE_RESOURCES.map((resource) => ({ tenantId, roleId: createdRole.id, resource, scope: dataScopeFor(roleName, permissions, resource) })),
        });
        await tx.roleFieldPermission.createMany({
          data: FIELD_REGISTRY.map(([resource, field]) => ({ tenantId, roleId: createdRole.id, resource, field, access: fieldAccessFor(roleName, permissions, resource, field) })),
        });
        const limits = roleLimits[roleName] || {};
        if (Object.keys(limits).length) {
          await tx.roleLimit.createMany({
            data: Object.entries(limits).map(([key, value]) => ({ tenantId, roleId: createdRole.id, key, value })),
          });
        }
      }

      const activatedUserIds = new Map<string, bigint>();
      for (const profile of profiles) {
        const existing = userByEmail.get(profile.email);
        const cairoRestricted = ['Branch Manager', 'Purchasing Manager', 'Warehouse Manager', 'Warehouse Keeper', 'POS Cashier'].includes(profile.roleName);
        const branchIds = (cairoRestricted ? ['CAI'] : ['CAI', 'ALX'])
          .map((code) => branchByCode.get(code)!.id.toString());
        const warehouseCodes = profile.roleName === 'POS Cashier'
          ? ['CAI-RTL']
          : cairoRestricted ? ['CAI-MAIN', 'CAI-RTL'] : ['CAI-MAIN', 'CAI-RTL', 'ALX-MAIN'];
        const warehouseIds = warehouseCodes.map((code) => warehouseByCode.get(code)!.id.toString());
        const user = await tx.user.upsert({
          where: { tenantId_email: { tenantId, email: profile.email } },
          create: {
            tenantId,
            roleId: roleByName.get(profile.roleName)!.id,
            email: profile.email,
            name: profile.name,
            passwordHash,
            branchIds,
            warehouseIds,
            active: true,
            mfaEnabled: false,
            mfaRequired: false,
          },
          update: {
            name: profile.name,
            passwordHash,
            branchIds,
            warehouseIds,
            active: true,
            authVersion: { increment: 1 },
            mfaEnabled: false,
            mfaRequired: false,
            mfaSecretEncrypted: null,
            mfaRecoveryHashes: [],
            mfaEnrolledAt: null,
          },
          select: { id: true },
        });
        activatedUserIds.set(profile.email, user.id);
        await tx.refreshSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.mfaChallenge.deleteMany({ where: { userId: user.id } });
        await tx.accessAuditLog.create({
          data: {
            tenantId,
            subjectUserId: user.id,
            action: 'DEMO_PROFILE_ENABLED',
            previousValue: existing ? { active: existing.active, mfaEnabled: existing.mfaEnabled } : undefined,
            newValue: { active: true, created: !existing, mfaEnabled: false, source: 'ODIN_ENABLE_DEMO_PROFILES' },
          },
        });
      }

      const salesManagerRole = roleByName.get('Sales Manager')!;
      await tx.roleDataScope.updateMany({
        where: { tenantId, roleId: salesManagerRole.id },
        data: { config: { userIds: [activatedUserIds.get('sales@odin.demo')!.toString(), activatedUserIds.get('sales.employee@odin.demo')!.toString()] } },
      });
      await tx.employee.updateMany({
        where: { tenantId, code: 'EMP-0015' },
        data: { userId: activatedUserIds.get('sales.employee@odin.demo')! },
      });
      await tx.employee.updateMany({
        where: { tenantId, code: 'EMP-0032' },
        data: { userId: activatedUserIds.get('hr@odin.demo')! },
      });
      await tx.customer.updateMany({
        where: { tenantId, code: { in: ['CUS-000001', 'CUS-000003'] } },
        data: { ownerUserId: activatedUserIds.get('sales.employee@odin.demo')! },
      });
    }, { maxWait: 10_000, timeout: 30_000 });

    console.log(`Enabled ${profiles.length} role-based demo profiles for tenant ${tenantId.toString()}.`);
  } finally {
    await db.$disconnect();
  }
}

void main();
