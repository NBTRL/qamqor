import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@club/shared';
import { Public, Roles, CurrentUser, type Actor } from '../common/http.js';
import { ApiErrorDto } from '../common/dto.js';
import { ApiPage, PageQueryDto } from '../common/query.dto.js';
import { PublicContentService } from './public-content.service.js';
import {
  AlbumResponseDto,
  ContactCreateDto,
  ContactPatchDto,
  ContactResponseDto,
  ContentQueryDto,
  InterviewResponseDto,
  MediaItemResponseDto,
  NewsResponseDto,
  PageResponseDto,
  PartnerResponseDto,
  PressResponseDto,
  ProjectResponseDto,
} from './content.dto.js';
import { ReportPhotoResponseDto } from '../club/club.dto.js';
class ReportFeedDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['CLUB', 'TRIP'] }) kind!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) publishedAt!: Date;
  @ApiPropertyOptional() year?: number;
  @ApiPropertyOptional() fileUrl?: string;
  @ApiPropertyOptional({ format: 'uuid' }) tripId?: string;
  @ApiPropertyOptional() text?: string;
  @ApiPropertyOptional({ type: String }) hoursSpent?: string;
  @ApiPropertyOptional({ type: [ReportPhotoResponseDto] }) photos?: ReportPhotoResponseDto[];
}
class ContactReceiptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['NEW'] }) status!: string;
}
@ApiTags('public-content')
@Public()
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller()
export class PublicContentController {
  constructor(private readonly content: PublicContentService) {}
  @Get('news') @ApiPage(NewsResponseDto) news(@Query() query: PageQueryDto) {
    return this.content.news(query);
  }
  @Get('news/:slug') @ApiOkResponse({ type: NewsResponseDto }) newsDetail(
    @Param('slug') slug: string,
  ) {
    return this.content.newsDetail(slug);
  }
  @Get('pages/:slug') @ApiOkResponse({ type: PageResponseDto }) page(@Param('slug') slug: string) {
    return this.content.page(slug);
  }
  @Get('albums') @ApiPage(AlbumResponseDto) albums(@Query() query: PageQueryDto) {
    return this.content.albums(query);
  }
  @Get('albums/:slug') @ApiOkResponse({ type: AlbumResponseDto }) album(
    @Param('slug') slug: string,
  ) {
    return this.content.album(slug);
  }
  @Get('interviews') @ApiPage(InterviewResponseDto) interviews(@Query() query: PageQueryDto) {
    return this.content.interviews(query);
  }
  @Get('interviews/:slug') @ApiOkResponse({ type: InterviewResponseDto }) interview(
    @Param('slug') slug: string,
  ) {
    return this.content.interview(slug);
  }
  @Get('projects') @ApiPage(ProjectResponseDto) projects(@Query() query: PageQueryDto) {
    return this.content.projects(query);
  }
  @Get('videos') @ApiPage(MediaItemResponseDto) videos(@Query() query: PageQueryDto) {
    return this.content.videos(query);
  }
  @Get('partners') @ApiPage(PartnerResponseDto) partners(@Query() query: PageQueryDto) {
    return this.content.partners(query);
  }
  @Get('press') @ApiPage(PressResponseDto) press(@Query() query: PageQueryDto) {
    return this.content.press(query);
  }
  @Get('public/reports') @ApiPage(ReportFeedDto) reports(@Query() query: PageQueryDto) {
    return this.content.reports(query);
  }
  @Post('contact-requests')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiCreatedResponse({ type: ContactReceiptDto })
  contact(@Body() dto: ContactCreateDto) {
    return this.content.contact(dto);
  }
}
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('admin/contact-requests')
export class AdminContactsController {
  constructor(private readonly content: PublicContentService) {}
  @Get() @ApiPage(ContactResponseDto) contacts(@Query() query: ContentQueryDto) {
    return this.content.contacts(query);
  }
  @Patch(':id') @ApiOkResponse({ type: ContactResponseDto }) update(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContactPatchDto,
  ) {
    return this.content.contactUpdate(actor, id, dto);
  }
}
