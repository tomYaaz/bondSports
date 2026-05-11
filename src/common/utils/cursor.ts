import { BadRequestException } from '@nestjs/common';

export function encodeCursor(d: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ d: d.toISOString(), id }),
    'utf8',
  ).toString('base64url');
}

export function decodeCursor(cursor: string): { d: string; id: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  if (!raw || typeof raw !== 'object') {
    throw new BadRequestException('Invalid cursor');
  }
  const d = (raw as { d?: string }).d;
  const id = (raw as { id?: string }).id;
  if (typeof d !== 'string' || typeof id !== 'string') {
    throw new BadRequestException('Invalid cursor');
  }
  return { d, id };
}
