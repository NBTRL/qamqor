import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@club/shared';
import { CurrentUser, Public, Roles, type Actor, type AuthRequest } from '../common/http.js';
import { ApiErrorDto } from '../common/dto.js';
import { ApiPage, PageQueryDto } from '../common/query.dto.js';
import { CuratorOfPlaceGuard, CuratorScope, OptionalJwtGuard } from '../auth/guards.js';
import { PlacesService } from './places.service.js';
import { TripsService } from './trips.service.js';
import { ApplicationsService } from './applications.service.js';
import { EventsService, OpenDaysService } from './events.service.js';
import { MembershipService } from './membership.service.js';
import {
  ApplicationResponseDto,
  CalendarItemDto,
  CalendarQueryDto,
  CuratorRegistrationDto,
  EventQueryDto,
  EventResponseDto,
  MeRegistrationResponseDto,
  NeedResponseDto,
  NeedQueryDto,
  NeedsWriteDto,
  OpenDayResponseDto,
  RegionResponseDto,
  OpenDayRegistrationResponseDto,
  PlaceQueryDto,
  PlaceResponseDto,
  QuestionnaireDto,
  RegistrationResponseDto,
  RegistrationStatusDto,
  ReportResponseDto,
  ReportWriteDto,
  TripCreateDto,
  TripDetailsDto,
  TripPatchBodyDto,
  TripPatchDto,
  TripQueryDto,
  TripRegistrationDto,
  TripResponseDto,
  TripStatusDto,
} from './club.dto.js';

