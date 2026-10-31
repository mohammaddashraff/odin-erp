import { BadRequestException } from '@nestjs/common';
import { money, quantity, roundDiv } from './money';

describe('exact fixed-point business math', () => {
  it('parses money and quantity without binary floating point', () => {
    expect(money('1234567.89')).toBe(123456789n);
    expect(quantity('12.345')).toBe(12345n);
    expect(money('-0.01')).toBe(-1n);
  });

  it('rejects excess precision and non-numeric values', () => {
    expect(() => money('1.001')).toThrow(BadRequestException);
    expect(() => quantity('1.0001')).toThrow(BadRequestException);
    expect(() => money('1e3')).toThrow(BadRequestException);
  });

  it('uses deterministic half-up division', () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(4n, 2n)).toBe(2n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
  });
});


describe('currency minor-unit conversion', () => {
  const { convertMinor, currencyAmount } = require('./money');
  it('converts zero, two and three decimal currencies to USD cents exactly', () => {
    expect(convertMinor(currencyAmount('1500', 0), 0, 2, 6667n)).toBe(1000n);
    expect(convertMinor(currencyAmount('2000.50', 2), 2, 2, 1000000n)).toBe(200050n);
    expect(convertMinor(currencyAmount('1.234', 3), 3, 2, 3250000n)).toBe(401n);
  });
  it('rejects excess fractional units, invalid scales and nonpositive rates', () => {
    expect(() => currencyAmount('1.1', 0)).toThrow();
    expect(() => convertMinor(100n, 2, 2, 0n)).toThrow();
    expect(() => convertMinor(100n, -1, 2, 1n)).toThrow();
  });
});
