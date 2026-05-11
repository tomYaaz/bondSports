import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';

const MAX_DECIMAL_PLACES = 6;

/**
 * Strict positive money string for API values (no scientific notation).
 */
export function parsePositiveMoneyString(
  raw: string,
  label = 'value',
): Decimal {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadRequestException(`${label} must be a non-empty string`);
  }
  const s = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new BadRequestException(`${label} must be a decimal string`);
  }
  const parts = s.split('.');
  if (parts[1] && parts[1].length > MAX_DECIMAL_PLACES) {
    throw new BadRequestException(
      `${label} must have at most ${MAX_DECIMAL_PLACES} decimal places`,
    );
  }
  const d = new Decimal(s);
  if (!d.isFinite() || d.lte(0)) {
    throw new BadRequestException(`${label} must be greater than 0`);
  }
  return d;
}

export function parseNonNegativeMoneyString(
  raw: string | undefined,
  fallback: string,
  label: string,
): Decimal {
  const s = (raw ?? fallback).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new BadRequestException(`${label} must be a decimal string`);
  }
  const parts = s.split('.');
  if (parts[1] && parts[1].length > MAX_DECIMAL_PLACES) {
    throw new BadRequestException(
      `${label} must have at most ${MAX_DECIMAL_PLACES} decimal places`,
    );
  }
  const d = new Decimal(s);
  if (!d.isFinite() || d.lt(0)) {
    throw new BadRequestException(`${label} must be >= 0`);
  }
  return d;
}

export function decimalToMoneyString(d: Decimal): string {
  return d.toFixed(MAX_DECIMAL_PLACES);
}
