## Migration setup (required delta)

### `package.json` scripts

Add these scripts:

json
"scripts": {
  "migration:generate": "typeorm-ts-node-commonjs migration:generate src/migrations/migration -d src/config/data-source.ts",
  "migration:run": "typeorm-ts-node-commonjs migration:run -d src/config/data-source.ts",
  "migration:revert": "typeorm-ts-node-commonjs migration:revert -d src/config/data-source.ts"
}

### Standalone TypeORM CLI DataSource

You need a DataSource file for the CLI (separate from the NestJS module), otherwise `migration:generate` can’t reliably find entities.

typescript
// src/config/data-source.ts
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});

### Concrete schema guarantees (DB is source of truth)
In this assessment, service-layer checks are necessary but not sufficient; we also enforce key invariants at the DB layer via migrations.

This section is aligned with **`plan/05-withdrawal-flow.md`** (daily-limit SUM over `transactionDate` range + row locking does not change schema, but indexes support the query), **`plan/04-critical-endpoints.md`** (statement pagination + idempotency), and **`plan/01-questions-and-answers.md`** Q2–Q5 (`decimal(21,6)` money, UTC “day”, concurrency).

Plan for the initial migration (`accounts` + `transactions`):

- **Column types / timezone**
  - Money columns (`accounts.balance`, `accounts.dailyWithdrawalLimit`, `transactions.value`): `numeric(21,6)` (matches `plan/03-entities-typeorm.md` and Q2 in `plan/01-questions-and-answers.md`).
  - Use `timestamptz` for `createDate` and `transactionDate` so timestamps are stored with timezone semantics (treat everything as UTC in the app).
- **FK**
  - Add FK: `transactions.accountId -> accounts.accountId` (on delete: RESTRICT; we do not delete accounts in this API).
- **Check constraints**
  - `accounts.balance >= 0`
  - `accounts.dailyWithdrawalLimit >= 0`
  - `transactions.value > 0`
  - `accounts.accountType in (1, 2)` (or use a DB enum type)
- **Indexes (finalized to match query shapes)**
  - `transactions(accountId, transactionDate, transactionId)` for statement pagination (date + stable tie-break)
  - `transactions(accountId, type, transactionDate)` to speed up the daily withdrawal SUM range query
- **Idempotency (required for deposit/withdraw)**
  - Add nullable `transactions.idempotencyKey varchar(128)`
  - Add partial unique index: `(accountId, type, idempotencyKey) WHERE idempotencyKey IS NOT NULL`

Idempotency conflict rule (DB + API):
- If the same `(accountId, type, idempotencyKey)` is reused with a **different payload** (e.g. different `value`), return **409 Conflict** (do not mutate state).

SQL sketch (Postgres) for the migration pieces above:

sql
-- transactions.accountId FK
ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_account
  FOREIGN KEY ("accountId") REFERENCES accounts("accountId")
  ON DELETE RESTRICT;

-- checks
ALTER TABLE accounts ADD CONSTRAINT chk_accounts_balance_nonneg CHECK (balance >= 0);
ALTER TABLE accounts ADD CONSTRAINT chk_accounts_daily_limit_nonneg CHECK ("dailyWithdrawalLimit" >= 0);
ALTER TABLE accounts ADD CONSTRAINT chk_accounts_type CHECK ("accountType" IN (1,2));
ALTER TABLE transactions ADD CONSTRAINT chk_transactions_value_pos CHECK (value > 0);

-- indexes
CREATE INDEX idx_transactions_statement
  ON transactions ("accountId", "transactionDate", "transactionId");
CREATE INDEX idx_transactions_daily_withdraw_sum
  ON transactions ("accountId", "type", "transactionDate");

-- idempotency
ALTER TABLE transactions ADD COLUMN "idempotencyKey" varchar(128);
CREATE UNIQUE INDEX uq_transactions_idempotency
  ON transactions ("accountId", "type", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

