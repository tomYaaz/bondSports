import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { assertAccountOwnedByOrNotFound } from '../auth/ownership';
import {
  decimalToMoneyString,
  parseNonNegativeMoneyString,
} from '../common/money-parse';
import Decimal from 'decimal.js';
import { Account } from './entities/account.entity';
import { AccountTypeDto, CreateAccountDto } from './dto/create-account.dto';

const DEFAULT_DAILY_WITHDRAWAL_LIMIT = '500.000000';
const MAX_DAILY_WITHDRAWAL = new Decimal('1000000000000'); // coarse upper bound

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  async create(personId: string, dto: CreateAccountDto): Promise<Account> {
    const dailyDec = parseNonNegativeMoneyString(
      dto.dailyWithdrawalLimit,
      DEFAULT_DAILY_WITHDRAWAL_LIMIT,
      'dailyWithdrawalLimit',
    );
    if (dailyDec.gt(MAX_DAILY_WITHDRAWAL)) {
      throw new BadRequestException('dailyWithdrawalLimit exceeds maximum');
    }
    const accountType = dto.accountType === AccountTypeDto.CHECKING ? 1 : 2;
    const account = this.accountRepo.create({
      personId,
      balance: '0.000000',
      dailyWithdrawalLimit: decimalToMoneyString(dailyDec),
      activeFlag: true,
      accountType,
    });
    return this.accountRepo.save(account);
  }

  async findOneForOwner(accountId: string, personId: string): Promise<Account> {
    const account = await this.accountRepo.findOne({ where: { accountId } });
    return assertAccountOwnedByOrNotFound(account, personId);
  }

  async findOneByIdOrNotFound(accountId: string): Promise<Account> {
    const account = await this.accountRepo.findOne({ where: { accountId } });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  async setActive(accountId: string, active: boolean): Promise<Account> {
    const account = await this.accountRepo.findOne({ where: { accountId } });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    account.activeFlag = active;
    return this.accountRepo.save(account);
  }
}
