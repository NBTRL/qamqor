import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service.js';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}
  async increment(key: string, ttl: number, limit: number, blockDuration: number, name: string) {
    const result = (await this.redis.client.eval(
      `
      local blocked=redis.call('PTTL',KEYS[2]);
      if blocked>0 then return {0,redis.call('PTTL',KEYS[1]),1,blocked} end;
      local hits=redis.call('INCR',KEYS[1]);
      if hits==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end;
      local remaining=redis.call('PTTL',KEYS[1]);
      if hits>tonumber(ARGV[2]) then redis.call('SET',KEYS[2],'1','PX',ARGV[3]);return {hits,remaining,1,tonumber(ARGV[3])} end;
      return {hits,remaining,0,0};
    `,
      2,
      this.redis.key(`throttle:${name}:${key}`),
      this.redis.key(`throttle-block:${name}:${key}`),
      ttl,
      limit,
      blockDuration || ttl,
    )) as number[];
    return {
      totalHits: Number(result[0]),
      timeToExpire: Math.max(0, Math.ceil(Number(result[1]) / 1000)),
      isBlocked: result[2] === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(Number(result[3]) / 1000)),
    };
  }
}
