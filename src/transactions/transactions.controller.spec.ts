import type { AuthUser } from '../auth/current-user.decorator';
import { DepositDto } from './dto/deposit.dto';
import { StatementFilterDto } from './dto/statement-filter.dto';
import { WithdrawalDto } from './dto/withdrawal.dto';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

function makeService() {
  return {
    deposit: jest.fn(),
    withdraw: jest.fn(),
    getStatement: jest.fn(),
  };
}

type TransactionsServiceMock = ReturnType<typeof makeService>;

const USER: AuthUser = {
  personId: '00000000-0000-0000-0000-000000000001',
  roles: [],
};

describe('TransactionsController', () => {
  let svc: TransactionsServiceMock;
  let ctl: TransactionsController;

  beforeEach(() => {
    svc = makeService();
    ctl = new TransactionsController(svc as unknown as TransactionsService);
  });

  it('deposit() forwards id, personId, dto, and idempotency key', () => {
    const dto: DepositDto = { value: '10.000000' };
    svc.deposit.mockResolvedValue({});
    void ctl.deposit('acc-uuid', USER, dto, 'k1');
    expect(svc.deposit).toHaveBeenCalledWith(
      'acc-uuid',
      USER.personId,
      dto,
      'k1',
    );
  });

  it('withdraw() forwards id, personId, dto, and idempotency key', () => {
    const dto: WithdrawalDto = { value: '5.000000' };
    svc.withdraw.mockResolvedValue({});
    void ctl.withdraw('acc-uuid', USER, dto, 'k2');
    expect(svc.withdraw).toHaveBeenCalledWith(
      'acc-uuid',
      USER.personId,
      dto,
      'k2',
    );
  });

  it('statement() forwards id, personId, and query DTO', () => {
    const dto: StatementFilterDto = {
      from: '2026-01-01',
      to: '2026-01-31',
      limit: 50,
    };
    svc.getStatement.mockResolvedValue({ items: [] });
    void ctl.statement('acc-uuid', USER, dto);
    expect(svc.getStatement).toHaveBeenCalledWith(
      'acc-uuid',
      USER.personId,
      dto,
    );
  });
});
