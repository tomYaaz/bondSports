# Account Management API

NestJS service for accounts, deposits, withdrawals (with idempotency), statements, and admin block/unblock. PostgreSQL + TypeORM.

## Design decisions

1. Balance is stored on the account row and updated in the same database transaction as the ledger row insert — never updated on its own.
2. `SELECT … FOR UPDATE` (pessimistic write lock) is used on the account during deposit and withdrawal so concurrent requests on the same account serialize correctly.
3. `personId` is a UUID with no foreign key — the Person service is out of scope.
4. Daily withdrawal limit is enforced from the sum of withdrawals whose `transactionDate` falls in the UTC calendar day `[startOfDayUTC, startOfNextDayUTC)`.
5. Statement `from` / `to` are **date-only UTC** bounds implemented as timestamp ranges (not `DATE(transactionDate)`), so time-range indexes stay usable.
6. Blocking an account does not roll back committed transactions; blocked accounts reject new deposits and withdrawals with **403**.
7. Amounts are stored as `decimal(21,6)`; API and entities use **string** money at boundaries.
8. Arithmetic uses **`decimal.js`** so floating-point rounding does not affect balances or limits.
9. **Block / unblock** require a JWT whose payload includes **`roles: ['admin']`** (`RolesGuard`). Customer tokens omit `roles` or use `roles: []` for normal use.

## Architecture (request lifecycle)

```
HTTP Request
     │
     ▼
ValidationPipe ──► HttpExceptionFilter (global) + request id middleware
     │
     ▼
Controller (AccountsController / TransactionsController)
     │
     ▼
Service (AccountsService / TransactionsService)
     │          │
     │          └── daily limit: SUM(withdrawals) in UTC day window
     │
     ▼
DataSource.transaction()
     ├── SELECT account … FOR UPDATE
     ├── UPDATE balance
     └── INSERT transaction
          │
          ▼
       PostgreSQL
```

## Quick start

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run migration:run
npm run start:dev
```

The API listens on `PORT` from `.env` (default **3000**). With the bundled compose file, Postgres is exposed on the host at **`DB_PORT=5433`** so it does not clash with a local Postgres on 5432.

## One-minute demo (curl)

Replace `TOKEN`, `ACCOUNT_ID`, and idempotency keys as needed.

**Customer JWT** (must match `JWT_SECRET` in `.env`):

```bash
export TOKEN="$(node -e "console.log(require('jsonwebtoken').sign({ personId: '00000000-0000-0000-0000-000000000001' }, process.env.JWT_SECRET || 'change_me_in_production', { expiresIn: '1h' }))")"
```

Create an account:

```bash
curl -sS -X POST http://localhost:3000/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountType":"CHECKING","dailyWithdrawalLimit":"1000.000000"}'
```

Set `ACCOUNT_ID` from the JSON `accountId` (e.g. `jq -r '.accountId'`).

```bash
curl -sS -X POST "http://localhost:3000/accounts/$ACCOUNT_ID/deposit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: demo-deposit-1" \
  -H "Content-Type: application/json" \
  -d '{"value":"100.000000"}'

curl -sS -X POST "http://localhost:3000/accounts/$ACCOUNT_ID/withdraw" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: demo-withdraw-1" \
  -H "Content-Type: application/json" \
  -d '{"value":"10.000000"}'

curl -sS "http://localhost:3000/accounts/$ACCOUNT_ID/statement?from=2026-01-01&to=2026-01-31&limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

## Full stack (app + db)

```bash
docker compose up
```

## Tests

```bash
npm run test          # unit tests
npm run test:e2e      # e2e (needs Postgres reachable per .env, e.g. compose `db` up)
npm run test:cov      # unit tests with coverage
```

E2e runs **in band** (`--runInBand`) so DB-heavy cases do not interfere. Ensure migrations have been applied against the same database you point tests at.

CI (GitHub Actions on push/PR to `main` or `master`): `.github/workflows/ci.yml` runs `npm ci`, lint, unit tests, migrations, and e2e against a **Postgres 16** service job.

## API docs

Open **http://localhost:3000/api/docs** (Swagger UI). Paths under `/api/docs` are public so the UI can load without a JWT.

## Auth (for evaluators)

There is no login endpoint. Expect a JWT whose payload includes **`personId`** (UUID string) and optionally **`roles`** (string array).

| Use | Payload shape |
|-----|----------------|
| Customer | `{ "personId": "<uuid>" }` |
| Admin (block/unblock only) | `{ "personId": "<uuid>", "roles": ["admin"] }` |

Generate a **customer** JWT (same secret as `JWT_SECRET` in `.env`):

```bash
node -e "console.log(require('jsonwebtoken').sign({ personId: '00000000-0000-0000-0000-000000000001' }, process.env.JWT_SECRET || 'change_me_in_production', { expiresIn: '1h' }))"
```

Generate an **admin** JWT:

```bash
node -e "console.log(require('jsonwebtoken').sign({ personId: '00000000-0000-0000-0000-000000000099', roles: ['admin'] }, process.env.JWT_SECRET || 'change_me_in_production', { expiresIn: '1h' }))"
```

Example:

```bash
curl -sS -H "Authorization: Bearer <TOKEN>" http://localhost:3000/accounts/<ACCOUNT_ID>
```

## Lint and format

```bash
npm run lint
npm run format
```
