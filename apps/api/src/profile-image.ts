import { BadRequestException } from '@nestjs/common';

const imageTypes: Record<string, (bytes: Buffer) => boolean> = {
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9,
  'image/webp': (bytes) => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
};

export function profileImage(value: unknown, maxBytes = 768 * 1024) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('Choose a valid PNG, JPEG or WebP image.');
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new BadRequestException('Choose a valid PNG, JPEG or WebP image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes || !imageTypes[match[1]]?.(bytes)) {
    throw new BadRequestException(`Image must be a valid PNG, JPEG or WebP file no larger than ${Math.floor(maxBytes / 1024)} KB.`);
  }
  return `data:${match[1]};base64,${bytes.toString('base64')}`;
}
