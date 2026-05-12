/**
 * Contract-level unit tests for TransactionsService.
 *
 * Scope (deliberate): exception-mapping behavior only. These tests describe
 * what the service throws (or returns) for a given account state, and do NOT
 * assert anything about HOW the service talks to the database (no QueryBuilder
 * method chains, no SQL fragments, no parameter names, no UTC bound shapes).
 *
 * Why: the engine underneath (TypeORM vs raw SQL, pessimistic locks vs
 * advisory locks, single-query vs multi-query daily limit, etc.) is allowed to
 * change without breaking these tests. Behavior that depends on the database
 * being real (balance math, UTC day windowing, cursor pagination correctness,
 * concurrency) is verified at the HTTP boundary in test/*.e2e-spec.ts —
 * especially test/invariants.e2e-spec.ts.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { Account } from '../accounts/entities/account.entity';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { TransactionsService } from './transactions.service';

type AnyQB = Record<string, jest.Mock>;

function chainQB(terminal: {
  getOne?: unknown;
  getMany?: unknown;
  getRawOne?: unknown;
  execute?: unknown;
}): AnyQB {
  const qb: AnyQB = {
    where: jest.fn(),
    andWhere: jest.fn(),
    setLock: jest.fn(),
    setParameters: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    select: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    take: jest.fn(),
    getOne: jest.fn().mockResolvedValue(terminal.getOne ?? null),
    getMany: jest.fn().mockResolvedValue(terminal.getMany ?? []),
    getRawOne: jest.fn().mockResolvedValue(terminal.getRawOne ?? null),
    execute: jest.fn().mockResolvedValue(terminal.execute ?? undefined),
  };
  for (const k of [
    'where',
    'andWhere',
    'setLock',
    'setParameters',
    'set',
    'update',
    'select',
    'orderBy',
    'addOrderBy',
    'take',
  ]) {
    qb[k].mockReturnValue(qb);
  }
  return qb;
}

type FakeRepo = {
  findOne: jest.Mock;
  findOneByOrFail: jest.Mock;
  save: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function makeRepo(
  init: Partial<FakeRepo> & { qbs?: AnyQB[] } = {},
): FakeRepo & { _qbQueue: AnyQB[] } {
  const queue: AnyQB[] = init.qbs ?? [];
  return {
    findOne: init.findOne ?? jest.fn().mockResolvedValue(null),
    findOneByOrFail: init.findOneByOrFail ?? jest.fn().mockResolvedValue(null),
    save:
      init.save ??
      jest
        .fn()
        .mockImplementation((row: unknown) =>
          Promise.resolve({ transactionId: 'tx-x', ...(row as object) }),
        ),
    createQueryBuilder:
      init.createQueryBuilder ??
      jest.fn(() => {
        const next = queue.shift();
        if (!next) {
          throw new Error('no QueryBuilder queued');
        }
        return next;
      }),
    _qbQueue: queue,
  };
}

function buildService(
  opts: {
    managerAccountRepo?: FakeRepo;
    managerTransactionRepo?: FakeRepo;
    transactionRepo?: FakeRepo;
  } = {},
) {
  const managerAccountRepo = opts.managerAccountRepo ?? makeRepo();
  const managerTransactionRepo = opts.managerTransactionRepo ?? makeRepo();
  const transactionRepo = opts.transactionRepo ?? makeRepo();
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Account) return managerAccountRepo;
      if (entity === Transaction) return managerTransactionRepo;
      throw new Error('unexpected entity in manager.getRepository');
    }),
  };
  const dataSource = {
    transaction: jest.fn(
      <T>(cb: (m: typeof manager) => Promise<T>): Promise<T> => cb(manager),
    ),
  } as unknown as DataSource;
  const accountsService = {
    findOneForOwner: jest.fn(),
    findOneByIdOrNotFound: jest.fn(),
    create: jest.fn(),
    setActive: jest.fn(),
  };
  const service = new TransactionsService(
    dataSource,
    transactionRepo as unknown as Repository<Transaction>,
    accountsService as unknown as AccountsService,
  );
  return {
    service,
    managerAccountRepo,
    managerTransactionRepo,
    transactionRepo,
    accountsService,
  };
}

const PERSON = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const ACC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function statementTx(iso: string, transactionId: string): Transaction {
  return {
    transactionId,
    accountId: ACC_ID,
    value: '1.000000',
    type: TransactionType.DEPOSIT,
    transactionDate: new Date(iso),
  } as Transaction;
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    accountId: ACC_ID,
    personId: PERSON,
    balance: '1000.000000',
    dailyWithdrawalLimit: '500.000000',
    activeFlag: true,
    accountType: 1,
    ...overrides,
  } as Account;
}

describe('TransactionsService.deposit — contract', () => {
  const ORIGINAL_MAX_DEPOSIT = process.env.MAX_DEPOSIT;
  afterEach(() => {
    if (ORIGINAL_MAX_DEPOSIT === undefined) delete process.env.MAX_DEPOSIT;
    else process.env.MAX_DEPOSIT = ORIGINAL_MAX_DEPOSIT;
  });

  it('throws NotFoundException when the account is missing', async () => {
    const managerAccountRepo = makeRepo({ qbs: [chainQB({ getOne: null })] });
    const { service } = buildService({ managerAccountRepo });
    await expect(
      service.deposit(ACC_ID, PERSON, { value: '1' }, 'k'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when personId does not match (no enumeration leak)', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account({ personId: OTHER }) })],
    });
    const { service } = buildService({ managerAccountRepo });
    await expect(
      service.deposit(ACC_ID, PERSON, { value: '1' }, 'k'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException when the account is blocked', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account({ activeFlag: false }) })],
    });
    const { service } = buildService({ managerAccountRepo });
    await expect(
      service.deposit(ACC_ID, PERSON, { value: '1' }, 'k'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('on idempotent replay returns the prior transaction without saving a new row', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account() })],
      findOneByOrFail: jest
        .fn()
        .mockResolvedValue(account({ balance: '100.000000' })),
    });
    const prior = {
      transactionId: 'tx-prior',
      accountId: ACC_ID,
      value: '50.000000',
      type: TransactionType.DEPOSIT,
      idempotencyKey: 'k',
    } as Transaction;
    const managerTransactionRepo = makeRepo({
      findOne: jest.fn().mockResolvedValue(prior),
    });
    const { service } = buildService({
      managerAccountRepo,
      managerTransactionRepo,
    });
    const result = await service.deposit(
      ACC_ID,
      PERSON,
      { value: '50.000000' },
      'k',
    );
    expect(result.transaction).toBe(prior);
    expect(result.balance).toBe('100.000000');
    expect(managerTransactionRepo.save).not.toHaveBeenCalled();
  });

  it('throws ConflictException when same idempotency key is replayed with a different amount', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account() })],
    });
    const prior = {
      transactionId: 'tx-prior',
      accountId: ACC_ID,
      value: '50.000000',
      type: TransactionType.DEPOSIT,
      idempotencyKey: 'k',
    } as Transaction;
    const managerTransactionRepo = makeRepo({
      findOne: jest.fn().mockResolvedValue(prior),
    });
    const { service } = buildService({
      managerAccountRepo,
      managerTransactionRepo,
    });
    await expect(
      service.deposit(ACC_ID, PERSON, { value: '60.000000' }, 'k'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws BadRequestException when value exceeds MAX_DEPOSIT', async () => {
    process.env.MAX_DEPOSIT = '100';
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account() }), chainQB({ execute: undefined })],
      findOneByOrFail: jest.fn().mockResolvedValue(account()),
    });
    const managerTransactionRepo = makeRepo();
    const { service } = buildService({
      managerAccountRepo,
      managerTransactionRepo,
    });
    await expect(
      service.deposit(ACC_ID, PERSON, { value: '101' }, 'k'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(managerTransactionRepo.save).not.toHaveBeenCalled();
  });
});

describe('TransactionsService.withdraw — contract', () => {
  it('throws NotFoundException when the account is missing', async () => {
    const managerAccountRepo = makeRepo({ qbs: [chainQB({ getOne: null })] });
    const { service } = buildService({ managerAccountRepo });
    await expect(
      service.withdraw(ACC_ID, PERSON, { value: '1' }, 'k'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when personId does not match', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account({ personId: OTHER }) })],
    });
    const { service } = buildService({ managerAccountRepo });
    await expect(
      service.withdraw(ACC_ID, PERSON, { value: '1' }, 'k'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException when the account is blocked', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account({ activeFlag: false }) })],
    });
    const { service } = buildService({ managerAccountRepo });
    await expect(
      service.withdraw(ACC_ID, PERSON, { value: '1' }, 'k'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('on idempotent replay returns the prior transaction without saving a new row', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account() })],
      findOneByOrFail: jest
        .fn()
        .mockResolvedValue(account({ balance: '950.000000' })),
    });
    const prior = {
      transactionId: 'tx-prior-w',
      accountId: ACC_ID,
      value: '50.000000',
      type: TransactionType.WITHDRAWAL,
      idempotencyKey: 'k',
    } as Transaction;
    const managerTransactionRepo = makeRepo({
      findOne: jest.fn().mockResolvedValue(prior),
    });
    const { service } = buildService({
      managerAccountRepo,
      managerTransactionRepo,
    });
    const result = await service.withdraw(
      ACC_ID,
      PERSON,
      { value: '50.000000' },
      'k',
    );
    expect(result.transaction).toBe(prior);
    expect(result.balance).toBe('950.000000');
    expect(managerTransactionRepo.save).not.toHaveBeenCalled();
  });

  it('throws ConflictException when same key is replayed with a different amount', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account() })],
    });
    const prior = {
      transactionId: 'tx-prior-w',
      accountId: ACC_ID,
      value: '50.000000',
      type: TransactionType.WITHDRAWAL,
      idempotencyKey: 'k',
    } as Transaction;
    const managerTransactionRepo = makeRepo({
      findOne: jest.fn().mockResolvedValue(prior),
    });
    const { service } = buildService({
      managerAccountRepo,
      managerTransactionRepo,
    });
    await expect(
      service.withdraw(ACC_ID, PERSON, { value: '60' }, 'k'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws UnprocessableEntityException for insufficient funds', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [chainQB({ getOne: account({ balance: '10.000000' }) })],
    });
    const managerTransactionRepo = makeRepo();
    const { service } = buildService({
      managerAccountRepo,
      managerTransactionRepo,
    });
    await expect(
      service.withdraw(ACC_ID, PERSON, { value: '20' }, 'k'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws UnprocessableEntityException when the daily limit is exceeded', async () => {
    const managerAccountRepo = makeRepo({
      qbs: [
        chainQB({
          getOne: account({
            balance: '10000.000000',
            dailyWithdrawalLimit: '100.000000',
          }),
        }),
      ],
    });
    const managerTransactionRepo = makeRepo({
      qbs: [chainQB({ getRawOne: { total: '60.000000' } })],
    });
    const { service } = buildService({
      managerAccountRepo,
      managerTransactionRepo,
    });
    await expect(
      service.withdraw(ACC_ID, PERSON, { value: '50' }, 'k'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('TransactionsService.getStatement — contract', () => {
  it('checks ownership first via AccountsService.findOneForOwner', async () => {
    const transactionRepo = makeRepo({ qbs: [chainQB({ getMany: [] })] });
    const { service, accountsService } = buildService({ transactionRepo });
    accountsService.findOneForOwner.mockResolvedValue({});
    const result = await service.getStatement(ACC_ID, PERSON, {});
    expect(accountsService.findOneForOwner).toHaveBeenCalledWith(
      ACC_ID,
      PERSON,
    );
    expect(result.items).toEqual([]);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('propagates NotFound from the ownership check', async () => {
    const transactionRepo = makeRepo();
    const { service, accountsService } = buildService({ transactionRepo });
    accountsService.findOneForOwner.mockRejectedValue(
      new NotFoundException('Account not found'),
    );
    await expect(
      service.getStatement(ACC_ID, PERSON, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when "from" is later than "to" with BadRequestException', async () => {
    const transactionRepo = makeRepo();
    const { service, accountsService } = buildService({ transactionRepo });
    accountsService.findOneForOwner.mockResolvedValue({});
    await expect(
      service.getStatement(ACC_ID, PERSON, {
        from: '2026-02-02',
        to: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when minValue is greater than maxValue', async () => {
    const transactionRepo = makeRepo();
    const { service, accountsService } = buildService({ transactionRepo });
    accountsService.findOneForOwner.mockResolvedValue({});
    await expect(
      service.getStatement(ACC_ID, PERSON, {
        minValue: '10.000000',
        maxValue: '5.000000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sets hasNextPage false and omits nextCursor on the last page', async () => {
    const rows = [
      statementTx(
        '2026-01-15T12:00:00.000Z',
        '11111111-1111-1111-1111-111111111111',
      ),
      statementTx(
        '2026-01-14T12:00:00.000Z',
        '22222222-2222-2222-2222-222222222222',
      ),
    ];
    const transactionRepo = makeRepo({ qbs: [chainQB({ getMany: rows })] });
    const { service, accountsService } = buildService({ transactionRepo });
    accountsService.findOneForOwner.mockResolvedValue({});
    const result = await service.getStatement(ACC_ID, PERSON, { limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('sets hasNextPage true and nextCursor when another page exists', async () => {
    const rows = [
      statementTx(
        '2026-01-16T12:00:00.000Z',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      ),
      statementTx(
        '2026-01-15T12:00:00.000Z',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      ),
      statementTx(
        '2026-01-14T12:00:00.000Z',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
      ),
    ];
    const transactionRepo = makeRepo({ qbs: [chainQB({ getMany: rows })] });
    const { service, accountsService } = buildService({ transactionRepo });
    accountsService.findOneForOwner.mockResolvedValue({});
    const result = await service.getStatement(ACC_ID, PERSON, { limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.hasNextPage).toBe(true);
    expect(typeof result.nextCursor).toBe('string');
    expect(result.nextCursor!.length).toBeGreaterThan(0);
  });
});
