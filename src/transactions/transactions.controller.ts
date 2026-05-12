import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { IdempotencyKeyHeader } from '../common/decorators/idempotency-key-header.decorator';
import { DepositDto } from './dto/deposit.dto';
import { StatementFilterDto } from './dto/statement-filter.dto';
import { WithdrawalDto } from './dto/withdrawal.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('accounts')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('accounts')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post(':id/deposit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deposit funds' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Required; replays return the same result',
  })
  @ApiBody({ type: DepositDto })
  @ApiResponse({ status: 200, description: '{ transaction, balance }' })
  @ApiResponse({
    status: 400,
    description: 'Invalid payload or missing idempotency key',
  })
  @ApiResponse({ status: 403, description: 'Account blocked' })
  @ApiResponse({ status: 404, description: 'Not found or not owned' })
  @ApiConflictResponse({
    description: 'Idempotency key reused with different body',
  })
  deposit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: DepositDto,
    @IdempotencyKeyHeader() idempotencyKey: string,
  ) {
    return this.transactionsService.deposit(
      id,
      user.personId,
      dto,
      idempotencyKey,
    );
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw funds' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Required; replays return the same result',
  })
  @ApiBody({ type: WithdrawalDto })
  @ApiResponse({ status: 200, description: '{ transaction, balance }' })
  @ApiResponse({
    status: 400,
    description: 'Invalid payload or missing idempotency key',
  })
  @ApiResponse({ status: 403, description: 'Account blocked' })
  @ApiResponse({ status: 404, description: 'Not found or not owned' })
  @ApiConflictResponse({
    description: 'Idempotency key reused with different body',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Insufficient funds or daily withdrawal limit exceeded',
  })
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: WithdrawalDto,
    @IdempotencyKeyHeader() idempotencyKey: string,
  ) {
    return this.transactionsService.withdraw(
      id,
      user.personId,
      dto,
      idempotencyKey,
    );
  }

  @Get(':id/statement')
  @ApiOperation({ summary: 'Account statement (paginated)' })
  @ApiResponse({
    status: 200,
    description:
      '{ items, nextCursor?, hasNextPage } — hasNextPage is false on the final page',
  })
  @ApiResponse({ status: 400, description: 'Invalid date range' })
  @ApiResponse({ status: 404, description: 'Not found or not owned' })
  statement(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query() filter: StatementFilterDto,
  ) {
    return this.transactionsService.getStatement(id, user.personId, filter);
  }
}
