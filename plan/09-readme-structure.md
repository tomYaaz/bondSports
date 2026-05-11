## 9. README structure (evaluators read this first)

markdown
# Account Management API

## Design decisions
1. Balance is stored as a column, updated atomically with the transaction row
   inside a single DB transaction — never updated standalone.
2. `SELECT FOR UPDATE` is used during withdrawals to prevent race conditions
   on concurrent requests hitting the same account.
3. `personId` is a UUID column with no FK — the Person service is out of scope.
4. Daily withdrawal limit resets at UTC midnight. The check uses
   an index-friendly UTC range \([startOfDayUTC, startOfNextDayUTC)\).
5. Statement filters treat `from/to` as **date-only UTC** bounds, implemented
   as timestamp ranges (not `DATE(transactionDate)`), so indexes remain usable.
6. Blocking an account does not roll back committed transactions.
7. Monetary values are stored as `decimal(21,6)` to allow up to 6 decimal places.
8. Money values are treated as **strings** at API/entity boundaries and computed with `decimal.js` to avoid floating-point rounding.

9. **Block/unblock** require JWT with **`roles` including `admin`** (`RolesGuard`); admins may toggle any account. Customer tokens omit `roles` or use `roles: []` for normal API use.

## Architecture (request lifecycle)

HTTP Request
     │
     ▼
ValidationPipe ──► ExceptionFilter (global)
     │
     ▼
Controller (AccountsController / TransactionsController)
     │
     ▼
Service (AccountsService / TransactionsService)
     │          │
     │          └── daily limit check (SUM query)
     │
     ▼
DataSource.transaction()
     ├── SELECT ... FOR UPDATE  (account row lock)
     ├── UPDATE balance
     └── INSERT transaction
          │
          ▼
       PostgreSQL

## Quick start
cp .env.example .env
docker-compose up -d db
npm install
npm run migration:run
npm run start:dev

## One-minute demo (curl)

Replace `TOKEN`, `ACCOUNT_ID`, and idempotency keys as needed.

bash
export TOKEN="$(node -e "console.log(require('jsonwebtoken').sign({ personId: '00000000-0000-0000-0000-000000000001' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' }))")"

bash
curl -sS -X POST http://localhost:3000/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountType":"CHECKING","dailyWithdrawalLimit":"1000.000000"}'

Set `ACCOUNT_ID` from the JSON `accountId` in that response (e.g. `jq -r '.accountId'`).

bash
curl -sS -X POST "http://localhost:3000/accounts/$ACCOUNT_ID/deposit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: demo-deposit-1" \
  -H "Content-Type: application/json" \
  -d '{"value":"100.000000"}'

bash
curl -sS -X POST "http://localhost:3000/accounts/$ACCOUNT_ID/withdraw" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: demo-withdraw-1" \
  -H "Content-Type: application/json" \
  -d '{"value":"10.000000"}'

bash
curl -sS "http://localhost:3000/accounts/$ACCOUNT_ID/statement?from=2026-01-01&to=2026-01-31&limit=50" \
  -H "Authorization: Bearer $TOKEN"

## Full stack (app + db)
docker-compose up

## Tests
npm run test          # unit tests
npm run test:e2e      # integration tests (requires running db)
npm run test:cov      # unit tests with coverage report

## API docs
http://localhost:3000/api/docs

## Auth (for evaluators)
This project does not implement login; it expects a JWT whose payload includes **`personId`** and optionally **`roles`** (string array). Customer-style token: `{ personId }`. **Admin token** for `PATCH .../block|unblock`: `{ personId, roles: ['admin'] }`.

Generate a local **customer** JWT (matches `JWT_SECRET`):

bash
node -e "console.log(require('jsonwebtoken').sign({ personId: '00000000-0000-0000-0000-000000000001' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' }))"

Generate a local **admin** JWT (same secret; use for block/unblock only):

bash
node -e "console.log(require('jsonwebtoken').sign({ personId: '00000000-0000-0000-0000-000000000099', roles: ['admin'] }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' }))"

Use it:

bash
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/accounts/<accountId>


