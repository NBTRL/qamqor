import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@club/shared';
import { PageQueryDto } from '../common/query.dto.js';
import { MeResponseDto } from '../auth/auth.dto.js';
import { ApplicationResponseDto } from '../club/club.dto.js';

export class UserCreateDto {
  @ApiProperty({ type: String, pattern: '^[1-9]\\d{0,18}$' })
  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  telegramId!: string;
  @ApiProperty({ minLength: 2, maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;
  @ApiPropertyOptional({ enum: UserRole })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(UserRole)
  role?: UserRole;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 254, format: 'email' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
}
export class UserPatchDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 160 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName?: string;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  city?: string | null;
  @ApiPropertyOptional({ enum: UserRole })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(UserRole)
  role?: UserRole;
  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isBlocked?: boolean;
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 254, format: 'email' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
}
export class UserQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: UserRole })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(UserRole)
  role?: UserRole;
  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isBlocked?: boolean;
}
export class AdminUserResponseDto extends MeResponseDto {
  @ApiProperty() isBlocked!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) anonymizedAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) lastLoginAt!: Date | null;
}
export class CuratorAssignDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() placeId!: string;
}
export class CuratorResponseDto extends CuratorAssignDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class AdminApplicationResponseDto extends ApplicationResponseDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ nullable: true, type: String }) adminComment!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) reviewedById!: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) user?: object;
}
export class AttendanceUserDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId!: string;
  @ApiProperty() @IsBoolean() attended!: boolean;
}
export { OpenDayRegistrationResponseDto } from '../club/club.dto.js';
