import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('app')
@ApiBearerAuth('bearer')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Hello (requires JWT)' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('protected/ping')
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiOperation({ summary: 'Auth smoke test' })
  @ApiResponse({ status: 200, description: '{ ok: true }' })
  protectedPing(): { ok: boolean } {
    return { ok: true };
  }
}
