# Chronological implementation order

Follow these steps in order. Each step should leave the app in a runnable or testable state. Cross-check `plan/14-submission-checklist.md` before you consider the work done.

**You:** after the final verification step, commit and push to your public GitHub repository manually (submission link).

---

## 1 — Repository and quality baseline ✅ **Complete**

- Initialize the NestJS app (TypeScript) and match module layout to `plan/02-project-structure.md`.
- Add ESLint + Prettier (`plan/14-submission-checklist.md`).
- Add Jest with **two projects** (`unit` vs `e2e`) and scripts: `test`, `test:e2e` with `--runInBand`, optional `test:cov` (`plan/07-testing-strategy.md`).

**Checkpoint:** `npm run lint` and `npm test` run (even if tests are empty).

---

## 2 — Configuration and database wiring ✅ **Complete**

- Add `@nestjs/config`, root `.env.example` with all variables from `plan/10-database-config-and-env.md` (including `JWT_SECRET`, and any max-deposit env from `plan/16-deposit-flow.md`).
- Implement `database.config.ts` with **`synchronize: false`** only (`plan/10-database-config-and-env.md`).
- Add standalone `src/config/data-source.ts` for the TypeORM CLI (`plan/11-migrations-setup.md`).
- Add `package.json` scripts: `migration:generate`, `migration:run`, `migration:revert` (`plan/11-migrations-setup.md`).

**Checkpoint:** App boots against Postgres when env is set (DB can be empty).

---

## 3 — Docker ✅ **Complete**

- Add `docker-compose.yml` per `plan/12-docker-compose.md` (db healthcheck, api `depends_on` with `service_healthy`).

**Checkpoint:** `docker compose up` brings up db (and api if you use the full compose stack).

---

## 4 — Entities and first migration ✅ **Complete**

- Implement `money.transformer` and **Account** + **Transaction** entities exactly as in `plan/03-entities-typeorm.md` (money columns string-boundary, idempotency column nullable).
- Author the **initial migration** with FK, check constraints, and indexes from `plan/11-migrations-setup.md`.

**Checkpoint:** `migration:run` on a clean DB creates schema; no `synchronize: true` anywhere.

---

## 5 — Global HTTP behavior ✅ **Complete**

- Register global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`) and `HttpExceptionFilter` (`plan/06-error-handling.md`).
- Add request correlation id + include it in errors and logs (`plan/17-resilience-operability.md`, `plan/06-error-handling.md`).
- Add `GET /health` with DB ping, marked `@Public()` (`plan/17-resilience-operability.md`).

**Checkpoint:** Invalid DTOs return 400 with consistent error JSON; `/health` works without JWT.

---

## 6 — Auth layer (before account routes) ✅ **Complete**

- Implement JWT strategy, `JwtAuthGuard` as **APP_GUARD**, `@Public()`, `@Roles()` + `RolesGuard`, and `CurrentUser` decorator (`plan/15-security-auth-ownership.md`).
- Export helpers needed by account/transaction services for **ownership** (enumeration-safe **404**).

**Checkpoint:** A protected dummy route returns 401 without Bearer token; `@Public` routes still work.

---

## 7 — Accounts module ✅ **Complete**

- `POST /accounts` (personId from JWT only; initial balance zero), `GET /accounts/:id` with ownership check (`plan/04-critical-endpoints.md`, `plan/15-security-auth-ownership.md`).
- `PATCH /accounts/:id/block` and `PATCH /accounts/:id/unblock`, **admin-only** (`plan/13-active-flag-block-unblock.md`, `plan/15-security-auth-ownership.md`).

**Unit tests:** `AccountsService` (or equivalent) for rules you can isolate without HTTP (e.g. `setActive` not-found, admin vs customer is better covered in e2e).

**Checkpoint:** Create and fetch own account; non-owner gets 404 on get; customer gets 403 on block/unblock.

---

## 8 — Transactions: deposit and withdraw ✅ **Complete**

- DTOs: string money, positive value, precision rules (`plan/01-questions-and-answers.md`, `plan/16-deposit-flow.md`).
- **Deposit** and **withdraw** inside `DataSource.transaction()`, pessimistic lock on account, SQL numeric balance update, idempotency per `plan/04-critical-endpoints.md`, `plan/05-withdrawal-flow.md`, `plan/16-deposit-flow.md`.
- Require `Idempotency-Key` on deposit/withdraw; enforce DB uniqueness (`plan/11-migrations-setup.md`).
- Optional: bounded retry on retryable Postgres errors (`plan/17-resilience-operability.md`).

**Unit tests:** mock repositories / `DataSource.transaction` and cover insufficient funds, daily limit exceeded, blocked account, happy paths, idempotency replay vs conflict (`plan/07-testing-strategy.md`).

**Checkpoint:** Manual curl or minimal e2e: fund account, withdraw, hit limits.

---

## 9 — Statement endpoint ✅ **Complete**

- Implement `GET /accounts/:id/statement` with UTC date-only bounds, cursor pagination, stable ordering (`plan/04-critical-endpoints.md`).
- Enforce ownership the same way as other account-scoped routes.

**Unit tests:** optional for query-builder; otherwise rely on e2e next step.

**Checkpoint:** Statement returns `{ items, nextCursor }` and respects `from`/`to`.

---

## 10 — Swagger ✅ **Complete**

- Wire `@nestjs/swagger` with Bearer auth; document success and error statuses to match `plan/08-api-documentation.md` and `plan/04-critical-endpoints.md`.
- Ensure `/api/docs` stays `@Public()`.

**Checkpoint:** You can authorize in Swagger UI and call endpoints.

---

## 11 — Integration / e2e tests (full suite) ✅ **Complete**

- Add `test/helpers` for seed + JWT (`plan/07-testing-strategy.md`).
- E2E lifecycle: create → deposit → withdraw → statement → block → deposit/withdraw 403.
- Add concurrency / daily-limit, ownership 404, admin block/unblock, idempotency, UTC boundary cases listed in `plan/07-testing-strategy.md`.

**Checkpoint:** `npm run test:e2e` passes locally (Testcontainers or compose test DB per `plan/07-testing-strategy.md`).

---

## 12 — README and reviewer ergonomics ✅ **Complete**

- Fill README per `plan/09-readme-structure.md`: design decisions (≥6), ASCII architecture, quick start, curl demo, **test JWT** snippet, note **decimal.js** (and any other non-obvious deps).

**Checkpoint:** A new machine can run migrations, start the app, and hit the API using only the README + `.env.example`.

---

## 13 — Final pass ✅ **Complete**

- Walk `plan/14-submission-checklist.md` line by line and tick every item.
- Re-read `plan/01-questions-and-answers.md` to ensure no silent behavior drift.
  - **Q1–Q5 verified in code/README:** balance updated only inside DB transactions with ledger insert; transaction `value` positive with type for sign; UTC day bucket on `transactionDate` with index-friendly range; `personId` UUID without Person FK; withdrawals use `DataSource.transaction` + account `SELECT … FOR UPDATE` under READ COMMITTED.

---

## 14 — Publish (manual)

- Create or use your **public** GitHub repository, push the final branch, and send the submission link per the assessment instructions.
