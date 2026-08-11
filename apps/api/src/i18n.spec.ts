import { apiDateTime, apiLabel, apiLocale, apiMinorCurrency, apiQuantity, apiText, normalizeWesternDigits } from './i18n';

const nonWesternDigit = /[\u0660-\u0669\u06f0-\u06f9]/;

describe('Arabic export numeral policy', () => {
  it('pins a Latin-numbering locale for both API languages', () => {
    expect(apiLocale('ar')).toBe('ar-EG-u-nu-latn');
    expect(apiLocale('en')).toBe('en-EG-u-nu-latn');
  });

  it('normalizes Arabic-Indic and Persian digits in translated and dynamic text', () => {
    expect(normalizeWesternDigits('١٢٣ / ۴۵۶')).toBe('123 / 456');
    expect(apiText('POS RECEIPT ١۲٣', 'ar')).toContain('123');
    expect(apiLabel('reference١۲', 'ar')).not.toMatch(nonWesternDigit);
  });

  it('formats exact large currency, quantity, and timestamp values with Western digits', () => {
    const values = [
      apiMinorCurrency('900719925474099312345', 'ar'),
      apiQuantity('9007199254740993123', 'ar'),
      apiDateTime('2026-08-09T12:34:56.000Z', 'ar'),
    ];
    expect(values.join(' ')).not.toMatch(nonWesternDigit);
    expect(values[0].replace(/[^0-9]/g, '')).toContain('900719925474099312345');
  });
});
