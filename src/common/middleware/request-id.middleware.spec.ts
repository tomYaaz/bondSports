import type { Request, Response } from 'express';
import { requestIdMiddleware } from './request-id.middleware';

function makeReq(
  headers: Record<string, string | string[] | undefined> = {},
): Request {
  return { headers } as unknown as Request;
}

describe('requestIdMiddleware', () => {
  it('uses x-request-id when present (trimmed)', () => {
    const req = makeReq({ 'x-request-id': '   my-id  ' });
    const next = jest.fn();
    requestIdMiddleware(req, {} as Response, next);
    expect(req.requestId).toBe('my-id');
    expect(next).toHaveBeenCalled();
  });

  it('generates a UUID when header is missing', () => {
    const req = makeReq({});
    requestIdMiddleware(req, {} as Response, jest.fn());
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a UUID when header is a blank string', () => {
    const req = makeReq({ 'x-request-id': '   ' });
    requestIdMiddleware(req, {} as Response, jest.fn());
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a different id on each invocation when no header is supplied', () => {
    const r1 = makeReq({});
    const r2 = makeReq({});
    requestIdMiddleware(r1, {} as Response, jest.fn());
    requestIdMiddleware(r2, {} as Response, jest.fn());
    expect(r1.requestId).not.toBe(r2.requestId);
  });

  it('uses the first element when the header is an array', () => {
    const req = makeReq({ 'x-request-id': ['first-id', 'second'] });
    requestIdMiddleware(req, {} as Response, jest.fn());
    expect(req.requestId).toBe('first-id');
  });

  it('calls next() exactly once', () => {
    const next = jest.fn();
    requestIdMiddleware(makeReq({}), {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
