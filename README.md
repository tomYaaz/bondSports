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
10. **Multiple accounts per user:** `POST /accounts` does not enforce uniqueness by `personId` or by account type. The same person may open **multiple CHECKING and/or multiple SAVINGS** accounts; each has its own `accountId`, balance, limits, and transactions.
11. **Currency:** The `Transaction` entity has **no `currency` field** (and deposit/withdraw payloads do not accept one). Amounts are numeric strings only. We assume **one implicit currency** per deployment (no FX, no multi-currency accounts). A production system should persist currency on each ledger row (and typically on the account). For this submission, treat all amounts as that single currency (documentation uses **$** informally).
12. **Abuse and network edge:** This service does **not** implement IP blocklists, geo blocking, DDoS mitigation, or application-level rate limiting. Those concerns belong at the **infrastructure or third-party edge** (e.g. API gateway, reverse proxy limits, WAF, CDN, cloud firewall). The API relies on **JWT** for protected routes and **validation** for payloads; observability uses **request-scoped logging** only.

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

The HTTP server uses **`PORT` from the environment** when set (see `src/main.ts`). If that port is **already in use**, it falls back to the **first free port in the range 3000–3009**. If **`PORT` is unset**, it only scans **3000–3009**. With the bundled compose file, Postgres is exposed on the host at **`DB_PORT=5433`**.

## One-minute demo (curl)

Replace `TOKEN`, `ACCOUNT_ID`, and idempotency keys as needed.

**Create a Customer JWT** (must match `JWT_SECRET` in `.env`):

```bash
export TOKEN="$(node -e "console.log(require('jsonwebtoken').sign({ personId: '00000000-0000-0000-0000-000000000001' }, process.env.JWT_SECRET || 'change_me_in_production', { expiresIn: '1h' }))")"
```

**Create an Admin JWT** (must match `JWT_SECRET` in `.env`):
```bash
export TOKEN="$(node -e "console.log(require('jsonwebtoken').sign({ personId: '00000000-0000-0000-0000-000000000001', roles: ['admin'] }, process.env.JWT_SECRET || 'change_me_in_production', { expiresIn: '1h' }))")"
```

(Optional) Print token and paste it in browser to try Swagger endpoints:
``` bash
echo $TOKEN
```

Create an account (dailyWithdrawal limit of 1000$):

```bash
export ACCOUNT_ID="$(curl -sS -X POST http://localhost:3000/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountType":"CHECKING","dailyWithdrawalLimit":"1000.000000"}' | jq -r '.accountId')"
```

(Optional): See ACCOUNT_ID
``` bash
echo $ACCOUNT_ID
```

Deposit 100$ (Idempotency key is unique and cannot be reused)
```bash
curl -sS -X POST "http://localhost:3000/accounts/$ACCOUNT_ID/deposit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: demo-deposit-1" \
  -H "Content-Type: application/json" \
  -d '{"value":"100.000000"}'
```

Withdraw 10$
```bash
curl -sS -X POST "http://localhost:3000/accounts/$ACCOUNT_ID/withdraw" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: demo-withdraw-1" \
  -H "Content-Type: application/json" \
  -d '{"value":"10.000000"}'
```

**Statement** (`GET /accounts/:id/statement`): optional query params include **`from`** / **`to`** (UTC date-only range), **`type`** (`DEPOSIT` or `WITHDRAWAL`), **`minValue`** / **`maxValue`** (inclusive amount bounds, same decimal string rules as deposits), **`order`** (`ASC` / `DESC`, default newest first), **`limit`** (default 50, max 200), and **`cursor`** for the next page. The JSON body is **`{ items, hasNextPage, nextCursor? }`** — use **`hasNextPage`** (and **`nextCursor`**) to tell whether another request is needed; keep the **same** `from`, `to`, and filters when following **`cursor`**.

Statement for May 2026 (adjust the range if your demo txs fall outside it), up to 50 rows:

```bash
curl -sS "http://localhost:3000/accounts/$ACCOUNT_ID/statement?from=2026-05-01&to=2026-05-31&limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

Example with **type** and **amount** filters:

```bash
curl -sS "http://localhost:3000/accounts/$ACCOUNT_ID/statement?from=2026-05-01&to=2026-05-31&type=DEPOSIT&minValue=10.000000&maxValue=100.000000" \
  -H "Authorization: Bearer $TOKEN"
```

**Pagination:** use a small **`limit`** to force multiple pages; read **`nextCursor`** from the previous response and send it as **`cursor`**. Use the **same** `from`, `to`, **`limit`**, and filters on every page. Example (**`limit=2`**, same May range as above):

```bash
NEXT_PAGE="$(curl -sS "http://localhost:3000/accounts/$ACCOUNT_ID/statement?from=2026-05-01&to=2026-05-31&limit=2" \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.nextCursor')"
```

```bash
curl -sS "http://localhost:3000/accounts/$ACCOUNT_ID/statement?from=2026-01-01&to=2026-01-31&limit=2&cursor=$NEXT_PAGE" \
  -H "Authorization: Bearer $TOKEN"
```

If **`NEXT_PAGE`** is empty or the literal string **`null`**, there is no next page (`jq -r '.nextCursor'` when omitted).

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
