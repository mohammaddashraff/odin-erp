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
