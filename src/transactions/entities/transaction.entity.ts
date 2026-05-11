import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';
import { moneyTransformer } from '../../common/transformers/money.transformer';

export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  transactionId: string;

  @ManyToOne(() => Account, (a) => a.transactions)
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column('uuid')
  accountId: string;

  @Column({
    type: 'decimal',
    precision: 21,
    scale: 6,
    transformer: moneyTransformer,
  })
  value: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
    enumName: 'transactions_type_enum',
  })
  type: TransactionType;

  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  transactionDate: Date;
}
