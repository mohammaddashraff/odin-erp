import { BadRequestException } from '@nestjs/common';

export function parseFixed(value: unknown, decimals: number, field: string): bigint {
  const text = String(value ?? '').trim();
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match || (match[3]?.length || 0) > decimals) throw new BadRequestException(`${field} must have no more than ${decimals} decimal places`);
  const scale = 10n ** BigInt(decimals);
  const fraction = (match[3] || '').padEnd(decimals, '0');
  const amount = BigInt(match[2]) * scale + BigInt(fraction || '0');
  return match[1] ? -amount : amount;
}

export const money = (value: unknown, field = 'amount') => parseFixed(value, 2, field);
export const quantity = (value: unknown, field = 'quantity') => parseFixed(value, 3, field);

export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new BadRequestException('Division by zero');
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + denominator / 2n) / denominator);
}

export function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
}

/** Explicit currency scale: USD cents are independent of the source currency minor unit. */
export function currencyAmount(value: unknown, precision: number, field = 'amount'): bigint {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) throw new BadRequestException('Unsupported currency precision');
  return parseFixed(value, precision, field);
}
export function convertMinor(amount: bigint, fromPrecision: number, toPrecision: number, rateMicros: bigint): bigint {
  if (![fromPrecision, toPrecision].every(p => Number.isInteger(p) && p >= 0 && p <= 6) || rateMicros <= 0n) throw new BadRequestException('Invalid conversion scale or rate');
  return roundDiv(amount * rateMicros * 10n ** BigInt(toPrecision), 1000000n * 10n ** BigInt(fromPrecision));
}
