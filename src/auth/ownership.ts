import { NotFoundException } from '@nestjs/common';
import { Account } from '../accounts/entities/account.entity';

/**
 * Enumeration-safe ownership: missing account or wrong owner → 404.
 */
export function assertAccountOwnedByOrNotFound(
  account: Account | null,
  requestingPersonId: string,
): Account {
  if (!account || account.personId !== requestingPersonId) {
    throw new NotFoundException('Account not found');
  }
  return account;
}
