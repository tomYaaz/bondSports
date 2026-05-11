## `activeFlag` block/unblock endpoints (required delta)

The plan must include unblock alongside block.

**Authorization:** `PATCH .../block` and `PATCH .../unblock` are **admin-only**. Use Nest **`RolesGuard`** + `@Roles('admin')` (see `plan/15-security-auth-ownership.md`). Customer JWTs (no `roles` or without `admin`) receive **403 Forbidden**.

**Service:** Admins may block/unblock **any** account by `accountId` (no owner `personId` check). Load by id; if missing → **404**; then update `activeFlag`.

typescript
// accounts.controller.ts
@Patch(':id/block')
@Roles('admin')
@UseGuards(RolesGuard)
block(@Param('id') id: string) {
  return this.accountsService.setActive(id, false);
}

@Patch(':id/unblock')
@Roles('admin')
@UseGuards(RolesGuard)
unblock(@Param('id') id: string) {
  return this.accountsService.setActive(id, true);
}

typescript
// accounts.service.ts
async setActive(accountId: string, active: boolean) {
  const account = await this.accountRepo.findOne({ where: { accountId } });
  if (!account) throw new NotFoundException('Account not found');
  account.activeFlag = active;
  return this.accountRepo.save(account);
}

Explicit behavior to document: blocking does not roll back committed transactions. In-flight requests that already passed the `activeFlag` check before the block are not interrupted — that window is acceptable and should be stated in the README.
