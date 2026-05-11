import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { Account } from '../accounts/entities/account.entity';
import { parsePositiveMoneyString } from '../common/money-parse';
import { decodeCursor, encodeCursor } from '../common/utils/cursor';
import { DepositDto } from './dto/deposit.dto';
import { StatementFilterDto } from './dto/statement-filter.dto';
import { WithdrawalDto } from './dto/withdrawal.dto';
import { Transaction, TransactionType } from './entities/transaction.entity';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    private readonly accountsService: AccountsService,
  ) {}

  async deposit(
    accountId: string,
    personId: string,
    dto: DepositDto,
    idempotencyKey: string,
  ): Promise<{ transaction: Transaction; balance: string }> {
    return this.dataSource.transaction(async (manager) => {
      const account = await manager
        .getRepository(Account)
        .createQueryBuilder('a')
        .setLock('pessimistic_write')
        .where('a.accountId = :accountId', { accountId })
        .getOne();

      if (!account) {
        throw new NotFoundException('Account not found');
      }
      if (account.personId !== personId) {
        throw new NotFoundException('Account not found');
      }
      if (!account.activeFlag) {
        throw new ForbiddenException('Account is blocked');
      }

      const prior = await manager.getRepository(Transaction).findOne({
        where: { accountId, type: TransactionType.DEPOSIT, idempotencyKey },
      });
      if (prior) {
        if (prior.value !== dto.value) {
          throw new ConflictException(
            'Idempotency key reused with different body',
          );
        }
        const bal = await manager.getRepository(Account).findOneByOrFail({
          accountId,
        });
        return { transaction: prior, balance: bal.balance };
      }

      const value = parsePositiveMoneyString(dto.value, 'value');
      const maxDep = new Decimal(process.env.MAX_DEPOSIT ?? '1000000');
      if (value.gt(maxDep)) {
        throw new BadRequestException('Value exceeds max deposit');
      }

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

      const updated = await manager.getRepository(Account).findOneByOrFail({
        accountId,
      });
      return { transaction, balance: updated.balance };
    });
  }

  async withdraw(
    accountId: string,
    personId: string,
    dto: WithdrawalDto,
    idempotencyKey: string,
  ): Promise<{ transaction: Transaction; balance: string }> {
    return this.dataSource.transaction(async (manager) => {
      const account = await manager
        .getRepository(Account)
        .createQueryBuilder('a')
        .setLock('pessimistic_write')
        .where('a.accountId = :accountId', { accountId })
        .getOne();

      if (!account) {
        throw new NotFoundException('Account not found');
      }
      if (account.personId !== personId) {
        throw new NotFoundException('Account not found');
      }
      if (!account.activeFlag) {
        throw new ForbiddenException('Account is blocked');
      }

      const prior = await manager.getRepository(Transaction).findOne({
        where: { accountId, type: TransactionType.WITHDRAWAL, idempotencyKey },
      });
      if (prior) {
        if (prior.value !== dto.value) {
          throw new ConflictException(
            'Idempotency key reused with different body',
          );
        }
        const bal = await manager.getRepository(Account).findOneByOrFail({
          accountId,
        });
        return { transaction: prior, balance: bal.balance };
      }

      const value = parsePositiveMoneyString(dto.value, 'value');
      const balance = new Decimal(account.balance);
      if (balance.lt(value)) {
        throw new UnprocessableEntityException('Insufficient funds');
      }

      const startOfDayUTC = new Date(
        new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z',
      );
      const startOfNextDayUTC = new Date(startOfDayUTC.getTime() + 86400000);

      const todayWithdrawals = await manager
        .getRepository(Transaction)
        .createQueryBuilder('t')
        .select('COALESCE(SUM(t.value), 0)', 'total')
        .where('t.accountId = :accountId', { accountId })
        .andWhere('t.type = :type', { type: TransactionType.WITHDRAWAL })
        .andWhere('t.transactionDate >= :startOfDayUTC', { startOfDayUTC })
        .andWhere('t.transactionDate < :startOfNextDayUTC', {
          startOfNextDayUTC,
        })
        .getRawOne<{ total: string }>();

      const usedToday = new Decimal(todayWithdrawals?.total ?? '0');
      const dailyLimit = new Decimal(account.dailyWithdrawalLimit);
      if (usedToday.plus(value).gt(dailyLimit)) {
        throw new UnprocessableEntityException(
          'Daily withdrawal limit exceeded',
        );
      }

      await manager
        .getRepository(Account)
        .createQueryBuilder()
        .update(Account)
        .set({ balance: () => 'balance - (:value)::numeric' })
        .where('accountId = :accountId', { accountId })
        .setParameters({ value: dto.value })
        .execute();

      const transaction = await manager.getRepository(Transaction).save({
        accountId,
        value: dto.value,
        type: TransactionType.WITHDRAWAL,
        idempotencyKey,
      });

      const updated = await manager.getRepository(Account).findOneByOrFail({
        accountId,
      });
      return { transaction, balance: updated.balance };
    });
  }

  async getStatement(
    accountId: string,
    personId: string,
    filter: StatementFilterDto,
  ): Promise<{ items: Transaction[]; nextCursor?: string }> {
    await this.accountsService.findOneForOwner(accountId, personId);

    if (
      filter.from &&
      filter.to &&
      new Date(filter.from) > new Date(filter.to)
    ) {
      throw new BadRequestException('"from" must be earlier than "to"');
    }

    const order = filter.order ?? 'DESC';
    const limitNum = Math.min(filter.limit ?? 50, 200);

    const qb = this.transactionRepo
      .createQueryBuilder('t')
      .where('t.accountId = :accountId', { accountId });

    if (filter.from) {
      const fromStartUTC = new Date(`${filter.from}T00:00:00.000Z`);
      qb.andWhere('t.transactionDate >= :fromStartUTC', { fromStartUTC });
    }
    if (filter.to) {
      const toStartUTC = new Date(`${filter.to}T00:00:00.000Z`);
      const toNextDayUTC = new Date(toStartUTC.getTime() + 86400000);
      qb.andWhere('t.transactionDate < :toNextDayUTC', { toNextDayUTC });
    }

    if (filter.cursor) {
      const { d, id } = decodeCursor(filter.cursor);
      const cursorDate = new Date(d);
      if (order === 'DESC') {
        qb.andWhere(
          '(t.transactionDate < :cursorDate OR (t.transactionDate = :cursorDate AND t.transactionId < :cursorId))',
          { cursorDate, cursorId: id },
        );
      } else {
        qb.andWhere(
          '(t.transactionDate > :cursorDate OR (t.transactionDate = :cursorDate AND t.transactionId > :cursorId))',
          { cursorDate, cursorId: id },
        );
      }
    }

    qb.orderBy('t.transactionDate', order)
      .addOrderBy('t.transactionId', order)
      .take(limitNum + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > limitNum;
    const items = hasMore ? rows.slice(0, limitNum) : rows;
    const nextCursor =
      hasMore && items.length > 0
        ? encodeCursor(
            items[items.length - 1].transactionDate,
            items[items.length - 1].transactionId,
          )
        : undefined;

    return { items, nextCursor };
  }
}
