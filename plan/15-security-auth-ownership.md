## Security delta — auth + ownership enforcement (required)

### What the spec implies

Because `Account` has a `personId`, the system implicitly assumes:

- a person should only see their own accounts
- a person should only transact on their own accounts
- **Admins** (JWT `roles` includes `admin`) may **block/unblock any account** via dedicated endpoints

### What to build (honest scope)

Do **not** implement full registration/login. Build the **guard layer** and document that it expects a JWT issued by an external identity provider.

For evaluator usability, also document:
- how to generate a **test JWT locally**
- how Swagger is configured for **Bearer auth**
- how `/api/docs` and `/health` bypass a global guard (`@Public()`)

### Dependencies

bash
npm install @nestjs/passport @nestjs/jwt passport passport-jwt
npm install -D @types/passport-jwt

Money arithmetic dependency (because we treat money as strings):

bash
npm install decimal.js

### Auth module + JWT strategy

typescript
// src/auth/auth.module.ts
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: '1h' },
      }),
    }),
    PassportModule,
  ],
  providers: [JwtStrategy, RolesGuard],
  exports: [JwtModule, RolesGuard],
})
export class AuthModule {}

typescript
// src/auth/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  // Payload: `personId` required for all authenticated users; `roles` optional string[] (e.g. `['admin']`).
  // Customer tokens: `{ personId }`. Admin tokens for block/unblock tests: `{ personId, roles: ['admin'] }`.
  async validate(payload: { personId: string; roles?: string[] }) {
    return {
      personId: payload.personId,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    };
  }
}

### Guard

typescript
// src/auth/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

Apply it globally so every route is protected by default (DI-friendly):

typescript
// app.module.ts (or AuthModule if imported globally)
import { APP_GUARD } from '@nestjs/core';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}

Why this pattern? Nest creates the guard via DI, so it can receive injected dependencies
(e.g. Reflector for @Public/@Roles) and can be overridden cleanly in tests.

### Public routes (@Public) to keep docs usable
If you apply `JwtAuthGuard` globally, it will also block `/api/docs` unless you add a bypass.

Plan:
- Add `@Public()` decorator:

typescript
// src/auth/public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

- Update `JwtAuthGuard` to skip auth when `@Public()` is present:

typescript
constructor(private readonly reflector: Reflector) { super(); }
canActivate(ctx: ExecutionContext) {
  const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
    ctx.getHandler(),
    ctx.getClass(),
  ]);
  if (isPublic) return true;
  return super.canActivate(ctx);
}

- Mark Swagger/health endpoints as public (controller-level is fine).

### `CurrentUser` decorator

typescript
// src/auth/current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user; // set by JwtStrategy.validate()
  },
);

### Ownership check (critical)

A JWT only proves the caller is authenticated. You must also enforce that the caller **owns** the account they are accessing.

Do this in the service layer and pass `requestingPersonId` from controllers.

typescript
// src/accounts/accounts.service.ts
async findOne(accountId: string, requestingPersonId: string) {
  const account = await this.accountRepo.findOne({ where: { accountId } });
  // Enumeration-safe policy: do not reveal whether an account exists to non-owners.
  if (!account || account.personId !== requestingPersonId) {
    throw new NotFoundException('Account not found');
  }
  return account;
}

Then in controllers:

typescript
// accounts.controller.ts
@Get(':id')
findOne(
  @Param('id') id: string,
  @CurrentUser() user: { personId: string },
) {
  return this.accountsService.findOne(id, user.personId);
}

Apply the same pattern to every **customer** account-scoped endpoint: `deposit`, `withdraw`, `statement`, `GET /accounts/:id`, `POST /accounts`. **Do not** use owner checks for `block`/`unblock` — those routes use `@Roles('admin')` + `RolesGuard` instead (see below).

### Roles + RoleGuard (admin-only block/unblock)

typescript
// src/auth/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

typescript
// src/auth/roles.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest() as { user?: { roles?: string[] } };
    const roles = user?.roles ?? [];
    const ok = required.some((r) => roles.includes(r));
    if (!ok) throw new ForbiddenException('Admin role required');
    return true;
  }
}

Wire `RolesGuard` on `PATCH .../block` and `PATCH .../unblock` only (method-level `@UseGuards(RolesGuard)` or controller subsection). `JwtAuthGuard` still runs first (global); then `RolesGuard` checks `roles`.

### Create-account ownership policy (pin down the decision)
Evaluators will look for this explicitly.

Assessment policy:
- `POST /accounts` always creates an account for the **caller’s own** `personId`
- Implementation: **do not accept `personId` in the request body**; always use `req.user.personId`

Rationale: the spec provides `personId` but no “admin/teller” role model. Owner-only keeps the rules consistent and testable.

### Preventing information leaks (document the choice)
To avoid account enumeration:
- **Chosen policy**: return **404** for “not found or not owned” on all account-scoped endpoints.

This makes endpoint behavior consistent and avoids leaking whether an accountId exists.

### Minimal hardening notes (brief but shows awareness)
- **Rate limiting**: add `@nestjs/throttler` with a coarse global policy (e.g. 60 req/min) and stricter limits for `deposit/withdraw`.
- **Correlation id**: accept `X-Request-Id` (or generate one) and include it in logs + error responses for traceability.
- **Logging**: log route, status, duration, and correlation id; never log JWTs or full request bodies containing sensitive values.

