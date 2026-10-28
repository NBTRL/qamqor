import { Controller, Get } from '@nestjs/common';
import { ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto, HealthResponseDto } from '../common/dto.js';
import { Public } from '../common/http.js';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('health')
@Public()
@SkipThrottle()
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Единый формат ошибки API' })
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ operationId: 'getHealth', summary: 'Проверка работы процесса API (liveness)' })
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth(): HealthResponseDto {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
