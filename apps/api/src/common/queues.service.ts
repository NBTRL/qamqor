import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type Processor, type WorkerOptions } from 'bullmq';
import { RUNTIME, type RuntimeOptions } from './runtime.module.js';
import { RedisService } from './redis.service.js';

@Injectable()
export class QueuesService implements OnModuleDestroy {
  private readonly queues: Array<() => Promise<void>> = [];
  private readonly workers: Array<() => Promise<void>> = [];
  private readonly logger = new Logger(QueuesService.name);
  constructor(
    private readonly redis: RedisService,
    @Inject(RUNTIME) readonly runtime: RuntimeOptions,
  ) {}
  queue<T>(name: string): Queue<T> {
    const queue = new Queue<T>(name, {
      connection: this.redis.connection,
      prefix: this.redis.prefix,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 604800, count: 5000 },
      },
    });
    queue.on('error', () => this.logger.warn('QUEUE_CONNECTION_ERROR'));
    this.queues.push(() => queue.close());
    return queue;
  }
  worker<T>(
    name: string,
    processor: Processor<T>,
    options: Partial<WorkerOptions> = {},
  ): Worker<T> | undefined {
    if (this.runtime.offline || !this.runtime.workers) return undefined;
    const worker = new Worker<T>(name, processor, {
      connection: this.redis.connection,
      prefix: this.redis.prefix,
      ...options,
    });
    worker.on('error', () => this.logger.warn('WORKER_CONNECTION_ERROR'));
    this.workers.push(() => worker.close());
    return worker;
  }
  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((close) => close()));
    await Promise.all(this.queues.map((close) => close()));
  }
}
