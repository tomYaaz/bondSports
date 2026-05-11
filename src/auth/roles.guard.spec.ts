import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

type UserShape = { personId: string; roles?: string[] } | undefined;

function makeContext(user: UserShape): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function makeReflector(required: string[] | undefined): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('allows when no @Roles metadata is present', () => {
    const guard = new RolesGuard(makeReflector(undefined));
    expect(
      guard.canActivate(makeContext({ personId: 'p', roles: [] })),
    ).toBe(true);
  });

  it('allows when metadata is an empty array', () => {
    const guard = new RolesGuard(makeReflector([]));
    expect(guard.canActivate(makeContext({ personId: 'p' }))).toBe(true);
  });

  it('allows when user has at least one of the required roles', () => {
    const guard = new RolesGuard(makeReflector(['admin']));
    expect(
      guard.canActivate(
        makeContext({ personId: 'p', roles: ['user', 'admin'] }),
      ),
    ).toBe(true);
  });

  it('forbids when user has none of the required roles', () => {
    const guard = new RolesGuard(makeReflector(['admin']));
    expect(() =>
      guard.canActivate(makeContext({ personId: 'p', roles: ['user'] })),
    ).toThrow(ForbiddenException);
  });

  it('forbids when user is missing entirely', () => {
    const guard = new RolesGuard(makeReflector(['admin']));
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
