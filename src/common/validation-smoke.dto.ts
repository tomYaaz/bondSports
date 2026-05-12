import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ValidationSmokeDto {
  @ApiProperty({ example: 'hello', default: 'hello' })
  @IsString()
  @IsNotEmpty()
  label!: string;
}
