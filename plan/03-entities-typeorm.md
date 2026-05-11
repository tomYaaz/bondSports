## 3. The entities (TypeORM)

### Money transformer (required)

**Important correction:** Postgres `decimal/numeric` values are returned as **strings**. Converting them with `parseFloat()` (or treating them as JS `number`) reintroduces floating-point rounding/precision risk. For a banking-style submission, do **not** use JS `number` for money in domain logic.

Plan decision: keep DB money columns as `decimal(21,6)`, but keep money as **string** at the entity/DTO boundary and use a decimal library (e.g. `decimal.js`) in services for arithmetic/comparisons.

Create this once (note: it never touches floats):

typescript
// src/common/transformers/money.transformer.ts
export const moneyTransformer = {
  to: (value: string) => value,
  from: (value: string) => value,
};

Then apply it to every money column in both entities:

typescript// account.entity.ts
@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  accountId: string;

  @Column('uuid')
  personId: string;

  @Column({ type: 'decimal', precision: 21, scale: 6, default: 0, transformer: moneyTransformer })
  balance: string;

  @Column({ type: 'decimal', precision: 21, scale: 6, transformer: moneyTransformer })
  dailyWithdrawalLimit: string;

  @Column({ default: true })
  activeFlag: boolean;

  @Column({ type: 'int' })
  accountType: 1 | 2;  // 1=Checking, 2=Savings

  @CreateDateColumn()
  createDate: Date;

  @OneToMany(() => Transaction, t => t.account)
  transactions: Transaction[];
}

// transaction.entity.ts
export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  transactionId: string;

  @ManyToOne(() => Account, a => a.transactions)
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column('uuid')
  accountId: string;

  @Column({ type: 'decimal', precision: 21, scale: 6, transformer: moneyTransformer })
  value: string;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  // Idempotency for deposit/withdraw replays (see plan/04-critical-endpoints.md)
  // Nullable because GET/statement transactions don't require it; required for deposit/withdraw endpoints.
  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey?: string | null;

  @CreateDateColumn()
  transactionDate: Date;
}

Service-layer rule: convert `string` → `Decimal` at the boundary and do all comparisons/math in `Decimal`, never `number`.

Key decisions here: `decimal(21,6)` for money — never float (floating-point rounding errors) and allows up to **6 decimal places**. uuid as primary keys — better for distributed systems and avoids leaking row counts. @CreateDateColumn() is immutable by design.

### Constraints + indexes (small additions, big signal)
- Add check constraints (via migration):
  - `balance >= 0`
  - `dailyWithdrawalLimit >= 0`
  - `value > 0`
- Add indexes (via migration):
  - `transactions(accountId, transactionDate)` for statements and daily-sum queries
  - optionally `transactions(accountId, type, transactionDate)` if you want to speed up the daily withdrawal SUM further
  - **idempotency**: unique index on `(accountId, type, idempotencyKey)` **where `idempotencyKey is not null`**

Migration sketch for idempotency (Postgres):

sql
ALTER TABLE transactions ADD COLUMN "idempotencyKey" varchar(128);
CREATE UNIQUE INDEX "uq_transactions_idempotency"
  ON transactions ("accountId", "type", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

