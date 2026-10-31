import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { STAT_KEYS, UserRole } from '@club/shared';
import { Public, Roles, CurrentUser, type Actor } from '../common/http.js';
import { ApiErrorDto } from '../common/dto.js';
import { ApiPage } from '../common/query.dto.js';
import { StatsService } from './stats.service.js';
class StatsResponseDto {
  @ApiProperty() places!: number;
  @ApiProperty() curators!: number;
  @ApiProperty() events12Months!: number;
  @ApiProperty() masterClasses12Months!: number;
  @ApiProperty() uniqueParticipants12Months!: number;
  @ApiProperty() beneficiaries!: number;
  @ApiProperty() trips!: number;
}
class StatOverrideDto {
  @ApiProperty({ enum: STAT_KEYS }) @IsIn(STAT_KEYS) key!: (typeof STAT_KEYS)[number];
  @ApiProperty({
    nullable: true,
    type: 'integer',
    description: 'null возвращает счетчик к расчету из БД.',
    minimum: 0,
    maximum: 2147483647,
  })
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  value!: number | null;
}
class OverridesDto {
  @ApiProperty({ type: [StatOverrideDto], maxItems: STAT_KEYS.length })
  @IsArray()
  @ArrayMaxSize(STAT_KEYS.length)
  @ArrayUnique((item: StatOverrideDto) => item.key)
  @ValidateNested({ each: true })
  @Type(() => StatOverrideDto)
  items!: StatOverrideDto[];
}
@ApiTags('public')
@Public()
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('public/stats')
export class PublicStatsController {
  constructor(private readonly stats: StatsService) {}
  @Get() @ApiOkResponse({ type: StatsResponseDto }) get() {
    return this.stats.get();
  }
}
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('admin/stat-overrides')
export class AdminStatsController {
  constructor(private readonly stats: StatsService) {}
  @Get() @ApiPage(StatOverrideDto) get() {
    return this.stats.overrides();
  }
  @Put() @ApiPage(StatOverrideDto) write(@CurrentUser() actor: Actor, @Body() dto: OverridesDto) {
    return this.stats.write(actor, dto.items);
  }
}
