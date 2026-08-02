import type { Language } from './i18n';

export type FormatPreferences = {
  numerals?: 'arabic' | 'western';
  dateFormat?: 'medium' | 'short' | 'long';
  currencyPosition?: 'locale' | 'before' | 'after';
  decimalPrecision?: number;
  thousandSeparators?: boolean;
};

const safeBigInt = (value: unknown) => {
  try { return BigInt(String(value ?? 0)); } catch { return 0n; }
};

export function localeFor(language: Language, preferences: FormatPreferences = {}) {
  const locale = language === 'ar' ? 'ar-EG' : 'en-EG';
  const numberingSystem = preferences.numerals === 'western' ? 'latn' : preferences.numerals === 'arabic' ? 'arab' : undefined;
  return numberingSystem ? `${locale}-u-nu-${numberingSystem}` : locale;
}

export function formatCurrency(minor: unknown, currency = 'EGP', language: Language = 'en', preferences: FormatPreferences = {}) {
  const precision = Math.max(0, Math.min(6, preferences.decimalPrecision ?? 2));
  const amount = Number(safeBigInt(minor)) / 100;
  if (preferences.currencyPosition && preferences.currencyPosition !== 'locale') {
    const number = new Intl.NumberFormat(localeFor(language, preferences), { minimumFractionDigits: precision, maximumFractionDigits: precision, useGrouping: preferences.thousandSeparators !== false }).format(amount);
    return preferences.currencyPosition === 'before' ? `${currency} ${number}` : `${number} ${currency}`;
  }
  return new Intl.NumberFormat(localeFor(language, preferences), { style: 'currency', currency, minimumFractionDigits: precision, maximumFractionDigits: precision, useGrouping: preferences.thousandSeparators !== false }).format(amount);
}

export function formatNumber(value: unknown, language: Language = 'en', preferences: FormatPreferences = {}, maximumFractionDigits = 3) {
  return new Intl.NumberFormat(localeFor(language, preferences), { maximumFractionDigits, useGrouping: preferences.thousandSeparators !== false }).format(Number(value || 0));
}

export function formatQuantity(milli: unknown, language: Language = 'en', preferences: FormatPreferences = {}) {
  return formatNumber(Number(safeBigInt(milli)) / 1000, language, preferences, 3);
}

export function formatPercentage(value: unknown, language: Language = 'en', preferences: FormatPreferences = {}) {
  return new Intl.NumberFormat(localeFor(language, preferences), { style: 'percent', maximumFractionDigits: preferences.decimalPrecision ?? 2 }).format(Number(value || 0) / 100);
}

export function formatExchangeRate(micros: unknown, language: Language = 'en', preferences: FormatPreferences = {}) {
  return formatNumber(Number(safeBigInt(micros)) / 1_000_000, language, preferences, preferences.decimalPrecision ?? 6);
}

export function formatDate(value: string | Date | null | undefined, language: Language = 'en', preferences: FormatPreferences = {}) {
  if (!value) return '—';
  const dateStyle = preferences.dateFormat || 'medium';
  return new Intl.DateTimeFormat(localeFor(language, preferences), { dateStyle }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined, language: Language = 'en', preferences: FormatPreferences = {}) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(localeFor(language, preferences), { dateStyle: preferences.dateFormat || 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatMonthYear(value: string | Date | null | undefined, language: Language = 'en', preferences: FormatPreferences = {}) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(localeFor(language, preferences), { month: 'long', year: 'numeric' }).format(new Date(value));
}
