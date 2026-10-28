import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { UsersService } from './users.service.js';
@Module({ providers: [AdminService, UsersService], controllers: [AdminController] })
export class AdminModule {}
