import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { getEnvironment } from '../config/environment.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: getEnvironment().DATABASE_URL }) });
  }
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
