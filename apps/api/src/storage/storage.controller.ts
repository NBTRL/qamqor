import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { UPLOAD_IMAGE_TYPES, UPLOAD_PDF_MAX_BYTES, UserRole } from '@club/shared';
import { OptionalJwtGuard } from '../auth/guards.js';
import { CurrentUser, Public, Roles, type Actor, type AuthRequest } from '../common/http.js';
import { ApiErrorDto } from '../common/dto.js';
import { StorageService } from './storage.service.js';

export class PresignDto {
  @ApiProperty({ enum: ['REPORT_PHOTO', 'CONTENT', 'CLUB_REPORT', 'AVATAR'] })
  @IsIn(['REPORT_PHOTO', 'CONTENT', 'CLUB_REPORT', 'AVATAR'])
  purpose!: 'REPORT_PHOTO' | 'CONTENT' | 'CLUB_REPORT' | 'AVATAR';
  @ApiProperty({ enum: [...UPLOAD_IMAGE_TYPES, 'application/pdf'] })
  @IsIn([...UPLOAD_IMAGE_TYPES, 'application/pdf'])
  contentType!: string;
  @ApiProperty({ minimum: 1, maximum: UPLOAD_PDF_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(UPLOAD_PDF_MAX_BYTES)
  sizeBytes!: number;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() tripId?: string;
}
class PresignResponseDto {
  @ApiProperty() url!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) fields!: Record<
    string,
    string
  >;
  @ApiProperty({ format: 'uuid' }) uploadId!: string;
  @ApiProperty() fileUrl!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
  @ApiProperty() maxSizeBytes!: number;
}
class FilePreviewResponseDto {
  @ApiProperty() url!: string;
}
@ApiTags('uploads')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ApiErrorDto })
@Roles(UserRole.CANDIDATE, UserRole.VOLUNTEER)
@Controller('uploads')
export class StorageController {
  constructor(private readonly storage: StorageService) {}
  @Post('presign') @HttpCode(200) @ApiOkResponse({ type: PresignResponseDto }) presign(
    @CurrentUser() actor: Actor,
    @Body() dto: PresignDto,
  ) {
    return this.storage.presign(actor, dto);
  }
  @Get(':id/preview')
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: FilePreviewResponseDto })
  async preview(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return { url: await this.storage.download(id, actor) };
  }
}
@ApiTags('files')
@Public()
@UseGuards(OptionalJwtGuard)
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}
  @Get(':id')
  @ApiResponse({ status: 302, description: 'Краткосрочная ссылка на разрешенный объект S3.' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    res.redirect(302, await this.storage.download(id, req.user));
  }
}
