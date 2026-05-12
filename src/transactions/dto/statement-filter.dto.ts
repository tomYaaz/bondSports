import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TransactionType } from '../entities/transaction.entity';

const MONEY_POSITIVE = /^\d+(\.\d{1,6})?$/;

export class StatementFilterDto {
  @ApiPropertyOptional({
    example: '2024-01-01',
    description: 'UTC date-only (inclusive start)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2024-01-31',
    description: 'UTC date-only (exclusive end is +1 day)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Base64url cursor from prior response' })
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({
    example: '10.000000',
    description:
      'Inclusive lower bound on transaction value (positive money string)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(MONEY_POSITIVE, {
    message:
      'minValue must be a positive decimal with at most 6 decimal places',
  })
  minValue?: string;

  @ApiPropertyOptional({
    example: '100.000000',
    description:
      'Inclusive upper bound on transaction value (positive money string)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(MONEY_POSITIVE, {
    message:
      'maxValue must be a positive decimal with at most 6 decimal places',
  })
  maxValue?: string;
}
