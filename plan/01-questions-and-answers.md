## 1. The questions you must raise (and your answers for them)

These are gaps the spec leaves open. The best candidates notice and decide explicitly — they don't silently pick a behavior.

### Q1 — Where does balance live?

Two valid options: store it as a column (fast reads, risk of drift) or derive it from SUM(transactions) (always consistent, slower). Decision: store it as a column, but update it only inside a DB transaction alongside inserting the transaction row. You get speed and consistency. Document this in your README.

### Q2 — What does value mean in a transaction?

The spec says "Amount of the transaction" with a type of DEPOSIT or WITHDRAWAL. Decision: value is always positive. The type field carries the sign semantics. Reject negative values at the DTO layer.

Addendum: money values may have up to **6 decimal places** (not just cents). Enforce this at the DTO layer and store as `decimal(21,6)` in Postgres.

### Q3 — Daily withdrawal limit — when does it reset?

The spec says "Maximum amount that can be withdrawn per day" but doesn't define "day". Decision: calendar day in UTC, midnight reset. Document it. In code: sum withdrawals where `transactionDate` falls in the half-open UTC range \([startOfDayUTC, startOfNextDayUTC)\) — same rule as `plan/05-withdrawal-flow.md`. Avoid wrapping the column in `DATE(...)` so Postgres can use indexes on `transactionDate`. **DB support:** migrations add an index suited to that range+SUM query on `transactions` — see `plan/11-migrations-setup.md` (`idx_transactions_daily_withdraw_sum`).

### Q4 — Is personId a foreign key to a Person table?

No Person entity is defined. Decision: treat personId as a UUID column with no FK constraint (the person service is out of scope). Add a comment in the schema noting this. Don't create a dummy Person table — it signals you can scope a task.

### Q5 — Concurrency: two simultaneous withdrawals

This is the hardest implicit requirement. If you don't handle it, a user with $100 balance could withdraw $100 twice concurrently and end up at -$100. Decision: run the withdrawal inside `DataSource.transaction()` at Postgres default **READ COMMITTED**, lock the account row with **`SELECT ... FOR UPDATE`**, then debit balance and insert the transaction in the same DB transaction. That serializes concurrent withdrawals per account without needing SERIALIZABLE isolation (see `plan/05-withdrawal-flow.md`). **DB support:** check constraints on `balance` / `value` and FK `transactions.accountId → accounts.accountId` are defined in `plan/11-migrations-setup.md`; optional idempotency column + unique index match `plan/04-critical-endpoints.md`.

