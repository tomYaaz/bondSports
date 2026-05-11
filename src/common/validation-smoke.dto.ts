import { IsNotEmpty, IsString } from 'class-validator';

export class ValidationSmokeDto {
  @IsString()
  @IsNotEmpty()
  label!: string;
}
