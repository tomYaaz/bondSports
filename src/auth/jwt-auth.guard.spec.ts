import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(path: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ path }),
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function reflectorReturning(isPublic: boolean): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
}

describe('JwtAuthGuard', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
  });

  it('allows documented Swagger paths without a JWT', () => {
    const guard = new JwtAuthGuard(reflectorReturning(false));
    expect(guard.canActivate(makeContext('/api/docs'))).toBe(true);
    expect(guard.canActivate(makeContext('/api/docs-json'))).toBe(true);
    expect(guard.canActivate(makeContext('/api/docs/swagger-ui.css'))).toBe(
      true,
    );
    expect(guard.canActivate(makeContext('/api/docs-other'))).toBe(true);
  });

  it('skips JWT for @Public() routes (reflector returns true)', () => {
    const guard = new JwtAuthGuard(reflectorReturning(true));
    expect(guard.canActivate(makeContext('/health'))).toBe(true);
  });

  it('delegates to passport for protected routes (super.canActivate called)', () => {
    const guard = new JwtAuthGuard(reflectorReturning(false));
    const spy = jest
      .spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(guard)) as {
          canActivate: (ctx: ExecutionContext) => boolean;
        },
        'canActivate',
      )
      .mockReturnValue(true);
    const result = guard.canActivate(makeContext('/accounts'));
    expect(spy).toHaveBeenCalled();
    expect(result).toBe(true);
    spy.mockRestore();
  });
});
