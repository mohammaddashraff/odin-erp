import { BadRequestException } from '@nestjs/common';
import { profileImage } from './profile-image';

const textLimits = {
  name: 160,
  nameAr: 160,
  legalName: 200,
  email: 200,
  phone: 50,
  website: 240,
  address: 500,
  commercialRegistration: 100,
  taxNumber: 100,
} as const;

export function companyProfileInput(body: any) {
  const allowed = new Set([...Object.keys(textLimits), 'logoImage', 'version']);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.has(key))) {
    throw new BadRequestException('This company setting cannot be changed here.');
  }
  const version = Number(body.version);
  if (!Number.isSafeInteger(version) || version < 0) throw new BadRequestException('Reload company settings before saving.');
  const data: Record<string, string | null> = {};
  for (const [key, limit] of Object.entries(textLimits)) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') {
      throw new BadRequestException('Enter valid company details.');
    }
    const value = String(body[key] || '').trim();
    if (value.length > limit || (key === 'name' && value.length < 2)) throw new BadRequestException('Enter valid company details.');
    data[key] = value || null;
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new BadRequestException('Enter a valid company email.');
  if (data.website) {
    try {
      const url = new URL(data.website);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      data.website = url.toString();
    } catch {
      throw new BadRequestException('Enter a valid company website.');
    }
  }
  return { version, name: data.name!, profile: { ...data, name: undefined, logoImage: profileImage(body.logoImage) } };
}
