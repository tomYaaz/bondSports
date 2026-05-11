import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export enum AccountTypeDto {
  CHECKING = 'CHECKING',
  SAVINGS = 'SAVINGS',
}

/** Decimal string, non-negative, max 6 fractional digits (optional on create). */
const MONEY_STRING = /^\d+(\.\d{1,6})?$/;

export class CreateAccountDto {
  @ApiProperty({ enum: AccountTypeDto, example: AccountTypeDto.CHECKING })
  @IsEnum(AccountTypeDto)
  accountType!: AccountTypeDto;

  @ApiPropertyOptional({
    example: '500.000000',
    description:
      'Optional; defaults to 500.000000. Non-negative, max 6 decimal places.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(MONEY_STRING, {
    message:
      'dailyWithdrawalLimit must be a non-negative decimal with at most 6 decimal places',
  })
  dailyWithdrawalLimit?: string;
}
