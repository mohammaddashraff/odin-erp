import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Actor, AuthService, can } from './auth';
import { canAtCompany, evaluateSodRules, resolveEffectiveAccess } from './access-governance';
import { PrismaService } from './prisma.service';
import { FIELD_REGISTRY, LIMIT_REGISTRY, hasPermission, normalizePermissions, PERMISSION_REGISTRY, permissionMatches } from './permissions';
import { actions, label, permissionPresentation, resourceLabel, rolePresentation, scopePresentation } from './access-presentation';
import { serialize } from './money';
type Tx = Prisma.TransactionClient;
const strings = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];
const id = (v: unknown) => { if (!/^[1-9]\d{0,17}$/.test(String(v)))
    throw new BadRequestException('Invalid account identifier.'); return BigInt(String(v)); };
const roleInclude = { permissionAssignments: { include: { permission: true } }, limits: true, dataScopes: true, fieldPermissions: true } as const;
export function accessRevision(user: any) {
    return createHash('sha256').update(JSON.stringify(serialize({ authVersion: user.authVersion, branchIds: user.branchIds, roles: [user.role, ...user.additionalRoles.map((a: any) => a.role)], overrides: user.permissionOverrides, memberships: user.companyMemberships, grants: user.temporaryGrants, delegations: user.delegationsReceived, assignments: user.resourceAssignments }), (key, value) => ['createdAt', 'updatedAt', 'lastUsedAt', 'passwordHash', 'mfaSecretEncrypted', 'mfaRecoveryHashes'].includes(key) ? undefined : value)).digest('hex');
}
const selfFields = ['name', 'phone', 'jobTitle', 'language', 'expectedProfileVersion'];
export function profileInput(body: any, self: boolean) {
    const allowed = new Set(self ? selfFields : [...selfFields, 'email', 'homeBranchId']);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.has(k)))
        throw new BadRequestException('This profile field cannot be changed here.');
    const result: any = {};
    for (const [key, max] of [['name', 160], ['phone', 50], ['jobTitle', 120], ['email', 200]] as const) {
        if (body[key] === undefined)
            continue;
        if (body[key] !== null && typeof body[key] !== 'string')
            throw new BadRequestException('Enter valid profile details.');
        const value = String(body[key] || '').trim();
        if (value.length > max || (key === 'name' && value.length < 2) || (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))
            throw new BadRequestException('Enter a valid name and email.');
        result[key] = key === 'email' ? value.toLowerCase() : value || null;
    }
    if (body.language !== undefined) {
        if (!['en', 'ar'].includes(body.language))
            throw new BadRequestException('Select English or Arabic.');
        result.language = body.language;
    }
    if (body.homeBranchId !== undefined)
        result.homeBranchId = body.homeBranchId === null ? null : id(body.homeBranchId);
    return result;
}
@Injectable()
export class AdministrationService {
    constructor(private readonly db: PrismaService, private readonly auth: AuthService) { }
    async diagnostics() { await this.db.healthCheck(); return { api: label('Available', 'متاح'), database: label('Available', 'متاح'), checkedAt: new Date().toISOString() }; }
    private visibleCompanies(a: Actor) { return a.companyIds.filter(c => canAtCompany(a, 'settings.users_access.view', c)); }
    private visibleBranches(a: Actor) { return [...new Set(this.visibleCompanies(a).flatMap(c => a.companyBranchIds[c] || []))]; }
    private assertView(a: Actor) { if (!can(a, 'settings.users_access.view') && !this.visibleCompanies(a).length)
        throw new ForbiddenException('User administration access is required.'); }
    private assertManage(a: Actor) { if (!can(a, 'system.super_admin'))
        throw new ForbiddenException('System Administrator access is required to change login accounts.'); }
    private visible(a: Actor, u: any) {
        if (can(a, 'system.super_admin'))
            return true;
        const companies = this.visibleCompanies(a), branches = this.visibleBranches(a), now = new Date();
        return (u.companyMemberships || []).some((m: any) => m.active && m.validFrom <= now && (!m.validUntil || m.validUntil > now) && companies.includes(String(m.companyId))) && strings(u.branchIds).some(b => branches.includes(b));
    }
    private async load(tx: Tx, a: Actor, userId: bigint, self = false) {
        if (!self)
            this.assertView(a);
        const u = await tx.user.findFirst({ where: { id: userId }, include: this.auth.userInclude });
        if (!u || (!self && !this.visible(a, u)) || (self && a.userId !== userId))
            throw new NotFoundException('User not found in your permitted companies and branches.');
        return u;
    }
    private userView(u: any, branches: any[], a: Actor) {
        const visible = can(a, 'system.super_admin') || a.userId === u.id ? strings(u.branchIds) : strings(u.branchIds).filter(b => this.visibleBranches(a).includes(b));
        return { id: String(u.id), name: u.name, email: u.email, phone: u.phone, jobTitle: u.jobTitle, language: u.language, active: u.active,
            homeBranchId: u.homeBranchId && visible.includes(String(u.homeBranchId)) ? String(u.homeBranchId) : null,
            branchIds: visible, branches: branches.filter(b => visible.includes(String(b.id))).map(b => ({ id: String(b.id), name: b.name, operational: b.operational })),
            primaryRole: { id: String(u.roleId), name: u.role.name, ...rolePresentation(u.role) }, additionalRoles: u.additionalRoles.map((v: any) => ({ id: String(v.role.id), name: v.role.name, ...rolePresentation(v.role) })),
            overrides: u.permissionOverrides.map((o: any) => ({ permissionKey: o.permission.key, effect: o.effect, reason: o.reason })),
            mfaRequired: u.mfaRequired, mfaEnabled: u.mfaEnabled, mfaEnrolledAt: u.mfaEnrolledAt, passwordChangeRequired: u.passwordChangeRequired,
            lastSignInAt: u.lastSignInAt, signInState: u.lastSignInAt ? 'RECORDED' : u.signInTrackedSince ? 'NEVER' : 'UNAVAILABLE', profileVersion: u.profileVersion, authVersion: u.authVersion };
    }
    async authorityLimits(a: Actor) {
        this.assertView(a);
        return this.db.tenant(a.tenantId, async (tx) => {
            const companies = await tx.company.findMany({ where: { active: true, ...(can(a, 'system.super_admin') ? {} : { id: { in: a.companyAdminIds.map(BigInt) } }) }, include: { branchLinks: { where: { active: true }, include: { branch: true } } } });
            const [policies, currencies, roles] = await Promise.all([tx.authorityLimitPolicy.findMany({ where: { companyId: { in: companies.map(c => c.id) } }, include: { company: { select: { name: true } }, branch: { select: { name: true } }, role: { select: { name: true } }, department: { select: { name: true } } }, orderBy: { id: 'desc' } }), tx.currency.findMany({ select: { code: true, precision: true, active: true } }), tx.role.findMany({ where: { active: true, archivedAt: null }, select: { id: true, name: true } })]);
            return serialize({ policies, companies: companies.map(c => ({ id: c.id, name: c.name, branches: c.branchLinks.map(l => ({ id: l.branchId, name: l.branch.name })) })), currencies, roles, definitions: LIMIT_REGISTRY, canManage: can(a, 'system.super_admin') });
        });
    }
    async directory(a: Actor) {
        this.assertView(a);
        return this.db.tenant(a.tenantId, async (tx) => {
            const [all, branches, roles] = await Promise.all([
                tx.user.findMany({ include: this.auth.userInclude, orderBy: { name: 'asc' } }),
                tx.branch.findMany({ where: { companyLinks: { some: { active: true, company: { active: true } } } }, orderBy: { name: 'asc' } }),
                tx.role.findMany({ where: { archivedAt: null }, include: roleInclude, orderBy: { name: 'asc' } }),
            ]);
            const visible = all.filter(u => this.visible(a, u)), ids = visible.map(u => u.id);
            const groups = roles.filter(r => can(a, 'system.super_admin') || visible.some(u => u.roleId === r.id || u.additionalRoles.some(x => x.roleId === r.id)));
            const activity = await this.accountActivity(tx, a, ids);
            return { users: visible.map(u => this.userView(u, branches, a)), roles: groups.map(r => ({ id: String(r.id), name: r.name, active: r.active, ...rolePresentation(r) })),
                branches: branches.filter(b => can(a, 'system.super_admin') || this.visibleBranches(a).includes(String(b.id))).map(b => ({ id: String(b.id), name: b.name, operational: b.operational })),
                counts: { active: visible.filter(u => u.active).length, inactive: visible.filter(u => !u.active).length, groups: groups.length }, activity,
                canManage: can(a, 'system.super_admin') };
        });
    }
    private async accountActivity(tx: Tx, a: Actor, ids: bigint[]) {
        const [access, auth] = await Promise.all([
            tx.accessAuditLog.findMany({ where: can(a, 'system.super_admin') ? { OR: [{ subjectUserId: { in: ids } }, { subjectUserId: null }] } : ids.length === 1 && ids[0] === a.userId ? { subjectUserId: a.userId } : { subjectUserId: { in: ids }, OR: [{ companyId: { in: this.visibleCompanies(a) } }, { companyId: null, branchId: { in: this.visibleBranches(a).map(BigInt) } }] }, include: { actorUser: { select: { id: true, name: true } }, subjectUser: { select: { id: true, name: true } }, subjectRole: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }),
            tx.auditEvent.findMany({ where: { userId: { in: ids }, entityType: { in: ['AUTH_SECURITY', 'AUTH_SESSION', 'USER_PROFILE'] } }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
        ]);
        return [...access.map(e => ({ id: `access-${e.id}`, action: e.action, actor: e.actorUser?.name, subject: e.subjectUser?.name || e.subjectRole?.name, subjectUserId: e.subjectUserId && ids.includes(e.subjectUserId) ? String(e.subjectUserId) : null, createdAt: e.createdAt, result: e.action === 'AUTHORIZATION_DENIED' ? 'DENIED' : 'RECORDED', reason: e.denialReason, resourceLabel: e.resourceType ? resourceLabel(e.resourceType) : label('Not recorded', 'لم يُسجّل'), attemptLabel: e.permissionKey ? permissionPresentation(PERMISSION_REGISTRY.find(p => p.key === e.permissionKey) || { key: e.permissionKey, module: 'custom', resource: 'custom', action: 'custom' }).label : actions[e.requestedAction?.toLowerCase() || ''] || label('Not recorded', 'لم يُسجّل'), changes: can(a, 'system.super_admin') || e.subjectUserId === a.userId || a.fieldPermissions.some(f => f.resource === 'audit' && f.field === 'values' && f.access !== 'HIDDEN') ? this.safeChanges(e.previousValue, e.newValue) : [] })),
            ...auth.map(e => ({ id: `auth-${e.id}`, action: e.action, actor: e.user?.name, subject: e.user?.name, subjectUserId: e.userId ? String(e.userId) : null, createdAt: e.createdAt, result: 'RECORDED', reason: null, resource: 'account', requestedAction: null, changes: this.safeChanges(e.previousValues, e.newValues) }))].sort((x, y) => y.createdAt.valueOf() - x.createdAt.valueOf()).slice(0, 200);
    }
    private safeChanges(before: any, after: any) {
        const keys = ['name', 'email', 'phone', 'jobTitle', 'language', 'active', 'mfaRequired', 'mfaEnabled', 'primaryRole'];
        return keys.filter(k => before && after && k in before && k in after && before[k] !== after[k]).map(field => ({ field, before: before[field], after: after[field] }));
    }
    async profile(a: Actor, userId: bigint, self = false) {
        return this.db.tenant(a.tenantId, async (tx) => {
            const user = await this.load(tx, a, userId, self);
            const branches = await tx.branch.findMany({ where: { id: { in: strings(user.branchIds).map(BigInt) } } });
            const eligible = await tx.companyBranch.findMany({ where: { companyId: { in: user.companyMemberships.filter(m => m.active && m.validFrom <= new Date() && (!m.validUntil || m.validUntil > new Date())).map(m => m.companyId) }, active: true, company: { active: true } }, include: { branch: true } });
            return { ...this.userView(user, branches, a), eligibleBranches: (self || can(a, 'system.super_admin') ? eligible : []).map(v => ({ id: String(v.branchId), name: v.branch.name, operational: v.branch.operational })), access: await this.summary(tx, a, user), revision: accessRevision(user),
                activity: await this.accountActivity(tx, a, [user.id]), canManage: !self && can(a, 'system.super_admin') };
        });
    }
    private async summary(tx: Tx, viewer: Actor, user: any) {
        const actor = this.auth.actorFor(user), effective = resolveEffectiveAccess(user), self = viewer.userId === user.id;
        const companies = actor.companyIds.filter(c => self || can(viewer, 'system.super_admin') || this.visibleCompanies(viewer).includes(c));
        const registry = await tx.permission.findMany({ where: { OR: [{ active: true }, { roles: { some: { roleId: { in: actor.roleIds.map(BigInt) } } } }, { userOverrides: { some: { userId: user.id } } }] } });
        const branches = await tx.branch.findMany({ where: { id: { in: [...new Set(companies.flatMap(c => actor.companyBranchIds[c] || []))].map(BigInt) } } });
        const rows = registry.map(p => {
            const allowed = can(actor, p.key) || companies.some(c => canAtCompany(actor, p.key, c));
            const denied = actor.deniedPermissions.some(d => permissionMatches(d, p.key));
            const areaResource = p.module === 'av8' ? (p.resource === 'leads' ? 'av8_lead' : ['workspace', 'policies', 'reports'].includes(p.resource) ? '' : 'av8_application') : p.module === 'banking' && p.resource === 'account' ? 'bank_account' : ({ applications: 'av8_application', reports: 'report' } as Record<string, string>)[p.resource] || p.resource;
            const scope = actor.dataScopes.find(s => s.resource === areaResource);
            const sources: any[] = effective.roles.filter((r: any) => hasPermission([...normalizePermissions(strings(r.permissions)), ...r.permissionAssignments.map((x: any) => x.permission.key)], [], p.key)).map((r: any) => ({ kind: 'GROUP', name: rolePresentation(r).displayName }));
            for (const o of user.permissionOverrides.filter((o: any) => permissionMatches(o.permission.key, p.key)))
                sources.push({ kind: o.effect, name: o.effect === 'DENY' ? label('Individual restriction', 'قيد فردي') : label('Individual permission', 'صلاحية فردية') });
            const scoped = companies.filter(c => hasPermission(actor.companyScopedPermissions[c] || [], actor.deniedPermissions, p.key));
            if (scoped.length)
                sources.push({ kind: 'COMPANY', name: label('Company membership, temporary grant or delegation', 'عضوية الشركة أو صلاحية مؤقتة أو تفويض') });
            return { ...permissionPresentation(p), allowed, denied, sources, recordAccess: can(actor, 'system.super_admin') ? label('All tenant records; business approvals still apply', 'كل بيانات المؤسسة مع تطبيق قواعد الاعتماد') : areaResource ? scopePresentation(areaResource, scope?.scope || 'NONE') : p.resource === 'reports' ? label('The underlying report records and company boundaries', 'حسب سجلات التقرير وحدود الشركات') : label('Company membership and operation rules apply', 'تُطبق عضوية الشركة وقواعد العملية'), recordResource: areaResource, scope: scope?.scope || 'NONE' };
        }).filter(r => r.allowed || r.denied || r.sources.length);
        const visibleBranchIds = new Set(branches.map(b => String(b.id)));
        const records = actor.dataScopes.map(s => ({ resource: s.resource, label: resourceLabel(s.resource), scope: s.scope, description: scopePresentation(s.resource, s.scope), config: s.config }));
        const namedRecords = await Promise.all(records.map(async (s) => {
            const config: any = s.config || {};
            const ids = strings(config.resourceIds).filter(v => /^\d+$/.test(v)).map(BigInt);
            const people = strings(config.userIds).filter(v => /^\d+$/.test(v)).map(BigInt);
            const resourceNames = ids.length ? (s.resource === 'bank_account' ? await tx.bankAccount.findMany({ where: { id: { in: ids }, financialResources: { some: { companyId: { in: companies.map(BigInt) } } } }, select: { name: true } }) : s.resource === 'account' ? await tx.account.findMany({ where: { id: { in: ids }, financialResources: { some: { companyId: { in: companies.map(BigInt) } } } }, select: { name: true } }) : s.resource === 'supplier' ? await tx.supplier.findMany({ where: { id: { in: ids }, companyId: { in: companies.map(BigInt) } }, select: { name: true } }) : []) : [];
            const names = people.length ? await tx.user.findMany({ where: { id: { in: people } }, select: { name: true, branchIds: true } }) : [];
            return { resource: s.resource, label: s.label, scope: s.scope, description: s.description, names: [...resourceNames.map(r => r.name), ...names.filter(r => strings(r.branchIds).some(b => visibleBranchIds.has(b))).map(r => r.name)] };
        }));
        const grants = user.temporaryGrants.filter((g: any) => companies.includes(String(g.companyId))).map((g: any) => ({ kind: 'TEMPORARY', from: g.validFrom, until: g.validUntil, revoked: !!g.revokedAt, permissions: strings(g.permissions).map(key => permissionPresentation(registry.find(p => p.key === key) || { key, module: 'custom', resource: 'custom', action: 'custom' })) }));
        const delegations = user.delegationsReceived.filter((g: any) => companies.includes(String(g.companyId))).map((g: any) => ({ kind: 'DELEGATION', from: g.validFrom, until: g.validUntil, revoked: !!g.revokedAt, fromName: g.delegator.name, permissions: strings(g.permissions).map(key => permissionPresentation(registry.find(p => p.key === key) || { key, module: 'custom', resource: 'custom', action: 'custom' })) }));
        const assignments = user.resourceAssignments.filter((v: any) => companies.includes(String(v.resource.companyId))).map((v: any) => ({ name: v.resource.name, from: v.validFrom, until: v.validUntil, revoked: !!v.revokedAt }));
        return { rows, records: namedRecords, branches: branches.map(b => ({ id: String(b.id), name: b.name })), fields: actor.fieldPermissions.map(f => ({ ...f, label: FIELD_REGISTRY.find(v => v[0] === f.resource && v[1] === f.field)?.[2] || 'Custom sensitive field' })), limits: Object.entries(actor.limits).map(([key, value]) => ({ key, value, label: LIMIT_REGISTRY.find(l => l.key === key)?.description || 'Custom financial limit', unit: LIMIT_REGISTRY.find(l => l.key === key)?.unit })), grants: [...grants, ...delegations], assignments,
            superAdmin: can(actor, 'system.super_admin'), active: user.active, conflicts: evaluateSodRules(rows.filter(r => r.allowed).map(r => r.key), await tx.sodRule.findMany({ where: { active: true } })) };
    }
    async updateProfile(a: Actor, userId: bigint, body: any, self = false) {
        if (!self)
            this.assertManage(a);
        const data = profileInput(body, self);
        return this.db.tenant(a.tenantId, async (tx) => {
            const before = await this.load(tx, a, userId, self);
            if (body.expectedProfileVersion !== before.profileVersion)
                throw new ConflictException('This profile changed. Reload before saving.');
            if (data.homeBranchId && !strings(before.branchIds).includes(String(data.homeBranchId)))
                throw new BadRequestException('Home branch must be one of the permitted branches.');
            if (data.email && await tx.user.findFirst({ where: { id: { not: userId }, email: { equals: data.email, mode: 'insensitive' } } }))
                throw new ConflictException('This email is already in use.');
            await tx.user.update({ where: { id: userId }, data: { ...data, profileVersion: { increment: 1 }, ...(data.email && data.email !== before.email ? { authVersion: { increment: 1 } } : {}) } });
            if (data.email && data.email !== before.email) {
                await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
                await tx.mfaChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
            }
            await tx.accessAuditLog.create({ data: { tenantId: a.tenantId, actorUserId: a.userId, subjectUserId: userId, action: 'USER_DETAILS_UPDATED', previousValue: serialize(Object.fromEntries(Object.keys(data).map(k => [k, (before as any)[k]]))), newValue: serialize(data), branchId: strings(before.branchIds)[0] ? BigInt(strings(before.branchIds)[0]) : null } });
            return { ok: true };
        }).catch(error => { if (error.code === 'P2002')
            throw new ConflictException('This email is already in use.'); throw error; });
    }
    async recover(a: Actor, userId: bigint, body: any) {
        this.assertManage(a);
        const password = String(body.temporaryPassword || '');
        if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72)
            throw new BadRequestException('Use a temporary password of at least 12 characters and at most 72 UTF-8 bytes.');
        const passwordHash = await hash(password, 12), expiresAt = new Date(Date.now() + 24 * 3600000);
        return this.db.tenant(a.tenantId, async (tx) => {
            const user = await this.load(tx, a, userId);
            if (!user.active)
                throw new ConflictException('Activate the account before issuing a temporary password.');
            await tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangeRequired: true, temporaryPasswordExpiresAt: expiresAt, authVersion: { increment: 1 } } });
            await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
            await tx.mfaChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
            await tx.accessAuditLog.create({ data: { tenantId: a.tenantId, actorUserId: a.userId, subjectUserId: userId, action: 'TEMPORARY_PASSWORD_ISSUED', newValue: { expiresAt: expiresAt.toISOString() } } });
            return { ok: true, expiresAt };
        });
    }
    async preview(a: Actor, userId: bigint, body: any) {
        this.assertManage(a);
        return this.db.tenant(a.tenantId, async (tx) => {
            const user = await this.load(tx, a, userId);
            if (body.revision !== accessRevision(user))
                throw new ConflictException('Access changed. Reload before previewing or saving.');
            const proposed = await this.proposed(tx, a, user, body.changes || {});
            const [before, after] = await Promise.all([this.summary(tx, a, user), this.summary(tx, a, proposed)]);
            return { before, after, revision: body.revision, mutated: false };
        });
    }
    async proposed(tx: Tx, a: Actor, user: any, changes: any) {
        for (const key of ['additionalRoleIds','branchIds','overrides']) if(changes[key] !== undefined && !Array.isArray(changes[key])) throw new BadRequestException('Invalid access assignments.');
        for (const key of ['active','mfaRequired']) if(changes[key] !== undefined && typeof changes[key] !== 'boolean') throw new BadRequestException('Invalid account setting.');
        if (Object.keys(changes).some(k => !['primaryRoleId', 'additionalRoleIds', 'overrides', 'branchIds', 'mfaRequired', 'active'].includes(k)))
            throw new BadRequestException('Unsupported access change.');
        const primary = changes.primaryRoleId === undefined || String(changes.primaryRoleId) === String(user.role.id) ? user.role : await tx.role.findFirst({ where: { id: id(changes.primaryRoleId), active: true, archivedAt: null }, include: roleInclude });
        if (!primary)
            throw new BadRequestException('Select an active access group.');
        const additional = changes.additionalRoleIds === undefined ? user.additionalRoles : await Promise.all(strings(changes.additionalRoleIds).filter(v => v !== String(primary.id)).map(async (v) => { const role = user.additionalRoles.find((entry: any) => String(entry.role.id) === v)?.role || await tx.role.findFirst({ where: { id: id(v), active: true, archivedAt: null }, include: roleInclude }); if (!role)
            throw new BadRequestException('Select an active access group.'); return { role }; }));
        const overrides = changes.overrides === undefined ? user.permissionOverrides : await Promise.all((changes.overrides || []).map(async (o: any) => { if (!['GRANT', 'DENY'].includes(o.effect))
            throw new BadRequestException('Invalid permission exception.'); const permission = user.permissionOverrides.find((entry: any) => entry.permission.key === o.permissionKey && entry.effect === o.effect)?.permission || await tx.permission.findFirst({ where: { key: o.permissionKey, active: true } }); if (!permission)
            throw new BadRequestException('Invalid permission exception.'); return { ...o, permission }; }));
        const branchIds = changes.branchIds === undefined ? strings(user.branchIds) : strings(changes.branchIds);
        if (!branchIds.length)
            throw new BadRequestException('Select at least one permitted branch.');
        const links = await tx.companyBranch.findMany({ where: { branchId: { in: branchIds.map(id) }, active: true, company: { active: true, memberships: { some: { userId: user.id, active: true } } }, branch: { OR: [{ operational: true }, { id: { in: strings(user.branchIds).map(BigInt) } }] } } });
        if (branchIds.some(b => !links.some(l => String(l.branchId) === b)))
            throw new BadRequestException('Branches must belong to the user’s active company memberships.');
        const result = { ...user, ...changes, role: primary, roleId: primary.id, additionalRoles: additional, permissionOverrides: overrides, branchIds };
        const effective = resolveEffectiveAccess(result);
        if (PERMISSION_REGISTRY.some(p => hasPermission(effective.permissions, effective.deniedPermissions, p.key) && !hasPermission(a.permissions, a.deniedPermissions, p.key)))
            throw new ForbiddenException('You cannot assign permissions beyond your own authority.');
        return result;
    }
}
