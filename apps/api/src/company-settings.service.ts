import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, type Actor } from './auth';
import { companyProfileInput } from './company-profile';
import { serialize } from './money';
import { PrismaService } from './prisma.service';

@Injectable()
export class CompanySettingsService {
  constructor(private readonly db: PrismaService) {}

  private canManage(actor: Actor, companyId: bigint) {
    return can(actor, 'system.super_admin') || actor.companyAdminIds.includes(String(companyId));
  }

  private view(company: any, actor: Actor) {
    const profile = company.profile || {};
    return serialize({
      id: company.id,
      code: company.code,
      name: company.name,
      baseCurrency: company.baseCurrency,
      nameAr: profile.nameAr,
      legalName: profile.legalName,
      email: profile.email,
      phone: profile.phone,
      website: profile.website,
      address: profile.address,
      commercialRegistration: profile.commercialRegistration,
      taxNumber: profile.taxNumber,
      logoImage: profile.logoImage,
      version: profile.version || 0,
      canManage: this.canManage(actor, company.id),
    });
  }

  async list(actor: Actor) {
    const ids = actor.companyIds.filter((value) => /^\d+$/.test(value)).map(BigInt);
    if (!ids.length) throw new ForbiddenException('No company settings are available for this account.');
    return this.db.tenant(actor.tenantId, async (tx) => {
      const companies = await tx.company.findMany({ where: { id: { in: ids }, active: true }, include: { profile: true }, orderBy: { name: 'asc' } });
      return companies.map((company) => this.view(company, actor));
    });
  }

  async update(actor: Actor, companyId: bigint, body: any) {
    const input = companyProfileInput(body);
    if (!actor.companyIds.includes(String(companyId))) throw new NotFoundException('Company not found.');
    if (!this.canManage(actor, companyId)) throw new ForbiddenException('Company administrator access is required.');
    return this.db.tenant(actor.tenantId, async (tx) => {
      const before = await tx.company.findFirst({ where: { id: companyId, active: true }, include: { profile: true } });
      if (!before) throw new NotFoundException('Company not found.');
      if ((before.profile?.version || 0) !== input.version) throw new ConflictException('Company settings changed. Reload before saving.');
      await tx.company.update({ where: { id: companyId }, data: { name: input.name } });
      let profile;
      if (before.profile) {
        const updated = await tx.companyProfile.updateMany({
          where: { tenantId: actor.tenantId, companyId, version: input.version },
          data: { ...input.profile, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new ConflictException('Company settings changed. Reload before saving.');
        profile = await tx.companyProfile.findUniqueOrThrow({ where: { companyId } });
      } else {
        profile = await tx.companyProfile.create({ data: { tenantId: actor.tenantId, companyId, ...input.profile, version: 1 } });
      }
      await tx.auditEvent.create({ data: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'COMPANY_SETTINGS_UPDATED',
        entityType: 'COMPANY_PROFILE',
        entityId: String(companyId),
        companyId: String(companyId),
        previousValues: { name: before.name, hasLogo: !!before.profile?.logoImage },
        newValues: { name: input.name, hasLogo: !!profile.logoImage },
      } });
      return this.view({ ...before, name: input.name, profile }, actor);
    }).catch((error: any) => {
      if (error?.code === 'P2002') throw new ConflictException('Company settings changed. Reload before saving.');
      throw error;
    });
  }
}
