import { NotFoundException } from '@nestjs/common';
import type { Account } from '../accounts/entities/account.entity';
import { assertAccountOwnedByOrNotFound } from './ownership';

const PERSON = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

function fakeAccount(personId: string): Account {
  return { accountId: 'a', personId } as Account;
}

describe('assertAccountOwnedByOrNotFound', () => {
  it('returns the account when the owner matches', () => {
    const acc = fakeAccount(PERSON);
    expect(assertAccountOwnedByOrNotFound(acc, PERSON)).toBe(acc);
  });

  it('throws NotFoundException when the account is null', () => {
    expect(() => assertAccountOwnedByOrNotFound(null, PERSON)).toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the personId does not match (no leak)', () => {
    const acc = fakeAccount(OTHER);
    expect(() => assertAccountOwnedByOrNotFound(acc, PERSON)).toThrow(
      NotFoundException,
    );
  });
});
