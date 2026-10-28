import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { getEnvironment } from '../config/environment.js';

@Injectable()
export class CryptoService {
  private readonly secret = getEnvironment().JWT_SECRET;
  random(): string {
    return randomBytes(32).toString('base64url');
  }
  code(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }
  hash(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('hex');
  }
  equal(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  encrypt(value: object): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      createHash('sha256').update(this.secret).digest(),
      iv,
    );
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  }
  decrypt(value: string): unknown {
    const data = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      createHash('sha256').update(this.secret).digest(),
      data.subarray(0, 12),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'),
    ) as unknown;
  }
}
