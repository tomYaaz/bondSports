import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { moneyTransformer } from '../../common/transformers/money.transformer';
import { Transaction } from '../../transactions/entities/transaction.entity';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  accountId: string;

  /** External person id; no FK (person service out of scope). */
  @Column('uuid')
  personId: string;

  @Column({
    type: 'decimal',
    precision: 21,
    scale: 6,
    default: 0,
    transformer: moneyTransformer,
  })
  balance: string;

  @Column({
    type: 'decimal',
    precision: 21,
    scale: 6,
    transformer: moneyTransformer,
  })
  dailyWithdrawalLimit: string;

  @Column({ default: true })
  activeFlag: boolean;

  @Column({ type: 'int' })
  accountType: 1 | 2;

  @CreateDateColumn({ type: 'timestamptz' })
  createDate: Date;

  @OneToMany(() => Transaction, (t) => t.account)
  transactions: Transaction[];
}
