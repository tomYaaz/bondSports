## 8. API documentation

Use @nestjs/swagger. In main.ts:

typescriptconst config = new DocumentBuilder()
  .setTitle('Account Management API')
  .setDescription('Banking transactions API')
  .setVersion('1.0')
  // Make Swagger usable for evaluators:
  .addBearerAuth(
    { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'Authorization', in: 'header' },
    'bearer',
  )
  .build();
const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api/docs', app, document);

Decorate DTOs and controllers with @ApiProperty(), @ApiOperation(), @ApiResponse(). For JWT-protected handlers, include **401** (e.g. `@ApiUnauthorizedResponse()` or `@ApiResponse({ status: 401 })`) so the contract matches `plan/04-critical-endpoints.md`. For **`PATCH .../block`** and **`PATCH .../unblock`**, document **403** when the bearer is not an admin (`@ApiForbiddenResponse()` or `@ApiResponse({ status: 403 })`) — matches `RolesGuard` in `plan/15-security-auth-ownership.md`. This gives you a live UI at /api/docs which doubles as your documentation — zero extra work.

### Ensure docs/health are reachable with a global auth guard
If auth is applied globally (APP_GUARD), you need a `@Public()` escape hatch so `/api/docs` (and optionally `/health`) can be accessed without a token.

Plan:
- Add `@Public()` decorator that sets metadata on a handler/class.
- In `JwtAuthGuard`, return `true` if `@Public()` is set via `Reflector`.
- Mark Swagger + health routes/controllers as public.

### Keep Swagger request examples aligned with auth semantics
Create-account is **owner-derived**:
- `CreateAccountDto` should **not** include `personId`
- controllers should set `personId = req.user.personId`
- Swagger examples for `POST /accounts` should reflect that (only `accountType`, optional `dailyWithdrawalLimit`)

