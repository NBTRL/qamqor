import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  type Type,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { UserRole } from '@club/shared';
import { CurrentUser, Roles, type Actor } from '../common/http.js';
import { StrictValidationPipe } from '../common/strict-validation.pipe.js';
import { ApiErrorDto } from '../common/dto.js';
import { ApiPage, OkDto } from '../common/query.dto.js';
import { ContentService, type ResourceName } from './content.service.js';
import {
  AlbumResponseDto,
  AlbumWriteDto,
  ClubReportResponseDto,
  ClubReportWriteDto,
  ContentQueryDto,
  DonationResponseDto,
  DonationWriteDto,
  InterviewResponseDto,
  InterviewWriteDto,
  MediaItemResponseDto,
  MediaItemWriteDto,
  NewsResponseDto,
  NewsWriteDto,
  PageResponseDto,
  PageWriteDto,
  PartnerResponseDto,
  PartnerWriteDto,
  PressResponseDto,
  PressWriteDto,
  ProjectResponseDto,
  ProjectWriteDto,
} from './content.dto.js';

function crud(
  name: ResourceName,
  createDto: Type<object>,
  responseDto: Type<object>,
): Type<object> {
  const patchDto = PartialType(createDto);
  const pipe = (expectedType: Type<object>) =>
    new StrictValidationPipe({
      expectedType,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    });
  @ApiTags('admin-content')
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN)
  @ApiDefaultResponse({ type: ApiErrorDto })
  @Controller(`admin/${name}`)
  class ContentController {
    constructor(@Inject(ContentService) private readonly content: ContentService) {}
    @Get() @ApiPage(responseDto) list(@Query() query: ContentQueryDto) {
      return this.content.list(name, query);
    }
    @Get(':id') @ApiOkResponse({ type: responseDto }) get(@Param('id', ParseUUIDPipe) id: string) {
      return this.content.get(name, id);
    }
    @Post() @ApiBody({ type: createDto }) @ApiCreatedResponse({ type: responseDto }) create(
      @CurrentUser() actor: Actor,
      @Body(pipe(createDto)) dto: Record<string, unknown>,
    ) {
      return this.content.write(actor, name, dto);
    }
    @Patch(':id') @ApiBody({ type: patchDto }) @ApiOkResponse({ type: responseDto }) update(
      @CurrentUser() actor: Actor,
      @Param('id', ParseUUIDPipe) id: string,
      @Body(pipe(patchDto)) dto: Record<string, unknown>,
    ) {
      return this.content.write(actor, name, dto, id);
    }
    @Delete(':id') @ApiOkResponse({ type: OkDto }) remove(
      @CurrentUser() actor: Actor,
      @Param('id', ParseUUIDPipe) id: string,
    ) {
      return this.content.remove(actor, name, id);
    }
  }
  Object.defineProperty(ContentController, 'name', {
    value: `Admin${name.replace(/(^|-)([a-z])/g, (_all, _separator: string, letter: string) => letter.toUpperCase())}ContentController`,
  });
  return ContentController;
}
export const contentControllers = [
  crud('news', NewsWriteDto, NewsResponseDto),
  crud('pages', PageWriteDto, PageResponseDto),
  crud('albums', AlbumWriteDto, AlbumResponseDto),
  crud('media-items', MediaItemWriteDto, MediaItemResponseDto),
  crud('interviews', InterviewWriteDto, InterviewResponseDto),
  crud('projects', ProjectWriteDto, ProjectResponseDto),
  crud('partners', PartnerWriteDto, PartnerResponseDto),
  crud('press', PressWriteDto, PressResponseDto),
  crud('club-reports', ClubReportWriteDto, ClubReportResponseDto),
  crud('donations', DonationWriteDto, DonationResponseDto),
];
