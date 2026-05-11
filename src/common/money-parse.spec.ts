import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  decimalToMoneyString,
  parseNonNegativeMoneyString,
  parsePositiveMoneyString,
} from './money-parse';

describe('parsePositiveMoneyString', () => {
  it('rejects empty / whitespace / non-string input', () => {
    expect(() => parsePositiveMoneyString('')).toThrow(BadRequestException);
    expect(() => parsePositiveMoneyString('   ')).toThrow(BadRequestException);
    expect(() =>
      parsePositiveMoneyString(undefined as unknown as string),
    ).toThrow(BadRequestException);
    expect(() => parsePositiveMoneyString(null as unknown as string)).toThrow(
      BadRequestException,
    );
    expect(() => parsePositiveMoneyString(123 as unknown as string)).toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid decimal shapes', () => {
    expect(() => parsePositiveMoneyString('1e3')).toThrow(BadRequestException);
    expect(() => parsePositiveMoneyString('+1')).toThrow(BadRequestException);
    expect(() => parsePositiveMoneyString('-1')).toThrow(BadRequestException);
    expect(() => parsePositiveMoneyString('abc')).toThrow(BadRequestException);
    expect(() => parsePositiveMoneyString('1.2.3')).toThrow(
      BadRequestException,
    );
    expect(() => parsePositiveMoneyString('.5')).toThrow(BadRequestException);
  });

  it('rejects more than six fractional digits but allows exactly six', () => {
    expect(parsePositiveMoneyString('1.123456').toString()).toBe('1.123456');
    expect(() => parsePositiveMoneyString('1.1234567')).toThrow(
      BadRequestException,
    );
  });

  it('rejects zero and negative values', () => {
    expect(() => parsePositiveMoneyString('0')).toThrow(BadRequestException);
    expect(() => parsePositiveMoneyString('0.0')).toThrow(BadRequestException);
    expect(() => parsePositiveMoneyString('0.000000')).toThrow(
      BadRequestException,
    );
  });

  it('accepts typical valid positive values and returns a Decimal', () => {
    const a = parsePositiveMoneyString('1');
    const b = parsePositiveMoneyString('100.000000');
    const c = parsePositiveMoneyString('  42.5  ');
    expect(a).toBeInstanceOf(Decimal);
    expect(a.eq('1')).toBe(true);
    expect(b.eq('100')).toBe(true);
    expect(c.eq('42.5')).toBe(true);
  });

  it('uses the provided label in the error message', () => {
    try {
      parsePositiveMoneyString('', 'amount');
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect(String((err as BadRequestException).message)).toContain('amount');
    }
  });
});

describe('parseNonNegativeMoneyString', () => {
  it('uses fallback when raw is undefined', () => {
    const d = parseNonNegativeMoneyString(undefined, '500.000000', 'limit');
    expect(d.toString()).toBe('500');
  });

  it('uses the raw value when provided (not the fallback)', () => {
    const d = parseNonNegativeMoneyString('100', '500.000000', 'limit');
    expect(d.toString()).toBe('100');
  });

  it('accepts zero', () => {
    const d = parseNonNegativeMoneyString('0', '500.000000', 'limit');
    expect(d.isZero()).toBe(true);
  });

  it('rejects negative values', () => {
    expect(() =>
      parseNonNegativeMoneyString('-1', '500.000000', 'limit'),
    ).toThrow(BadRequestException);
  });

  it('rejects invalid decimal shapes', () => {
    expect(() =>
      parseNonNegativeMoneyString('1e2', '500.000000', 'limit'),
    ).toThrow(BadRequestException);
    expect(() =>
      parseNonNegativeMoneyString('abc', '500.000000', 'limit'),
    ).toThrow(BadRequestException);
  });

  it('rejects more than six fractional digits', () => {
    expect(() =>
      parseNonNegativeMoneyString('1.1234567', '500.000000', 'limit'),
    ).toThrow(BadRequestException);
  });
});

describe('decimalToMoneyString', () => {
  it('formats to exactly six fractional digits', () => {
    expect(decimalToMoneyString(new Decimal('1'))).toBe('1.000000');
    expect(decimalToMoneyString(new Decimal('1.5'))).toBe('1.500000');
    expect(decimalToMoneyString(new Decimal('0'))).toBe('0.000000');
    expect(decimalToMoneyString(new Decimal('123.456789'))).toBe('123.456789');
  });
});
