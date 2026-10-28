import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import { FilesController, StorageController } from './storage.controller.js';
@Global()
@Module({
  providers: [StorageService],
  controllers: [StorageController, FilesController],
  exports: [StorageService],
})
export class StorageModule {}
