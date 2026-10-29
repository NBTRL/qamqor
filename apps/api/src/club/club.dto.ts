import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ApplicationStatus,
  EventType,
  HELP_AREAS,
  PlaceType,
  RegistrationStatus,
  TripStatus,
  WEEKDAYS,
} from '@club/shared';
import { PageQueryDto } from '../common/query.dto.js';

export class RegionDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @ApiProperty() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(100) slug!: string;
}
export class RegionResponseDto extends RegionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class PlaceWriteDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @ApiProperty() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(150) slug!: string;
  @ApiProperty({ enum: PlaceType }) @IsEnum(PlaceType) type!: PlaceType;
  @ApiProperty({ format: 'uuid' }) @IsUUID() regionId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) city!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  district?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;
  @ApiProperty() @IsString() @MaxLength(20000) description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) privateNotes?: string;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  beneficiariesCount?: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  coverImageUrl?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
export class PlacePatchDto extends PartialType(PlaceWriteDto) {}
export class RegionPatchDto extends PartialType(RegionDto) {}
export class PlaceQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() regionId?: string;
  @ApiPropertyOptional({ enum: PlaceType }) @IsOptional() @IsEnum(PlaceType) placeType?: PlaceType;
}
export class PlaceResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PlaceType }) type!: PlaceType;
  @ApiProperty({ type: RegionResponseDto }) region!: RegionResponseDto;
  @ApiProperty() city!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) district?: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true, type: String }) coverImage!: string | null;
  @ApiProperty() beneficiariesCount!: number;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Только VOLUNTEER/ADMIN после онбординга.',
  })
  address?: string | null;
  @ApiPropertyOptional({ description: 'Только VOLUNTEER/ADMIN после онбординга.' })
  privateNotes?: string;
  @ApiPropertyOptional({
    type: () => [NeedResponseDto],
    description: 'Первые активные нужды учреждения.',
  })
  needs?: NeedResponseDto[];
  @ApiPropertyOptional({ minimum: 0 }) needsTotal?: number;
}
export class NeedQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() placeId?: string;
}
export class TripQueryDto extends PlaceQueryDto {
  @ApiPropertyOptional({ enum: TripStatus, default: TripStatus.OPEN })
  @IsOptional()
  @IsEnum(TripStatus)
  status: TripStatus = TripStatus.OPEN;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() dateTo?: string;
}
export class TripCreateDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() placeId!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @MaxLength(20000) description!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() startsAt!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() endsAt!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) meetingPoint!: string;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @IsInt() @Min(1) @Max(1000) capacity!: number;
}
export class TripPatchDto extends PartialType(TripCreateDto) {}
export class TripStatusDto {
  @ApiProperty({ enum: TripStatus }) @IsEnum(TripStatus) status!: TripStatus;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  cancelReason?: string;
}
export class TripRegistrationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
export class RegistrationStatusDto {
  @ApiProperty({ enum: RegistrationStatus })
  @IsEnum(RegistrationStatus)
  status!: RegistrationStatus;
}
export class TripResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: PlaceResponseDto }) place!: PlaceResponseDto;
  @ApiProperty({ format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ format: 'date-time' }) endsAt!: Date;
  @ApiProperty() capacity!: number;
  @ApiProperty() confirmedCount!: number;
  @ApiProperty({ enum: TripStatus }) status!: TripStatus;
  @ApiPropertyOptional({ nullable: true, type: String }) cancelReason?: string | null;
  @ApiPropertyOptional({ description: 'Только VOLUNTEER/ADMIN.' }) meetingPoint?: string;
}
export class RegistrationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: RegistrationStatus }) status!: RegistrationStatus;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}
export class CuratorRegistrationDto extends RegistrationResponseDto {
  @ApiProperty() fullName!: string;
  @ApiProperty({ nullable: true, type: String }) nickname!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
}
export class NeedWriteDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() id?: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @MaxLength(2000) description!: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
export class NeedsWriteDto {
  @ApiProperty({ type: [NeedWriteDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NeedWriteDto)
  items!: NeedWriteDto[];
}
export class NeedResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) placeId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() isActive!: boolean;
}
export class PhotoReferenceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() uploadId!: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isPublic: boolean = false;
}
export class ReportWriteDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(30000) text!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) hoursSpent!: number;
  @ApiPropertyOptional({ type: [PhotoReferenceDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PhotoReferenceDto)
  photos: PhotoReferenceDto[] = [];
}
export class ReportPhotoResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() isPublic!: boolean;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Ссылка на исходную загрузку в закрытой карточке поездки.',
  })
  uploadId?: string;
}
export class ReportResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tripId!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ type: String, example: '3.50' }) hoursSpent!: string;
  @ApiProperty({ format: 'date-time' }) publishedAt!: Date;
  @ApiProperty({ type: [ReportPhotoResponseDto] }) photos!: ReportPhotoResponseDto[];
}
export class QuestionnaireDto {
  @ApiProperty() @Allow() motivation!: string;
  @ApiProperty() @Allow() volunteeringExperience!: string;
  @ApiProperty({ enum: HELP_AREAS, isArray: true }) @Allow() helpAreas!: string[];
  @ApiProperty({ enum: WEEKDAYS, isArray: true }) @Allow() availableWeekdays!: string[];
  @ApiProperty() @Allow() referralSource!: string;
  @ApiProperty({ enum: [true] }) @Allow() rulesAccepted!: true;
}
export class ApplicationDecisionDto {
  @ApiProperty({ enum: ApplicationStatus }) @IsEnum(ApplicationStatus) status!: ApplicationStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) comment?: string;
}
export class ApplicationQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
export class ApplicationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ApplicationStatus }) status!: ApplicationStatus;
  @ApiPropertyOptional({ type: QuestionnaireDto, nullable: true })
  questionnaire?: QuestionnaireDto | null;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  history!: object[];
  @ApiProperty() hasOpenDayAttended!: boolean;
}
export class OpenDayWriteDto {
  @ApiProperty({ format: 'date-time' }) @IsDateString() startsAt!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) location!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) capacity!: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  registrationUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}
