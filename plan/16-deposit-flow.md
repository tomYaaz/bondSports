## 16. The deposit flow — same rigor as withdraw

Deposits must be specified with the same “atomicity + invariants” rigor as withdrawals (`plan/05-withdrawal-flow.md`). Evaluators should see **both** flows at full depth: one DB transaction, row lock, numeric SQL balance update, transaction row with **idempotencyKey**, re-read balance.

This section mirrors withdrawal: blocked account, limits, idempotency replay vs **409**, and schema alignment (`plan/03-entities-typeorm.md`, `plan/11-migrations-setup.md`).

### Invariants (explicit)
- **Runs inside a DB transaction**: balance update + transaction insert are atomic.
- **Blocked by `activeFlag`**: a blocked account rejects deposits with **403**.
- **Value rules**:
  - must be **> 0**
  - must respect money precision rules (max 6 decimal places)
  - must not exceed a configured max deposit value (e.g. `MAX_DEPOSIT=1000000.000000`) to avoid abuse/overflow
- **DTO type**: `dto.value` is a **string** (not number). Validate: positive, max 6 decimals, max bound.
- **Idempotency (implemented)**: require `Idempotency-Key` header and enforce `(accountId, type, idempotencyKey)` uniqueness (see `plan/04-critical-endpoints.md`).
  - **Replay**: same key returns the original `{ transaction, balance }`
  - **Conflict**: same key with different `value` returns **409 Conflict**

### Implementation sketch (transaction + row lock)

typescriptasync deposit(
  accountId: string,
  dto: DepositDto,
  idempotencyKey: string,
): Promise<{ transaction: Transaction; balance: string }> {
  return this.dataSource.transaction(async (manager) => {
    const account = await manager
      .getRepository(Account)
      .createQueryBuilder('a')
      .setLock('pessimistic_write') // keep ordering consistent with withdraw; prevents races with concurrent withdraw
      .where('a.accountId = :accountId', { accountId })
      .getOne();

    if (!account) throw new NotFoundException('Account not found');
    if (!account.activeFlag) throw new ForbiddenException('Account is blocked');

    const prior = await manager.getRepository(Transaction).findOne({
      where: { accountId, type: TransactionType.DEPOSIT, idempotencyKey },
    });
    if (prior) {
      if (prior.value !== dto.value) throw new ConflictException('Idempotency key reused with different body');
      const bal = await manager.getRepository(Account).findOneByOrFail({ accountId });
      return { transaction: prior, balance: bal.balance };
    }

    const value = new Decimal(dto.value);
    if (value.lte(0)) throw new BadRequestException('Value must be > 0');
    if (value.gt(new Decimal(process.env.MAX_DEPOSIT ?? '1000000'))) {
      throw new BadRequestException('Value exceeds max deposit');
    }

    // Credit balance (explicit SQL numeric math; avoids driver quirks with increment on decimals)
    await manager
      .getRepository(Account)
      .createQueryBuilder()
      .update(Account)
      .set({ balance: () => 'balance + (:value)::numeric' })
      .where('accountId = :accountId', { accountId })
      .setParameters({ value: dto.value })
      .execute();

    const transaction = await manager.getRepository(Transaction).save({
      accountId,
      value: dto.value,
      type: TransactionType.DEPOSIT,
      idempotencyKey,
    });

    // No-doubt correctness: re-read under the same transaction + lock and return DB-truth.
    const updated = await manager.getRepository(Account).findOneByOrFail({ accountId });
    return { transaction, balance: updated.balance };
  });
}

