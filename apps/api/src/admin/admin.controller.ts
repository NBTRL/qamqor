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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@club/shared';
import { CurrentUser, Roles, type Actor } from '../common/http.js';
import { ApiErrorDto } from '../common/dto.js';
import { ApiPage, OkDto, PageQueryDto } from '../common/query.dto.js';
import { UsersService } from './users.service.js';
import { AdminService } from './admin.service.js';
import { ApplicationsService } from '../club/applications.service.js';
import { PlacesService } from '../club/places.service.js';
import { EventsService, OpenDaysService } from '../club/events.service.js';
import {
  AdminApplicationResponseDto,
  AdminUserResponseDto,
  AttendanceUserDto,
  CuratorAssignDto,
  CuratorResponseDto,
  OpenDayRegistrationResponseDto,
  UserCreateDto,
  UserPatchDto,
  UserQueryDto,
} from './admin.dto.js';
import {
  ApplicationDecisionDto,
  ApplicationQueryDto,
  EventPatchDto,
  EventQueryDto,
  EventResponseDto,
  EventWriteDto,
  OpenDayAttendanceDto,
  OpenDayPatchDto,
  OpenDayResponseDto,
  OpenDayWriteDto,
  PlacePatchDto,
  PlaceQueryDto,
  PlaceWriteDto,
  RegionDto,
  RegionPatchDto,
  RegionResponseDto,
  RegistrationResponseDto,
  RegistrationStatusDto,
} from '../club/club.dto.js';
class AdminPlaceDto extends PlaceWriteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
class AdminEventRegistrationDto extends RegistrationResponseDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'uuid' }) eventId!: string;
}
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly data: AdminService,
    private readonly applications: ApplicationsService,
    private readonly places: PlacesService,
    private readonly events: EventsService,
    private readonly days: OpenDaysService,
  ) {}
  @Get('users') @ApiPage(AdminUserResponseDto) usersList(@Query() query: UserQueryDto) {
    return this.users.list(query);
  }
  @Get('users/:id') @ApiOkResponse({ type: AdminUserResponseDto }) user(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.detail(id);
  }
  @Post('users') @ApiCreatedResponse({ type: AdminUserResponseDto }) userCreate(
    @CurrentUser() actor: Actor,
    @Body() dto: UserCreateDto,
  ) {
    return this.users.create(actor, dto);
  }
  @Patch('users/:id') @ApiOkResponse({ type: AdminUserResponseDto }) userUpdate(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UserPatchDto,
  ) {
    return this.users.update(actor, id, dto);
  }
  @Delete('users/:id') @ApiOkResponse({ type: OkDto }) userDelete(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.remove(actor, id);
  }
  @Get('curators') @ApiPage(CuratorResponseDto) curators(@Query() query: PageQueryDto) {
    return this.users.curators(query);
  }
  @Post('curators') @ApiCreatedResponse({ type: CuratorResponseDto }) assign(
    @CurrentUser() actor: Actor,
    @Body() dto: CuratorAssignDto,
  ) {
    return this.users.assign(actor, dto);
  }
  @Delete('curators/:id') @ApiOkResponse({ type: OkDto }) unassign(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.unassign(actor, id);
  }
  @Get('applications') @ApiPage(AdminApplicationResponseDto) applicationsList(
    @Query() query: ApplicationQueryDto,
  ) {
    return this.applications.list(query);
  }
  @Get('applications/:id') @ApiOkResponse({ type: AdminApplicationResponseDto }) application(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.applications.detail(id);
  }
  @Post('applications/:id/status')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminApplicationResponseDto })
  decision(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplicationDecisionDto,
  ) {
    return this.applications.decision(actor, id, dto);
  }
  @Patch('applications/:id') @ApiOkResponse({ type: AdminApplicationResponseDto }) decisionPatch(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplicationDecisionDto,
  ) {
    return this.applications.decision(actor, id, dto);
  }
  @Get('regions') @ApiPage(RegionResponseDto) regions(@Query() query: PageQueryDto) {
    return this.data.regions(query);
  }
  @Get('regions/:id') @ApiOkResponse({ type: RegionResponseDto }) region(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.data.region(id);
  }
  @Post('regions') @ApiCreatedResponse({ type: RegionResponseDto }) regionCreate(
    @CurrentUser() actor: Actor,
    @Body() dto: RegionDto,
  ) {
    return this.data.regionWrite(actor, dto);
  }
  @Patch('regions/:id') @ApiOkResponse({ type: RegionResponseDto }) regionUpdate(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegionPatchDto,
  ) {
    return this.data.regionWrite(actor, dto, id);
  }
  @Delete('regions/:id') @ApiOkResponse({ type: OkDto }) regionDelete(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.data.regionDelete(actor, id);
  }
  @Get('places') @ApiPage(AdminPlaceDto) placesList(@Query() query: PlaceQueryDto) {
    return this.data.places(query);
  }
  @Get('places/:id') @ApiOkResponse({ type: AdminPlaceDto }) place(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.data.place(id);
  }
  @Post('places') @ApiCreatedResponse({ type: AdminPlaceDto }) placeCreate(
    @CurrentUser() actor: Actor,
    @Body() dto: PlaceWriteDto,
  ) {
    return this.places.write(actor, dto);
  }
  @Patch('places/:id') @ApiOkResponse({ type: AdminPlaceDto }) placeUpdate(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlacePatchDto,
  ) {
    return this.places.write(actor, dto, id);
  }
  @Delete('places/:id') @ApiOkResponse({ type: OkDto }) placeDelete(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.data.placeDelete(actor, id);
  }
  @Get('events') @ApiPage(EventResponseDto) eventsList(@Query() query: EventQueryDto) {
    return this.events.list(query);
  }
  @Get('events/:id') @ApiOkResponse({ type: EventResponseDto }) event(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.detail(id);
  }
  @Post('events') @ApiCreatedResponse({ type: EventResponseDto }) eventCreate(
    @CurrentUser() actor: Actor,
    @Body() dto: EventWriteDto,
  ) {
    return this.events.write(actor, dto);
  }
  @Patch('events/:id') @ApiOkResponse({ type: EventResponseDto }) eventUpdate(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EventPatchDto,
  ) {
    return this.events.write(actor, dto, id);
  }
  @Delete('events/:id') @ApiOkResponse({ type: OkDto }) eventDelete(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.data.eventDelete(actor, id);
  }
  @Get('events/:id/registrations') @ApiPage(AdminEventRegistrationDto) eventRegistrations(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.data.eventRegistrations(id, query);
  }
  @Patch('event-registrations/:id')
  @ApiOkResponse({ type: RegistrationResponseDto })
  eventRegistrationStatus(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrationStatusDto,
  ) {
    return this.events.registrationStatus(actor, id, dto.status);
  }
  @Get('open-days') @ApiPage(OpenDayResponseDto) daysList(@Query() query: PageQueryDto) {
    return this.days.list(query, true);
  }
  @Get('open-days/:id') @ApiOkResponse({ type: OpenDayResponseDto }) day(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.data.day(id);
  }
  @Post('open-days') @ApiCreatedResponse({ type: OpenDayResponseDto }) dayCreate(
    @CurrentUser() actor: Actor,
    @Body() dto: OpenDayWriteDto,
  ) {
    return this.days.write(actor, dto);
  }
  @Patch('open-days/:id') @ApiOkResponse({ type: OpenDayResponseDto }) dayUpdate(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenDayPatchDto,
  ) {
    return this.days.write(actor, dto, id);
  }
  @Delete('open-days/:id') @ApiOkResponse({ type: OkDto }) dayDelete(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.data.dayDelete(actor, id);
  }
  @Get('open-days/:id/registrations') @ApiPage(OpenDayRegistrationResponseDto) dayRegistrations(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.data.dayRegistrations(id, query);
  }
  @Post('open-days/:id/attendance')
  @HttpCode(200)
  @ApiOkResponse({ type: OpenDayRegistrationResponseDto })
  attendanceUser(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttendanceUserDto,
  ) {
    return this.data.markAttendance(actor, id, dto.userId, dto.attended);
  }
  @Patch('open-day-registrations/:id')
  @ApiOkResponse({ type: OpenDayRegistrationResponseDto })
  attendance(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenDayAttendanceDto,
  ) {
    return this.days.attendance(actor, id, dto.attended);
  }
}
