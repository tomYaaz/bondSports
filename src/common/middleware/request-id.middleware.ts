import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

export function requestIdMiddleware(
  req: Request,
  _res: Response,
  next: () => void,
): void {
  const header = req.headers['x-request-id'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  req.requestId =
    typeof fromHeader === 'string' && fromHeader.trim().length > 0
      ? fromHeader.trim()
      : randomUUID();
  next();
}
