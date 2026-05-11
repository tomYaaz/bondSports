import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

function makeContext(
  req: Record<string, unknown>,
  res: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('logs success with method, url, status, duration, requestId', (done) => {
    const ctx = makeContext(
      { method: 'GET', url: '/x', requestId: 'rid-1' },
      { statusCode: 200 },
    );
    const next: CallHandler = { handle: () => of({ ok: true }) };

    interceptor.intercept(ctx, next).subscribe({
      complete: () => {
        expect(logSpy).toHaveBeenCalledTimes(1);
        const msg = String(logSpy.mock.calls[0][0]);
        expect(msg).toContain('GET');
        expect(msg).toContain('/x');
        expect(msg).toContain('200');
        expect(msg).toContain('ms');
        expect(msg).toContain('requestId=rid-1');
        done();
      },
    });
  });

  it('falls back to requestId=unknown when not on request', (done) => {
    const ctx = makeContext({ method: 'GET', url: '/x' }, { statusCode: 200 });
    const next: CallHandler = { handle: () => of('ok') };
    interceptor.intercept(ctx, next).subscribe({
      complete: () => {
        expect(String(logSpy.mock.calls[0][0])).toContain('requestId=unknown');
        done();
      },
    });
  });

  it('logs at warn level with status when downstream throws an HttpException-like error', (done) => {
    const ctx = makeContext(
      { method: 'POST', url: '/y', requestId: 'rid-2' },
      { statusCode: 200 },
    );
    const next: CallHandler = {
      handle: () => throwError(() => ({ status: 422, message: 'fail' })),
    };
    interceptor.intercept(ctx, next).subscribe({
      error: () => {
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const msg = String(warnSpy.mock.calls[0][0]);
        expect(msg).toContain('POST');
        expect(msg).toContain('/y');
        expect(msg).toContain('422');
        expect(msg).toContain('requestId=rid-2');
        done();
      },
    });
  });

  it('logs at warn level with ERR when error has no status', (done) => {
    const ctx = makeContext({ method: 'GET', url: '/z' }, { statusCode: 200 });
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };
    interceptor.intercept(ctx, next).subscribe({
      error: () => {
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toContain('ERR');
        done();
      },
    });
  });
});
