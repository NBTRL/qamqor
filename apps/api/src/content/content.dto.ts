import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsDateString,
  IsDecimal,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) status?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? Number(value) : value))
  @IsInt()
  @Min(1900)
  @Max(2200)
  year?: number;
}
export class PageWriteDto {
  @ApiProperty() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(150) slug!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @MaxLength(100000) bodyHtml!: string;
}
export class NewsWriteDto extends PageWriteDto {
  @ApiProperty() @IsString() @MaxLength(1000) excerpt!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(/^https?:\/\//)
  coverUrl?: string | null;
  @ApiPropertyOptional({ enum: NewsStatus }) @IsOptional() @IsEnum(NewsStatus) status?: NewsStatus;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;
}
export class InterviewWriteDto extends PageWriteDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(/^https?:\/\//)
  coverUrl?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;
}
export class ProjectWriteDto extends PageWriteDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(/^https?:\/\//)
  coverUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class AlbumWriteDto {
  @ApiProperty() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(150) slug!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(/^https?:\/\//)
  coverUrl?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;
}
export class MediaItemWriteDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() albumId!: string;
  @ApiProperty({ enum: ['PHOTO', 'VIDEO'], enumName: 'MediaType' })
  @IsIn(['PHOTO', 'VIDEO'])
  type!: 'PHOTO' | 'VIDEO';
  @ApiProperty() @IsString() @MaxLength(2000) @Matches(/^https?:\/\//) url!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) caption?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class PartnerWriteDto {
  @ApiProperty() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(150) slug!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\//)
  @MaxLength(2000)
  logoUrl?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\//)
  @MaxLength(2000)
  websiteUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class PressWriteDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) outlet!: string;
  @ApiProperty() @IsString() @Matches(/^https?:\/\//) @MaxLength(2000) url!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() publishedAt!: string;
}
export class ClubReportWriteDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @ApiProperty() @IsInt() @Min(1900) @Max(2200) year!: number;
  @ApiProperty() @IsString() @Matches(/^https?:\/\//) @MaxLength(2000) fileUrl!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;
}
export class DonationWriteDto {
  @ApiProperty({ type: String, example: '1500.00' })
  @IsString()
  @MaxLength(15)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  amount!: string;
  @ApiPropertyOptional({ default: 'RUB' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  donorName?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string | null;
  @ApiProperty({ format: 'date-time' }) @IsDateString() receivedAt!: string;
}
export class ContactPatchDto {
  @ApiPropertyOptional({ enum: ContactRequestStatus })
  @IsOptional()
  @IsEnum(ContactRequestStatus)
  status?: ContactRequestStatus;
  @ApiPropertyOptional({ nullable: true, type: String })
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
