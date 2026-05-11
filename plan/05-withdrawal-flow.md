## 5. The withdrawal flow — this is where you win or lose

This single function is what separates a good submission from a great one. It must:

Verify the account exists and is active
Verify the withdrawal doesn't exceed balance
Verify the daily withdrawal limit isn't exceeded (summing today's withdrawals)
Execute atomically — balance update + transaction insert in one DB transaction, with a row lock

Clarify invariants/definitions (reviewer-grade):
- **Daily limit includes the current pending withdrawal** (i.e., check `usedToday + value <= dailyWithdrawalLimit`)
- **Only successful withdrawals are recorded** (a rejected withdrawal returns an error and does **not** insert a `Transaction`)
- **“Today” is defined in UTC** as the half-open range \([startOfDayUTC, startOfNextDayUTC)\) to keep the query index-friendly (avoid `DATE(...)` on the column)
- **Idempotency**: `Idempotency-Key` is required; replay returns the original result; reuse with a different value returns **409 Conflict** (see `plan/04-critical-endpoints.md`)

typescriptasync withdraw(
  accountId: string,
  dto: WithdrawalDto,
  idempotencyKey: string, // required header — persisted on Transaction (see plan/03-entities-typeorm.md, plan/11-migrations-setup.md)
): Promise<{ transaction: Transaction; balance: string }> {
  return this.dataSource.transaction(async (manager) => {
    // Lock the account row — prevents concurrent withdrawals on the same account
    const account = await manager
      .getRepository(Account)
      .createQueryBuilder('a')
      .setLock('pessimistic_write')  // SELECT FOR UPDATE
      .where('a.accountId = :accountId', { accountId })
      .getOne();

    if (!account) throw new NotFoundException('Account not found');
    if (!account.activeFlag) throw new ForbiddenException('Account is blocked');

    // Idempotency: same (accountId, type, key) must map to one transaction row (DB unique index enforces races).
    const prior = await manager.getRepository(Transaction).findOne({
      where: { accountId, type: TransactionType.WITHDRAWAL, idempotencyKey },
    });
    if (prior) {
      if (prior.value !== dto.value) throw new ConflictException('Idempotency key reused with different body');
      const bal = await manager.getRepository(Account).findOneByOrFail({ accountId });
      return { transaction: prior, balance: bal.balance };
    }
    // Money is handled as strings at the ORM boundary; use Decimal in domain logic.
    const value = new Decimal(dto.value);
    const balance = new Decimal(account.balance);
    if (value.lte(0)) throw new BadRequestException('Value must be > 0');
    if (balance.lt(value)) {
      throw new UnprocessableEntityException('Insufficient funds');
    }

    // Daily limit check — sum today's withdrawals
    const startOfDayUTC = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const startOfNextDayUTC = new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000);
    const todayWithdrawals = await manager
      .getRepository(Transaction)
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.value), 0)', 'total')
      .where('t.accountId = :accountId', { accountId })
      .andWhere('t.type = :type', { type: TransactionType.WITHDRAWAL })
      // Index-friendly: range query on timestamp column (no DATE(...) wrapper)
      .andWhere('t.transactionDate >= :startOfDayUTC', { startOfDayUTC })
      .andWhere('t.transactionDate < :startOfNextDayUTC', { startOfNextDayUTC })
      .getRawOne();

    const usedToday = new Decimal(todayWithdrawals?.total ?? '0');
    const dailyLimit = new Decimal(account.dailyWithdrawalLimit);
    if (usedToday.plus(value).gt(dailyLimit)) {
      throw new UnprocessableEntityException('Daily withdrawal limit exceeded');
    }

    // Debit balance (explicit SQL numeric math; avoids driver quirks with decrement on decimals)
    await manager
      .getRepository(Account)
      .createQueryBuilder()
      .update(Account)
      .set({ balance: () => 'balance - (:value)::numeric' })
      .where('accountId = :accountId', { accountId })
      .setParameters({ value: dto.value })
      .execute();

    // Record transaction (idempotencyKey column required — matches partial unique index)
    const transaction = await manager.getRepository(Transaction).save({
      accountId,
      value: dto.value,
      type: TransactionType.WITHDRAWAL,
      idempotencyKey,
    });

    const updated = await manager.getRepository(Account).findOneByOrFail({ accountId });
    return { transaction, balance: updated.balance };
  });
}

Why pessimistic_write? If two requests hit this function simultaneously both reading balance = 100, both will see $100 as available and both will succeed — leaving you at -$100. With SELECT FOR UPDATE, the second request blocks until the first commits. It's a small performance cost, acceptable for financial transactions.

Transaction isolation note: Postgres default **READ COMMITTED** plus `SELECT ... FOR UPDATE` row locking is sufficient here; we do not require SERIALIZABLE for this assessment.

