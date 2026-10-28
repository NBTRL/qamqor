import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CONSENT_VERSION, LoginTokenStatus, UserRole } from '@club/shared';

export class EmptyDto {}
export class LoginStatusQueryDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) token!: string;
}
export class CodeDto {
  @ApiProperty({ pattern: '^\\d{6}$' }) @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class EmailDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
export class EmailVerifyDto extends EmailDto {
  @ApiProperty() @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class VerifyEmailQueryDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
}
export class OnboardingDto {
  @ApiProperty({ format: 'date', example: '1998-01-01' }) @Allow() birthDate!: string;
  @ApiProperty({ example: CONSENT_VERSION }) @Allow() consentVersion!: string;
}
export class FakeTelegramDto extends LoginStatusQueryDto {
  @ApiProperty({ type: String }) @IsString() @Matches(/^[1-9]\d{0,18}$/) telegramId!: string;
  @ApiPropertyOptional({
    type: String,
    description: 'Для теста несовпадения собственного контакта.',
  })
  @IsOptional()
  @IsString()
  contactUserId?: string;
  @ApiProperty({ example: '+70000000001' })
  @IsString()
  @Matches(/^\+?[1-9]\d{6,14}$/)
  phone!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) fullName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) telegramUsername?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() confirm?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() contactOnly?: boolean;
}
export class MePatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(160) fullName?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  city?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  avatarUrl?: string | null;
}
export class TelegramStartResponseDto {
  @ApiProperty() token!: string;
  @ApiProperty() deepLink!: string;
  @ApiProperty() pollSecret!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
}
export class SessionResponseDto {
  @ApiProperty({ enum: LoginTokenStatus }) status!: LoginTokenStatus;
  @ApiPropertyOptional() accessToken?: string;
  @ApiPropertyOptional({ enum: ['Bearer'] }) tokenType?: string;
  @ApiPropertyOptional({ example: 900 }) expiresIn?: number;
  @ApiPropertyOptional({ enum: ['ADMIN_EMAIL_CODE'] }) nextStep?: string;
  @ApiPropertyOptional({ format: 'date-time' }) expiresAt?: Date;
}
export class MeResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, type: String }) telegramId!: string | null;
  @ApiProperty({ nullable: true, type: String }) telegramUsername!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty() fullName!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) nickname!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) avatarUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) city!: string | null;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiPropertyOptional({ nullable: true, type: String }) email!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  emailVerifiedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date' }) birthDate!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  consentAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String }) consentVersion!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  botBlockedAt!: Date | null;
  @ApiProperty() onboardingCompleted!: boolean;
  @ApiProperty({ type: [String], format: 'uuid' }) curatorPlaceIds!: string[];
}
