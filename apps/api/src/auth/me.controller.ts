import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type Actor } from '../common/http.js';
import { ApiErrorDto } from '../common/dto.js';
import { OkDto } from '../common/query.dto.js';
import { AuthService } from './auth.service.js';
import { MeService } from './me.service.js';
import { EmailDto, MePatchDto, MeResponseDto, OnboardingDto } from './auth.dto.js';

@ApiTags('me')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('me')
export class MeController {
  constructor(
    private readonly meService: MeService,
    private readonly auth: AuthService,
  ) {}
  @Get() @ApiOkResponse({ type: MeResponseDto }) me(@CurrentUser() user: Actor) {
    return this.meService.me(user);
  }
  @Patch() @ApiOkResponse({ type: MeResponseDto }) patch(
    @CurrentUser() user: Actor,
    @Body() dto: MePatchDto,
  ) {
    return this.meService.patch(user, dto);
  }
  @Post('onboarding') @HttpCode(200) @ApiOkResponse({ type: MeResponseDto }) onboarding(
    @CurrentUser() user: Actor,
    @Body() dto: OnboardingDto,
  ) {
    return this.meService.onboarding(user, dto);
  }
  @Post('email')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  @ApiOkResponse({ type: OkDto })
  email(@CurrentUser() user: Actor, @Body() dto: EmailDto) {
    return this.auth.requestEmail(user, dto.email);
  }
  @Delete('email') @ApiOkResponse({ type: OkDto }) removeEmail(@CurrentUser() user: Actor) {
    return this.meService.removeEmail(user);
  }
  @Delete() @ApiOkResponse({ type: OkDto }) remove(@CurrentUser() user: Actor) {
    return this.meService.anonymize(user);
  }
}
