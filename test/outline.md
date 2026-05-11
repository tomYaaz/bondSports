# Test Outline

Recommended test matrix (names + intent only), grouped by file. Unit specs live next to source under `src/`; HTTP-level tests live under `test/`.

---

## `src/common/money-parse.spec.ts`

- **`parsePositiveMoneyString` rejects empty / non-string** — empty, whitespace-only, or non-string input yields a clear 400-style error.
- **`parsePositiveMoneyString` rejects invalid decimal shapes** — scientific notation, leading signs, letters, multiple dots.
- **`parsePositiveMoneyString` rejects more than six fractional digits** — boundary at six places allowed, seven rejected.
- **`parsePositiveMoneyString` rejects zero and negatives** — `0`, `0.0`, negative strings.
- **`parsePositiveMoneyString` accepts typical valid values** — integers, fixed six-decimal strings, trimming behavior.
- **`parseNonNegativeMoneyString` uses fallback when undefined** — omitted optional field resolves to the configured default string.
- **`parseNonNegativeMoneyString` rejects invalid shapes and negatives** — same shape rules as positive path but allows zero.
- **`decimalToMoneyString` formats to six places** — consistent scale for persisted API money strings.

---

## `src/common/utils/cursor.spec.ts`

- **`encodeCursor` / `decodeCursor` round-trip** — encoded payload decodes to the same logical date and id.
- **`decodeCursor` rejects invalid base64url** — malformed buffer throws the expected "invalid cursor" style error.
- **`decodeCursor` rejects non-object JSON** — array, primitive, null.
- **`decodeCursor` rejects object missing `d` or `id` or wrong types** — partial or wrong-type fields.

---

## `src/auth/ownership.spec.ts`

- **`assertAccountOwnedByOrNotFound` returns account when owner matches** — happy path.
- **`assertAccountOwnedByOrNotFound` throws when account is null** — maps to "not found" semantics.
- **`assertAccountOwnedByOrNotFound` throws when personId differs** — enumeration-safe 404 behavior.

---

## `src/auth/jwt.strategy.spec.ts`

- **`validate` maps `personId` from payload** — required claim surfaces on `user`.
- **`validate` normalizes `roles` to an array** — array payload preserved; non-array / missing becomes `[]`.

---

## `src/auth/roles.guard.spec.ts`

- **`canActivate` allows when no roles metadata** — handler/class without `@Roles` passes through.
- **`canActivate` allows when user has one of the required roles** — admin path with admin token shape.
- **`canActivate` forbids when roles missing or insufficient** — 403 with the expected message when `@Roles` is set and user lacks role.

---

## `src/auth/jwt-auth.guard.spec.ts`

- **`isSwaggerPublicPath` allows documented Swagger paths** — `/api/docs`, `/api/docs-json`, and prefixed variants used in code.
- **`canActivate` skips JWT for `@Public()` routes** — reflector returns true for public metadata (mocked context).
- **`canActivate` delegates to passport for protected routes** — non-public, non-swagger paths still require JWT (mock super).

---

## `src/common/filters/http-exception.filter.spec.ts`

- **`catch` maps `HttpException` to status and body shape** — `statusCode`, `error`, `message`, `timestamp`, `path`, `requestId`.
- **`catch` string vs object exception responses** — Nest responses where `getResponse()` is a string vs object with `message`.
- **`catch` uses `requestId` from request or falls back** — header-populated id vs `unknown`.
- **`catch` maps non-HTTP `Error` to 500** — generic `Error` produces internal error shape.
- **`catch` maps unknown throwables** — non-`Error` values still return a safe 500 body.
- **`httpNameForStatus` labels** — at least 400, 401, 403, 404, 409, 422, and default branch.

---

## `src/common/middleware/request-id.middleware.spec.ts`

- **`requestId` uses trimmed `x-request-id` when present** — header wins over generation.
- **`requestId` generates UUID when header absent or blank** — new id each time (or format assertion).
- **`requestId` uses first element when header is an array** — Express-style array header.

