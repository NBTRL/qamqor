import { Module } from '@nestjs/common';
import { ContentService } from './content.service.js';
import { PublicContentService } from './public-content.service.js';
import { contentControllers } from './content.controller.js';
import { AdminContactsController, PublicContentController } from './public-content.controller.js';
import { StatsService } from './stats.service.js';
import { AdminStatsController, PublicStatsController } from './stats.controller.js';
@Module({
  providers: [ContentService, PublicContentService, StatsService],
  controllers: [
    ...contentControllers,
    PublicContentController,
    AdminContactsController,
    PublicStatsController,
    AdminStatsController,
  ],
})
export class ContentModule {}