@ApiTags('places')
@Public()
@UseGuards(OptionalJwtGuard)
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}
  @Get() @ApiPage(PlaceResponseDto) list(@Query() query: PlaceQueryDto, @Req() req: AuthRequest) {
    return this.places.list(query, req.user);
  }
  @Get(':slug') @ApiOkResponse({ type: PlaceResponseDto }) detail(
    @Param('slug') slug: string,
    @Req() req: AuthRequest,
  ) {
    return this.places.detail(slug, req.user);
  }
}
@ApiTags('trips')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}
  @Get() @ApiPage(TripResponseDto) list(@CurrentUser() user: Actor, @Query() query: TripQueryDto) {
    return this.trips.list(user, query);
  }
  @Get(':id') @ApiOkResponse({ type: TripDetailsDto }) detail(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.trips.detail(user, id);
  }
  @Post(':id/register')
  @Roles(UserRole.VOLUNTEER)
  @ApiCreatedResponse({ type: RegistrationResponseDto })
  register(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TripRegistrationDto,
  ) {
    return this.trips.register(user, id, dto.comment);
  }
  @Delete(':id/register') @ApiOkResponse({ type: RegistrationResponseDto }) cancel(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.trips.cancelOwn(user, id);
  }
}
@ApiTags('curator')
@ApiBearerAuth()
@Roles(UserRole.VOLUNTEER)
@UseGuards(CuratorOfPlaceGuard)
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('curator')
export class CuratorController {
  constructor(
    private readonly trips: TripsService,
    private readonly places: PlacesService,
  ) {}
  @Get('trips') @CuratorScope('any') @ApiPage(TripResponseDto) ownTrips(
    @CurrentUser() user: Actor,
    @Query() query: TripQueryDto,
  ) {
    return this.trips.list(user, query, true);
  }
  @Get('places') @CuratorScope('any') @ApiPage(PlaceResponseDto) ownPlaces(
    @CurrentUser() user: Actor,
    @Query() query: PageQueryDto,
  ) {
    return this.places.curatorPlaces(user, query);
  }
  @Get('places/:id/needs') @CuratorScope('place') @ApiPage(NeedResponseDto) ownNeeds(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.places.ownNeeds(user, id, query);
  }
  @Post('trips') @CuratorScope('createTrip') @ApiCreatedResponse({ type: TripDetailsDto }) create(
    @CurrentUser() user: Actor,
    @Body() dto: TripCreateDto,
  ) {
    return this.trips.create(user, dto);
  }
  @Patch('trips/:id') @CuratorScope('trip') @ApiOkResponse({ type: TripDetailsDto }) update(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TripPatchDto,
  ) {
    return this.trips.update(user, id, dto);
  }
  @Patch('trips') @CuratorScope('trip') @ApiOkResponse({ type: TripDetailsDto }) updateBody(
    @CurrentUser() user: Actor,
    @Body() dto: TripPatchBodyDto,
  ) {
    const { id, ...patch } = dto;
    return this.trips.update(user, id, patch);
  }
  @Post('trips/:id/status')
  @HttpCode(200)
  @CuratorScope('trip')
  @ApiOkResponse({ type: TripDetailsDto })
  status(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TripStatusDto,
  ) {
    return this.trips.changeStatus(user, id, dto.status, dto.cancelReason);
  }
  @Get('trips/:id/registrations')
  @CuratorScope('trip')
  @ApiPage(CuratorRegistrationDto)
  registrations(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.trips.participants(user, id, query);
  }
  @Patch('registrations/:id')
  @CuratorScope('registration')
  @ApiOkResponse({ type: RegistrationResponseDto })
  registration(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrationStatusDto,
  ) {
    return this.trips.changeRegistration(user, id, dto.status);
  }
  @Put('trips/:id/report') @CuratorScope('trip') @ApiOkResponse({ type: ReportResponseDto }) report(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportWriteDto,
  ) {
    return this.trips.report(user, id, dto);
  }
  @Patch('places/:id/needs') @CuratorScope('place') @ApiPage(NeedResponseDto) needs(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NeedsWriteDto,
  ) {
    return this.places.needs(user, id, dto);
  }
}
@ApiTags('events')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}
  @Get() @ApiPage(EventResponseDto) list(@Query() query: EventQueryDto) {
    return this.events.list(query);
  }
  @Get(':id') @ApiOkResponse({ type: EventResponseDto }) detail(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.detail(id);
  }
  @Post(':id/register') @ApiCreatedResponse({ type: RegistrationResponseDto }) register(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.register(user, id);
  }
  @Delete(':id/register') @ApiOkResponse({ type: RegistrationResponseDto }) cancel(
    @CurrentUser() user: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.cancel(user, id);
  }
}
@ApiTags('membership')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('me')
export class MembershipController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly days: OpenDaysService,
    private readonly memberships: MembershipService,
  ) {}
  @Get('application') @ApiOkResponse({ type: ApplicationResponseDto }) application(
    @CurrentUser() user: Actor,
  ) {
    return this.applications.mine(user);
  }
  @Put('application') @ApiOkResponse({ type: ApplicationResponseDto }) questionnaire(
    @CurrentUser() user: Actor,
    @Body() dto: QuestionnaireDto,
  ) {
    return this.applications.questionnaire(user, dto);
  }
  @Get('registrations') @ApiPage(MeRegistrationResponseDto) registrations(
    @CurrentUser() user: Actor,
    @Query() query: PageQueryDto,
  ) {
    return this.memberships.list(user, query);
  }
  @Post('open-days/:id/register')
  @ApiCreatedResponse({ type: OpenDayRegistrationResponseDto })
  registerDay(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.days.register(user, id);
  }
  @Delete('open-days/:id/register')
  @ApiOkResponse({ type: OpenDayRegistrationResponseDto })
  cancelDay(@CurrentUser() user: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.days.cancel(user, id);
  }
}
@ApiTags('calendar')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('calendar')
export class CalendarController {
  constructor(private readonly events: EventsService) {}
  @Get() @ApiPage(CalendarItemDto) calendar(
    @CurrentUser() user: Actor,
    @Query() query: CalendarQueryDto,
  ) {
    return this.events.calendar(query, user);
  }
}
@ApiTags('public')
@Public()
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller()
export class PublicClubController {
  constructor(
    private readonly places: PlacesService,
    private readonly days: OpenDaysService,
    private readonly events: EventsService,
  ) {}
  @Get('public/regions') @ApiPage(RegionResponseDto) regions(@Query() query: PageQueryDto) {
    return this.places.regions(query);
  }
  @Get('needs') @ApiPage(NeedResponseDto) needs(@Query() query: NeedQueryDto) {
    return this.places.publicNeeds(query);
  }
  @Get('open-days') @ApiPage(OpenDayResponseDto) daysList(@Query() query: PageQueryDto) {
    return this.days.list(query);
  }
  @Get('public/calendar') @ApiPage(CalendarItemDto) calendar(@Query() query: CalendarQueryDto) {
    return this.events.calendar(query);
  }
}