---

## `src/common/interceptors/logging.interceptor.spec.ts` (optional)

- **`intercept` logs success with method, url, status, duration, requestId** — `tap` next path with mocked logger.
- **`intercept` logs errors with status when present on err** — `tap` error path.

---

## `src/accounts/accounts.service.spec.ts`

- **`create` persists CHECKING vs SAVINGS mapping** — DTO enum maps to the expected numeric `accountType` in the entity passed to save (mock repo).
- **`create` applies default daily limit when omitted** — uses `500.000000` path.
- **`create` parses and stores custom non-negative daily limit** — formatted to six decimals via `decimalToMoneyString`.
- **`create` rejects daily limit above maximum** — `BadRequestException` when over coarse max bound.
- **`create` rejects invalid money string for daily limit** — delegates to `parseNonNegativeMoneyString` errors.
- **`findOneForOwner` returns account when owned** — loads by id and ownership helper succeeds.
- **`findOneForOwner` propagates not-found for wrong owner or missing** — same exception type as ownership helper.
- **`findOneByIdOrNotFound` throws when missing** — distinct from owner check.
- **`setActive` toggles flag and saves** — block vs unblock behavior at service layer.
- **`setActive` throws when account missing** — `NotFoundException`.

---

## `src/transactions/transactions.service.spec.ts`

Easiest with a test database or heavy TypeORM mocking; list reflects business rules in `transactions.service.ts`.

- **`deposit` not found when account id missing** — `NotFoundException`.
- **`deposit` not found when personId does not match** — masked as not found.
- **`deposit` forbidden when account blocked** — `ForbiddenException`.
- **`deposit` idempotent replay returns prior transaction and current balance** — same key + same body, no second row, balance unchanged from first apply.
- **`deposit` idempotent conflict when same key different amount** — `ConflictException`.
- **`deposit` rejects value above `MAX_DEPOSIT` env** — when env set below test value.
- **`deposit` updates balance and inserts transaction** — happy path numeric outcome (integration-style).
- **`withdraw` not found / wrong owner / blocked** — same matrix as deposit.
- **`withdraw` idempotent replay** — same as deposit for withdrawal type.
- **`withdraw` idempotent conflict** — same key, different body.
- **`withdraw` insufficient funds** — `UnprocessableEntityException` when balance lower than requested.
- **`withdraw` daily limit exceeded for single request** — sum of prior same-day withdrawals + new value over limit.
- **`withdraw` daily limit uses UTC midnight window** — query bounds match `startOfDayUTC` / `startOfNextDayUTC` logic (can pair with DB fixture dates).
- **`getStatement` owner check** — calls `findOneForOwner` first; wrong owner never leaks rows.
- **`getStatement` rejects when `from` after `to`** — `BadRequestException` message.
- **`getStatement` filters `from` inclusive at UTC day start** — boundary on `T00:00:00.000Z`.
- **`getStatement` filters `to` exclusive through next-day boundary** — `to` date-only semantics.
- **`getStatement` default order DESC and respects ASC** — ordering of `transactionDate` then `transactionId`.
- **`getStatement` caps limit at 200** — `take` uses `min(requested, 200)`.
- **`getStatement` cursor pagination DESC** — second page uses composite predicate correctly.
- **`getStatement` cursor pagination ASC** — inverted composite predicate.
- **`getStatement` omits `nextCursor` when no extra row** — last page behavior.

---

## `src/accounts/accounts.controller.spec.ts` (thin wiring)

- **`create` passes JWT `personId` and body DTO to service** — correct delegation.
- **`findOne` passes parsed UUID and user to service** — `ParseUUIDPipe` path.
- **`block` / `unblock` invoke service with id** — admin-only guards assumed applied at module level in e2e.

---

## `src/transactions/transactions.controller.spec.ts` (thin wiring)

- **`deposit` passes id, user, dto, idempotency key** — decorator-supplied key reaches service.
- **`withdraw` same** — wiring.
- **`statement` passes query DTO** — `StatementFilterDto` binding.

