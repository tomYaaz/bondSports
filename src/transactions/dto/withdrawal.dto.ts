import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

const MONEY_POSITIVE = /^\d+(\.\d{1,6})?$/;

export class WithdrawalDto {
  @ApiProperty({ example: '10.000000' })
  @IsString()
  @MaxLength(32)
  @Matches(MONEY_POSITIVE, {
    message: 'value must be a positive decimal with at most 6 decimal places',
  })
  value!: string;
}
