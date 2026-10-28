import { Global, Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notification.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { PlacesService } from './places.service.js';
import { TripsService } from './trips.service.js';
import { ApplicationsService } from './applications.service.js';
import { EventsService, OpenDaysService } from './events.service.js';
import { MembershipService } from './membership.service.js';
import {
  CalendarController,
  CuratorController,
  EventsController,
  MembershipController,
  PlacesController,
  PublicClubController,
  TripsController,
} from './club.controller.js';
@Global()
@Module({
  imports: [NotificationModule, StorageModule],
  providers: [
    PlacesService,
    TripsService,
    ApplicationsService,
    EventsService,
    OpenDaysService,
    MembershipService,
  ],
  controllers: [
    PlacesController,
    TripsController,
    CuratorController,
    EventsController,
    MembershipController,
    CalendarController,
    PublicClubController,
  ],
  exports: [
    PlacesService,
    TripsService,
    ApplicationsService,
    EventsService,
    OpenDaysService,
    MembershipService,
  ],
})
export class ClubModule {}
