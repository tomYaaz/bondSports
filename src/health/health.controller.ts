import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness + DB readiness' })
  @ApiResponse({ status: 200, description: 'OK' })
  async getHealth(): Promise<{ status: string }> {
    await this.dataSource.query('SELECT 1');
    return { status: 'ok' };
  }
}
