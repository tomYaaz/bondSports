## 4. The critical endpoints

POST   /accounts                    → create account
GET    /accounts/:id                → get account by id
PATCH  /accounts/:id/block          → deactivate account
PATCH  /accounts/:id/unblock        → reactivate account
POST   /accounts/:id/deposit        → deposit
POST   /accounts/:id/withdraw       → withdrawal
GET    /accounts/:id/statement      → get transactions (filtered by period)

### Consistent success response shapes (explicit)
To avoid ambiguity for evaluators and clients, standardize these “happy path” shapes:
- **Create account** returns the created `Account` (including `balance`, `activeFlag`)
- **Deposit/withdraw** return `{ transaction, balance }` (transaction record + post-commit balance snapshot)
- **Statement** returns `{ items, nextCursor }` (paginated)

### Endpoint semantics (status codes evaluators expect)

Protected routes (everything except `@Public()` e.g. `/api/docs`, `/health`): **401** if JWT is missing or invalid.

- **POST `/accounts`**
  - **Policy:** A single authenticated user (`personId` from the JWT) may create **any number** of accounts. There is **no** cap of one account per person, and **no** cap of one account per type: the same user may hold **multiple CHECKING and/or multiple SAVINGS** accounts. Each account is a distinct row with its own `accountId`, balance, and statement.
  - **201** created (returns account)
  - **400** validation error
  - **401** not authenticated
- **GET `/accounts/:id`**
  - **200** returns account
  - **401** not authenticated
  - **404** not found
- **PATCH `/accounts/:id/block`**, **PATCH `/accounts/:id/unblock`**
  - **200** returns updated account
  - **401** not authenticated
  - **403** JWT valid but caller lacks `admin` role (`RolesGuard`; see `plan/15-security-auth-ownership.md`)
  - **404** account not found
- **POST `/accounts/:id/deposit`**
  - **200** returns `{ transaction, balance }`
  - **400** invalid payload
  - **401** not authenticated
  - **403** blocked account
  - **404** not found
  - **409** idempotency key reused with different body
- **POST `/accounts/:id/withdraw`**
  - **200** returns `{ transaction, balance }`
  - **400** invalid payload
  - **401** not authenticated
  - **403** blocked account
  - **404** not found
  - **409** idempotency key reused with different body
  - **422** insufficient funds / daily limit exceeded
- **GET `/accounts/:id/statement`**
  - **200** returns `{ items: Transaction[], nextCursor?: string }` (empty array if none)
  - **400** invalid date range
  - **401** not authenticated
  - **404** not found

### Account creation rules (pin down the DTO)
Define the `POST /accounts` payload clearly (and validate it):
- **personId**: **not accepted in the request body**. Always use `req.user.personId` from JWT.
- **accountType**: required enum (`CHECKING` | `SAVINGS`), reject unknown values.
- **dailyWithdrawalLimit**: optional; default to a safe value (e.g. `0` or `500.000000`). Must be \(\ge 0\) and max-bounded.
- **balance**: not settable by client on create; always starts at `0.000000` (all funding happens via deposit).

### Deposit rigor
Deposit must be atomic and blocked by `activeFlag` exactly like withdraw. The full spec is in `plan/16-deposit-flow.md` (transaction + invariants + max/precision rules).

### Idempotency / duplicate requests (explicit stance)
Duplicate submit happens in real payment systems (retries/timeouts).

Plan decision: implement minimal idempotency for `deposit` and `withdraw`:
- Accept `Idempotency-Key` header (**required** for these endpoints in this submission; 400 if missing)
- Store it on `transactions` and enforce uniqueness with a DB constraint on `(accountId, type, idempotencyKey)`
- On replay: return the previously-created `{ transaction, balance }` without creating a second transaction row
- On conflict (same key, different payload): return **409 Conflict** (do not mutate state)

Statement “quality” note (intentional scope):
- We return raw transaction items + pagination. Optional statement summaries (opening/closing balance, totals) ; they can be added later as `{ summary }`.

### Statement pagination + index-friendly query shape
The statement filter is explicitly called out in evaluation criteria. Implement `GET /accounts/:id/statement` with:
- **Filters**: `from` / `to` are **date-only** (UTC), interpreted as \([fromStartUTC, toStartUTC + 1 day)\)
- **Pagination**: cursor-based (`cursor` is last seen `(transactionDate, transactionId)`), `limit` default 50, max 200
- **Ordering**: default `DESC` with stable tie-breaker on `transactionId`

Your endpoint must accept `?from=2024-01-01&to=2024-01-31` query params. Implement it with TypeORM QueryBuilder:

typescript// statement-filter.dto.ts
export class StatementFilterDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  // Base64-encoded cursor for (transactionDate, transactionId)
  @IsOptional()
  cursor?: string;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC' = 'DESC';
}

// In TransactionsService:
async getStatement(accountId: string, filter: StatementFilterDto) {
  // validate range makes sense
  if (filter.from && filter.to && new Date(filter.from) > new Date(filter.to)) {
    throw new BadRequestException('"from" must be earlier than "to"');
  }

  const account = await this.accountRepo.findOne({ where: { accountId } });
  if (!account) throw new NotFoundException('Account not found');

  const qb = this.transactionRepo
    .createQueryBuilder('t')
    .where('t.accountId = :accountId', { accountId });

  // Convert date-only bounds to UTC timestamp range to keep indexes usable.
  if (filter.from) {
    const fromStartUTC = new Date(`${filter.from}T00:00:00.000Z`);
    qb.andWhere('t.transactionDate >= :fromStartUTC', { fromStartUTC });
  }
  if (filter.to) {
    const toStartUTC = new Date(`${filter.to}T00:00:00.000Z`);
    const toNextDayUTC = new Date(toStartUTC.getTime() + 24 * 60 * 60 * 1000);
    qb.andWhere('t.transactionDate < :toNextDayUTC', { toNextDayUTC });
  }

  // Cursor pagination: stable ordering by (transactionDate, transactionId).
  // Cursor is Base64(JSON.stringify({ d: ISOString, id: uuid })).
  // Apply tuple filter depending on order:
  // - DESC: (t.transactionDate, t.transactionId) < (:d, :id)
  // - ASC:  (t.transactionDate, t.transactionId) > (:d, :id)
  qb.orderBy('t.transactionDate', filter.order ?? 'DESC')
    .addOrderBy('t.transactionId', filter.order ?? 'DESC')
    .take(filter.limit ?? 50);

  // Concrete Postgres + TypeORM expression for the tuple cursor filter:
  if (filter.cursor) {
    const { d, id } = decodeCursor(filter.cursor); // d is ISO string
    const op = (filter.order ?? 'DESC') === 'DESC' ? '<' : '>';
    qb.andWhere(`(t.transactionDate, t.transactionId) ${op} (:d, :id)`, {
      d: new Date(d),
      id,
    });
  }

  const items = await qb.getMany();
  const nextCursor = items.length
    ? encodeCursor(items[items.length - 1].transactionDate, items[items.length - 1].transactionId)
    : undefined;

  return { items, nextCursor };
}

