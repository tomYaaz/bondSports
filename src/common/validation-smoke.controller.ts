import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ValidationSmokeDto } from './validation-smoke.dto';

/** Public smoke route for verifying ValidationPipe + error filter (step 5). */
@Controller('_validation-smoke')
export class ValidationSmokeController {
  @Post()
  @Public()
  validate(@Body() body: ValidationSmokeDto): { ok: true; label: string } {
    return { ok: true, label: body.label };
  }
}
