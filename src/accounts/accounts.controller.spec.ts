import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AccountTypeDto, CreateAccountDto } from './dto/create-account.dto';
import type { AuthUser } from '../auth/current-user.decorator';

function makeService() {
  return {
    create: jest.fn(),
    findOneForOwner: jest.fn(),
    findOneByIdOrNotFound: jest.fn(),
    setActive: jest.fn(),
  };
}

type AccountsServiceMock = ReturnType<typeof makeService>;

const USER: AuthUser = {
  personId: '00000000-0000-0000-0000-000000000001',
  roles: [],
};

describe('AccountsController', () => {
  let svc: AccountsServiceMock;
  let ctl: AccountsController;

  beforeEach(() => {
    svc = makeService();
    ctl = new AccountsController(svc as unknown as AccountsService);
  });

  it('create() passes JWT personId and DTO to AccountsService.create', () => {
    const dto: CreateAccountDto = { accountType: AccountTypeDto.CHECKING };
    svc.create.mockResolvedValue({});
    void ctl.create(USER, dto);
    expect(svc.create).toHaveBeenCalledWith(USER.personId, dto);
  });

  it('findOne() passes the parsed id and personId to AccountsService.findOneForOwner', () => {
    svc.findOneForOwner.mockResolvedValue({});
    void ctl.findOne('acc-uuid', USER);
    expect(svc.findOneForOwner).toHaveBeenCalledWith('acc-uuid', USER.personId);
  });

  it('block() calls setActive(id, false)', () => {
    svc.setActive.mockResolvedValue({});
    void ctl.block('acc-uuid');
    expect(svc.setActive).toHaveBeenCalledWith('acc-uuid', false);
  });

  it('unblock() calls setActive(id, true)', () => {
    svc.setActive.mockResolvedValue({});
    void ctl.unblock('acc-uuid');
    expect(svc.setActive).toHaveBeenCalledWith('acc-uuid', true);
  });
});