---

## `src/health/health.controller.spec.ts`

- **`getHealth` runs `SELECT 1` and returns `{ status: 'ok' }`** — mock `DataSource.query` resolves; optional failure-path test.

---

## `src/app.controller.spec.ts` (extend existing)

- **`getHello` returns configured string** — existing behavior.
- **`protectedPing` returns `{ ok: true }`** — auth smoke handler.

---

## `test/health.e2e-spec.ts`

- **`GET /health` without auth returns 200** — public route, body shape.
- **`GET /health` verifies DB readiness** — with real DB success path.

---

## `test/auth.e2e-spec.ts`

- **`GET /` without `Authorization` returns 401** — global JWT guard.
- **`GET /` with valid Bearer returns 200** — body is hello string.
- **`GET /protected/ping` without token returns 401** — second protected sample.
- **`GET /protected/ping` with valid token returns 200** — `{ ok: true }`.
- **Swagger/OpenAPI paths reachable without JWT** — `/api/docs` and `/api/docs-json` return non-401.

---

## `test/accounts.e2e-spec.ts`

- **`POST /accounts` without auth returns 401**.
- **`POST /accounts` with auth creates account and returns `accountId`** — 201, shape.
- **`POST /accounts` validation failures** — invalid `accountType`; malformed `dailyWithdrawalLimit` (regex); limit over global max if exposed.
- **`GET /accounts/:id` owner returns 200 with expected fields** — balance, limits, active flag, type.
- **`GET /accounts/:id` non-owner returns 404** — not 403.
- **`GET /accounts/:id` unknown id returns 404**.
- **`PATCH .../block` admin success; non-admin 403; unknown account 404**.
- **`PATCH .../unblock` same matrix**.
- **`POST /accounts` with `SAVINGS` persists and is visible on GET** — enum end-to-end.

---

## `test/transactions-deposit-withdraw.e2e-spec.ts`

- **`POST .../deposit` missing `Idempotency-Key` returns 400**.
- **`POST .../withdraw` missing key returns 400**.
- **`POST .../deposit` invalid money strings return 400** — `0`, too many decimals, non-numeric.
- **`POST .../withdraw` invalid money returns 400**.
- **`POST .../deposit` non-owner returns 404**.
- **`POST .../withdraw` non-owner returns 404**.
- **`POST .../withdraw` insufficient funds returns 422** — balance less than request.
- **`POST .../withdraw` daily limit exceeded returns 422** — deterministic single-thread case.
- **`POST .../deposit` exceeds `MAX_DEPOSIT` returns 400** — when test env sets a low cap.
- **Blocked account: deposit and withdraw both 403**.
- **`POST .../withdraw` idempotency replay matches deposit-style assertions** — same transaction id, balance not double-debited.
- **`POST .../withdraw` idempotency conflict 409** — same key, different amount.

---

## `test/statements.e2e-spec.ts`

- **`GET .../statement` non-owner 404**.
- **`GET .../statement` returns items in expected default order** — newest first when multiple txs exist.
- **`GET .../statement` date filters include/exclude boundaries** — txs on known UTC dates; assert visibility against `from`/`to`.
- **`GET .../statement` respects `limit` and returns `nextCursor` when more rows exist** — small limit with many txs.
- **`GET .../statement` second page using `cursor` matches total ordering** — no duplicates, no gaps.
- **`GET .../statement` rejects invalid `cursor` with 400** — garbage base64url.
- **`GET .../statement` rejects invalid `limit` / `order` via validation** — `limit=0`, `order=FOO` → 400.
- **`from` / `to` optional: full history when omitted** — sanity check.

---

## `test/validation-pipe.e2e-spec.ts`

- **`POST /_validation-smoke` with invalid body returns 400 with structured validation message** — proves global `ValidationPipe` + filter path.

---

## `test/logging-and-request-id.e2e-spec.ts` (optional)

- **Response JSON errors include stable `requestId` field** — matches `x-request-id` when sent, or a UUID when not.
