import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './cursor';

describe('cursor encode/decode', () => {
  it('round-trips a date + id pair', () => {
    const d = new Date('2026-05-11T12:34:56.000Z');
    const id = '11111111-2222-3333-4444-555555555555';
    const c = encodeCursor(d, id);
    expect(typeof c).toBe('string');
    expect(c).not.toContain('=');
    expect(c).not.toContain('+');
    expect(c).not.toContain('/');
    const decoded = decodeCursor(c);
    expect(decoded.d).toBe(d.toISOString());
    expect(decoded.id).toBe(id);
  });

  it('rejects garbage base64url with BadRequestException', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(BadRequestException);
  });

  it('rejects non-object JSON payloads', () => {
    const arrCursor = Buffer.from(JSON.stringify([1, 2, 3]), 'utf8').toString(
      'base64url',
    );
    const primCursor = Buffer.from(JSON.stringify('a'), 'utf8').toString(
      'base64url',
    );
    const nullCursor = Buffer.from(JSON.stringify(null), 'utf8').toString(
      'base64url',
    );
    expect(() => decodeCursor(arrCursor)).toThrow(BadRequestException);
    expect(() => decodeCursor(primCursor)).toThrow(BadRequestException);
    expect(() => decodeCursor(nullCursor)).toThrow(BadRequestException);
  });

  it('rejects objects missing fields or with wrong field types', () => {
    const missingId = Buffer.from(
      JSON.stringify({ d: new Date().toISOString() }),
      'utf8',
    ).toString('base64url');
    const missingD = Buffer.from(
      JSON.stringify({ id: 'abc' }),
      'utf8',
    ).toString('base64url');
    const wrongTypes = Buffer.from(
      JSON.stringify({ d: 123, id: 456 }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeCursor(missingId)).toThrow(BadRequestException);
    expect(() => decodeCursor(missingD)).toThrow(BadRequestException);
    expect(() => decodeCursor(wrongTypes)).toThrow(BadRequestException);
  });
});
