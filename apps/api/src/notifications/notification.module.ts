import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service.js';
import { ReminderService } from './reminder.service.js';
import {
  AdminNotificationsController,
  MyNotificationsController,
} from './notification.controller.js';
@Global()
@Module({
  providers: [NotificationService, ReminderService],
  controllers: [MyNotificationsController, AdminNotificationsController],
  exports: [NotificationService, ReminderService],
})
export class NotificationModule {}
