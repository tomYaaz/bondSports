import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';

@ApiTags('accounts')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create account (personId from JWT)',
    description:
      'Creates a new account for the JWT subject. The same user may create multiple accounts, including multiple CHECKING and/or multiple SAVINGS; there is no per-type or per-person limit.',
  })
  @ApiBody({ type: CreateAccountDto })
  @ApiResponse({ status: 201, description: 'Account created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accountsService.create(user.personId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get account by id (owner only)' })
  @ApiResponse({ status: 200, description: 'Account returned' })
  @ApiResponse({ status: 404, description: 'Not found or not owned' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.accountsService.findOneForOwner(id, user.personId);
  }

  @Patch(':id/block')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Block account (admin only)' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  @ApiResponse({ status: 200, description: 'Account blocked' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  block(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.setActive(id, false);
  }

  @Patch(':id/unblock')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Unblock account (admin only)' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  @ApiResponse({ status: 200, description: 'Account unblocked' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  unblock(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.setActive(id, true);
  }
}