export class OpenDayPatchDto extends PartialType(OpenDayWriteDto) {}
export class OpenDayResponseDto extends OpenDayWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class OpenDayAttendanceDto {
  @ApiProperty() @IsBoolean() attended!: boolean;
}
export class OpenDayRegistrationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty() attended!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) cancelledAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}
export class EventWriteDto {
  @ApiProperty({ enum: EventType }) @IsEnum(EventType) type!: EventType;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @MaxLength(20000) description!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() startsAt!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() endsAt!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) location!: string;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isPublic?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() volunteersOnly?: boolean;
}
export class EventPatchDto extends PartialType(EventWriteDto) {}
export class EventResponseDto extends EventWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class EventQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: EventType }) @IsOptional() @IsEnum(EventType) type?: EventType;
}
export class CalendarQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
}
export class CalendarItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: EventType }) type!: EventType;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: Date;
  @ApiPropertyOptional({ format: 'date-time' }) endsAt?: Date;
  @ApiPropertyOptional({ type: RegionResponseDto }) region?: RegionResponseDto;
  @ApiPropertyOptional({ type: PlaceResponseDto }) place?: PlaceResponseDto;
  @ApiPropertyOptional() meetingPoint?: string;
  @ApiPropertyOptional() location?: string;
}
export class TripDetailsDto extends TripResponseDto {
  @ApiPropertyOptional({ type: ReportResponseDto, nullable: true })
  report?: ReportResponseDto | null;
}
export class TripPatchBodyDto extends TripPatchDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
}
export class MeRegistrationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['TRIP', 'EVENT', 'OPEN_DAY'] }) kind!: string;
  @ApiProperty({ format: 'uuid' }) entityId!: string;
  @ApiProperty({ nullable: true, type: String, enum: RegistrationStatus })
  status!: RegistrationStatus | null;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: Date;
  @ApiPropertyOptional() attended?: boolean;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  cancelledAt?: Date | null;
  @ApiPropertyOptional({ type: PlaceResponseDto }) place?: PlaceResponseDto;
  @ApiPropertyOptional() meetingPoint?: string;
  @ApiPropertyOptional() location?: string;
}
