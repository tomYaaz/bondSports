import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

@ApiTags('app')
@ApiBearerAuth('bearer')
@Controller()
export class AppController {
  @Get('protected/ping')
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiOperation({ summary: 'Auth smoke test' })
  @ApiResponse({ status: 200, description: '{ ok: true }' })
  protectedPing(): { ok: boolean } {
    return { ok: true };
  }
}
