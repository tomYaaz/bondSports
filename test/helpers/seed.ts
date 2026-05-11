import { DataSource, Repository } from 'typeorm';
import { Account } from '../../src/accounts/entities/account.entity';

/** Truncate ledger + accounts for a clean e2e case (FK order: transactions first). */
export async function clearE2eTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM "transactions"');
  await dataSource.query('DELETE FROM "accounts"');
}

/**
 * Insert a known account row for e2e scenarios that need DB-level setup.
 * Most tests use the HTTP API + `clearE2eTables` instead.
 */
export async function seedAccount(
  repo: Repository<Account>,
  overrides: Partial<
    Pick<
      Account,
      | 'personId'
      | 'balance'
      | 'dailyWithdrawalLimit'
      | 'activeFlag'
      | 'accountType'
    >
  > = {},
): Promise<Account> {
  return repo.save(
    repo.create({
      personId: '00000000-0000-0000-0000-000000000001',
      balance: '1000.000000',
      dailyWithdrawalLimit: '500.000000',
      activeFlag: true,
      accountType: 1,
      ...overrides,
    }),
  );
}
