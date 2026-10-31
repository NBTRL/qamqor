import { IsDateTime } from '../common/date-time.validator.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsDecimal,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateIf,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { NewsStatus, ContactRequestStatus, CONSENT_VERSION } from '@club/shared';
import { PageQueryDto } from '../common/query.dto.js';

export class ContentQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ maxLength: 32 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(32)
  status?: string;
  @ApiPropertyOptional({ minimum: 1900, maximum: 2200, type: 'integer' })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? Number(value) : value))
  @IsInt()
  @Min(1900)
  @Max(2200)
  year?: number;
}
export class PageWriteDto {
  @ApiProperty({ maxLength: 150, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(150)
  slug!: string;
  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;
  @ApiProperty({ maxLength: 100000 }) @IsString() @MaxLength(100000) bodyHtml!: string;
}
export class NewsWriteDto extends PageWriteDto {
  @ApiProperty({ maxLength: 1000 }) @IsString() @MaxLength(1000) excerpt!: string;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000, format: 'uri' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  coverUrl?: string | null;
  @ApiPropertyOptional({ enum: NewsStatus })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(NewsStatus)
  status?: NewsStatus;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateTime()
  publishedAt?: string | null;
}
export class InterviewWriteDto extends PageWriteDto {
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000, format: 'uri' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  coverUrl?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateTime()
  publishedAt?: string | null;
}
export class ProjectWriteDto extends PageWriteDto {
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000, format: 'uri' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  coverUrl?: string | null;
  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
export class AlbumWriteDto {
  @ApiProperty({ maxLength: 150, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(150)
  slug!: string;
  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;
  @ApiPropertyOptional({ maxLength: 10000 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000, format: 'uri' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  coverUrl?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateTime()
  publishedAt?: string | null;
}
export class MediaItemWriteDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() albumId!: string;
  @ApiProperty({ enum: ['PHOTO', 'VIDEO'], enumName: 'MediaType' })
  @IsIn(['PHOTO', 'VIDEO'])
  type!: 'PHOTO' | 'VIDEO';
  @ApiProperty({
    maxLength: 2000,
    format: 'uri',
    description:
      'Ссылка на фото или видео выбранного типа. Управляемые изображения недопустимы для VIDEO. При смене типа нужна новая ссылка.',
  })
  @IsString()
  @MaxLength(2000)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  url!: string;
  @ApiPropertyOptional({ maxLength: 1000 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  caption?: string;
  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isPublic?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 100000, type: 'integer' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}
export class PartnerWriteDto {
  @ApiProperty({ maxLength: 150, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(150)
  slug!: string;
  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000, format: 'uri' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  logoUrl?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000, format: 'uri' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  websiteUrl?: string | null;
  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 100000, type: 'integer' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}
export class PressWriteDto {
  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;
  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  outlet!: string;
  @ApiProperty({ maxLength: 2000, format: 'uri' })
  @IsString()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url!: string;
  @ApiProperty({ format: 'date-time' })
  @IsDateTime()
  publishedAt!: string;
}
export class ClubReportWriteDto {
  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;
  @ApiProperty({ minimum: 1900, maximum: 2200, type: 'integer' })
  @IsInt()
  @Min(1900)
  @Max(2200)
  year!: number;
  @ApiProperty({ maxLength: 2000, format: 'uri' })
  @IsString()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  fileUrl!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateTime()
  publishedAt?: string | null;
}
export class DonationWriteDto {
  @ApiProperty({ type: String, example: '1500.00', maxLength: 15 })
  @IsString()
  @MaxLength(15)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  amount!: string;
  @ApiPropertyOptional({ default: 'RUB', pattern: '^[A-Z]{3}$' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  donorName?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string | null;
  @ApiProperty({ format: 'date-time' })
  @IsDateTime()
  receivedAt!: string;
}
export class ContactPatchDto {
  @ApiPropertyOptional({ enum: ContactRequestStatus })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(ContactRequestStatus)
  status?: ContactRequestStatus;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  adminNote?: string | null;
}
export class ContactCreateDto {
  @ApiProperty() @Allow() name!: string;
  @ApiProperty() @Allow() contact!: string;
  @ApiProperty() @Allow() message!: string;
  @ApiProperty({ enum: [true] }) @Allow() personalDataConsent!: true;
  @ApiProperty({ example: CONSENT_VERSION }) @Allow() consentVersion!: string;
}
export class PageResponseDto extends PageWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class NewsResponseDto extends NewsWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}
export class InterviewResponseDto extends InterviewWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class ProjectResponseDto extends ProjectWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class AlbumResponseDto extends AlbumWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ type: () => [MediaItemResponseDto] }) items?: object[];
}
export class MediaItemResponseDto extends MediaItemWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class PartnerResponseDto extends PartnerWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class PressResponseDto extends PressWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class ClubReportResponseDto extends ClubReportWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class DonationResponseDto extends DonationWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) createdById!: string;
}
export class ContactResponseDto extends ContactPatchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() contact!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}
