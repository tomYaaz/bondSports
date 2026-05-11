import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AccountsService } from './accounts.service';
import { AccountTypeDto, CreateAccountDto } from './dto/create-account.dto';
import { Account } from './entities/account.entity';

type RepoMock = Pick<Repository<Account>, 'create' | 'save' | 'findOne'> & {
  create: jest.Mock;
  save: jest.Mock;
  findOne: jest.Mock;
};

function makeRepo(): RepoMock {
  return {
    create: jest.fn((dto: Partial<Account>) => dto as Account),
    save: jest.fn((acc: Account) => Promise.resolve(acc)),
    findOne: jest.fn(),
  } as unknown as RepoMock;
}

const PERSON = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

describe('AccountsService.create', () => {
  let repo: RepoMock;
  let svc: AccountsService;

  beforeEach(() => {
    repo = makeRepo();
    svc = new AccountsService(repo as unknown as Repository<Account>);
  });

  it('maps CHECKING to accountType 1 with defaults', async () => {
    const dto: CreateAccountDto = { accountType: AccountTypeDto.CHECKING };
    await svc.create(PERSON, dto);
    const created = repo.create.mock.calls[0][0] as Partial<Account>;
    expect(created.accountType).toBe(1);
    expect(created.activeFlag).toBe(true);
    expect(created.balance).toBe('0.000000');
    expect(created.personId).toBe(PERSON);
    expect(created.dailyWithdrawalLimit).toBe('500.000000');
  });

  it('maps SAVINGS to accountType 2', async () => {
    const dto: CreateAccountDto = { accountType: AccountTypeDto.SAVINGS };
    await svc.create(PERSON, dto);
    const created = repo.create.mock.calls[0][0] as Partial<Account>;
    expect(created.accountType).toBe(2);
  });

  it('stores a custom daily limit formatted to six decimals', async () => {
    const dto: CreateAccountDto = {
      accountType: AccountTypeDto.CHECKING,
      dailyWithdrawalLimit: '750',
    };
    await svc.create(PERSON, dto);
    const created = repo.create.mock.calls[0][0] as Partial<Account>;
    expect(created.dailyWithdrawalLimit).toBe('750.000000');
  });

  it('rejects daily limit above the global maximum', async () => {
    const dto: CreateAccountDto = {
      accountType: AccountTypeDto.CHECKING,
      dailyWithdrawalLimit: '1000000000001',
    };
    await expect(svc.create(PERSON, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects malformed daily limit money strings', async () => {
    const dto: CreateAccountDto = {
      accountType: AccountTypeDto.CHECKING,
      dailyWithdrawalLimit: 'abc',
    };
    await expect(svc.create(PERSON, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns the saved account', async () => {
    const dto: CreateAccountDto = { accountType: AccountTypeDto.CHECKING };
    const result = await svc.create(PERSON, dto);
    expect(repo.save).toHaveBeenCalled();
    expect(result.personId).toBe(PERSON);
  });
});

describe('AccountsService.findOneForOwner', () => {
  let repo: RepoMock;
  let svc: AccountsService;

  beforeEach(() => {
    repo = makeRepo();
    svc = new AccountsService(repo as unknown as Repository<Account>);
  });

  it('returns the account when the owner matches', async () => {
    const acc = { accountId: 'a', personId: PERSON } as Account;
    repo.findOne.mockResolvedValue(acc);
    await expect(svc.findOneForOwner('a', PERSON)).resolves.toBe(acc);
  });

  it('throws NotFoundException when the account is missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(svc.findOneForOwner('a', PERSON)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the owner differs (no leak)', async () => {
    repo.findOne.mockResolvedValue({
      accountId: 'a',
      personId: OTHER,
    } as Account);
    await expect(svc.findOneForOwner('a', PERSON)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AccountsService.findOneByIdOrNotFound', () => {
  let repo: RepoMock;
  let svc: AccountsService;

  beforeEach(() => {
    repo = makeRepo();
    svc = new AccountsService(repo as unknown as Repository<Account>);
  });

  it('returns the account when present (regardless of owner)', async () => {
    const acc = { accountId: 'a', personId: OTHER } as Account;
    repo.findOne.mockResolvedValue(acc);
    await expect(svc.findOneByIdOrNotFound('a')).resolves.toBe(acc);
  });

  it('throws NotFoundException when missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(svc.findOneByIdOrNotFound('a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AccountsService.setActive', () => {
  let repo: RepoMock;
  let svc: AccountsService;

  beforeEach(() => {
    repo = makeRepo();
    svc = new AccountsService(repo as unknown as Repository<Account>);
  });

  it('blocks (activeFlag=false) and saves', async () => {
    const acc = { accountId: 'a', personId: PERSON, activeFlag: true } as Account;
    repo.findOne.mockResolvedValue(acc);
    await svc.setActive('a', false);
    expect(acc.activeFlag).toBe(false);
    expect(repo.save).toHaveBeenCalledWith(acc);
  });

  it('unblocks (activeFlag=true) and saves', async () => {
    const acc = {
      accountId: 'a',
      personId: PERSON,
      activeFlag: false,
    } as Account;
    repo.findOne.mockResolvedValue(acc);
    await svc.setActive('a', true);
    expect(acc.activeFlag).toBe(true);
    expect(repo.save).toHaveBeenCalledWith(acc);
  });

  it('throws NotFoundException when the account is missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(svc.setActive('a', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
