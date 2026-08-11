import type { Language } from './i18n';

export type FormatPreferences = {
  /** @deprecated Odin always renders UI numbers with Western digits. */
  numerals?: 'arabic' | 'western';
  dateFormat?: 'medium' | 'short' | 'long';
  currencyPosition?: 'locale' | 'before' | 'after';
  decimalPrecision?: number;
  thousandSeparators?: boolean;
};

const safeBigInt = (value: unknown) => {
  try { return BigInt(String(value ?? 0)); } catch { return 0n; }
};

const ARABIC_INDIC_ZERO = '٠'.charCodeAt(0);
const EASTERN_ARABIC_ZERO = '۰'.charCodeAt(0);

/**
 * Converts Arabic-Indic and Eastern Arabic digits without changing the
 * surrounding Arabic copy. This is also used at translation/input boundaries
 * so identifiers received as strings follow the same policy as Intl output.
 */
export function normalizeWesternDigits(value: unknown) {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= EASTERN_ARABIC_ZERO ? code - EASTERN_ARABIC_ZERO : code - ARABIC_INDIC_ZERO);
  });
}

/** Normalize a user-entered numeric value to the canonical API representation. */
export function normalizeWesternNumberInput(value: unknown) {
  return normalizeWesternDigits(value)
    .replaceAll('٫', '.')
    .replaceAll('٬', ',')
    .replaceAll('\u00a0', ' ');
}

const decimalFromScaledInteger = (value: bigint, scale: number) => {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${whole}${scale ? `.${fraction}` : ''}`;
};

const exactDecimal = (value: unknown, locale: string, maximumFractionDigits: number, minimumFractionDigits = 0, useGrouping = true) => {
  const normalized = normalizeWesternNumberInput(value).replaceAll(',', '').trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return new Intl.NumberFormat(locale, { maximumFractionDigits, minimumFractionDigits, useGrouping }).format(0);
  const negative = match[1] === '-';
  const inputFraction = match[3] || '';
  const keptScale = Math.max(0, maximumFractionDigits);
  const sourceScale = inputFraction.length;
  let scaled = BigInt(match[2] + inputFraction);
  if (sourceScale > keptScale) {
    const divisor = 10n ** BigInt(sourceScale - keptScale);
    const remainder = scaled % divisor;
    scaled /= divisor;
    if (remainder * 2n >= divisor) scaled += 1n;
  } else if (sourceScale < keptScale) scaled *= 10n ** BigInt(keptScale - sourceScale);
  const scaleDivisor = 10n ** BigInt(keptScale);
  const whole = keptScale ? scaled / scaleDivisor : scaled;
  let fraction = keptScale ? (scaled % scaleDivisor).toString().padStart(keptScale, '0') : '';
  while (fraction.length > minimumFractionDigits && fraction.endsWith('0')) fraction = fraction.slice(0, -1);

  const integerFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping });
  const integer = integerFormatter.format(whole);
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).formatToParts(1.1).find((part) => part.type === 'decimal')?.value || '.';
  const negativePrefix = negative && scaled !== 0n
    ? integerFormatter.formatToParts(-1n).slice(0, integerFormatter.formatToParts(-1n).findIndex((part) => part.type === 'integer')).map((part) => part.value).join('')
    : '';
  return `${negativePrefix}${integer}${fraction ? `${decimal}${fraction}` : ''}`;
};

const applyIntlAffixes = (numeric: string, parts: Intl.NumberFormatPart[], numericTypes: Set<Intl.NumberFormatPartTypes>) => {
  let inserted = false;
  return parts.map((part) => {
    if (!numericTypes.has(part.type)) return part.value;
    if (inserted) return '';
    inserted = true;
    return numeric;
  }).join('');
};

export function localeFor(language: Language, _preferences: FormatPreferences = {}) {
  // Product policy: Arabic copy remains Arabic/RTL, while every number uses
  // Western digits and separators. This is intentionally not user-overridable.
  return language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG-u-nu-latn';
}

export function formatCurrency(minor: unknown, currency = 'EGP', language: Language = 'en', preferences: FormatPreferences = {}) {
  const precision = Math.max(0, Math.min(6, preferences.decimalPrecision ?? 2));
  const locale = localeFor(language, preferences);
  const amount = exactDecimal(decimalFromScaledInteger(safeBigInt(minor), 2), locale, precision, precision, preferences.thousandSeparators !== false);
  if (preferences.currencyPosition && preferences.currencyPosition !== 'locale') {
    return preferences.currencyPosition === 'before' ? `${currency} ${amount}` : `${amount} ${currency}`;
  }
  const template = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: precision, maximumFractionDigits: precision, useGrouping: preferences.thousandSeparators !== false }).formatToParts(1);
  return applyIntlAffixes(amount, template, new Set(['integer', 'group', 'decimal', 'fraction', 'minusSign']));
}

export function formatNumber(value: unknown, language: Language = 'en', preferences: FormatPreferences = {}, maximumFractionDigits = 3) {
  return exactDecimal(value, localeFor(language, preferences), maximumFractionDigits, 0, preferences.thousandSeparators !== false);
}

export function formatQuantity(milli: unknown, language: Language = 'en', preferences: FormatPreferences = {}) {
  return formatNumber(decimalFromScaledInteger(safeBigInt(milli), 3), language, preferences, 3);
}

export function formatPercentage(value: unknown, language: Language = 'en', preferences: FormatPreferences = {}) {
  const locale = localeFor(language, preferences);
  const precision = preferences.decimalPrecision ?? 2;
  const number = exactDecimal(value, locale, precision, 0, preferences.thousandSeparators !== false);
  const template = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: precision }).formatToParts(1);
  return applyIntlAffixes(number, template, new Set(['integer', 'group', 'decimal', 'fraction', 'minusSign']));
}

export function formatExchangeRate(micros: unknown, language: Language = 'en', preferences: FormatPreferences = {}) {
  return formatNumber(decimalFromScaledInteger(safeBigInt(micros), 6), language, preferences, preferences.decimalPrecision ?? 6);
}

export function formatInteger(value: unknown, language: Language = 'en', preferences: FormatPreferences = {}) {
  return formatNumber(value, language, preferences, 0);
}

export function formatDate(value: string | Date | null | undefined, language: Language = 'en', preferences: FormatPreferences = {}) {
  if (!value) return '—';
  const dateStyle = preferences.dateFormat || 'medium';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat(localeFor(language, preferences), { dateStyle }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined, language: Language = 'en', preferences: FormatPreferences = {}) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat(localeFor(language, preferences), { dateStyle: preferences.dateFormat || 'medium', timeStyle: 'short' }).format(date);
}

export function formatMonthYear(value: string | Date | null | undefined, language: Language = 'en', preferences: FormatPreferences = {}) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat(localeFor(language, preferences), { month: 'long', year: 'numeric' }).format(date);
}
