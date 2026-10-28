import { Injectable, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { getEnvironment } from '../config/environment.js';
import { QueuesService } from './queues.service.js';
import { CryptoService } from './crypto.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const envelopeSchema = z
  .object({
    userId: z.uuid(),
    to: z.email(),
    subject: z.string(),
    text: z.string(),
    expiresAt: z.number(),
  })
  .strict();
@Injectable()
export class MailService implements OnApplicationShutdown {
  private readonly env = getEnvironment();
  private readonly transporter = nodemailer.createTransport({
    host: this.env.SMTP_HOST,
    port: this.env.SMTP_PORT,
    secure: this.env.SMTP_PORT === 465,
    auth: this.env.SMTP_USER ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASS } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  async deliver(to: string, subject: string, text: string): Promise<void> {
    await this.transporter.sendMail({ from: this.env.MAIL_FROM, to, subject, text });
  }
  onApplicationShutdown(): void {
    this.transporter.close();
  }
}
@Injectable()
export class AuthMailService implements OnModuleInit {
  private queue?: Queue<{ ciphertext: string }>;
  constructor(
    private readonly queues: QueuesService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
  ) {}
  onModuleInit(): void {
    if (this.queues.runtime.offline) return;
    this.queue = this.queues.queue('auth-mail');
    this.queues.worker<{ ciphertext: string }>(
      'auth-mail',
      async (job) => {
        const mail = envelopeSchema.parse(this.crypto.decrypt(job.data.ciphertext));
        const user = await this.prisma.user.findUnique({ where: { id: mail.userId } });
        if (!user || user.isBlocked || user.anonymizedAt || mail.expiresAt <= Date.now()) return;
        try {
          await this.mail.deliver(mail.to, mail.subject, mail.text);
        } catch {
          throw new Error('AUTH_EMAIL_DELIVERY_FAILED');
        }
      },
      { concurrency: 5 },
    );
  }
  async send(
    to: string,
    subject: string,
    text: string,
    userId: string,
    ttlSeconds = 300,
  ): Promise<void> {
    if (!this.queue) throw new Error('Почтовая очередь недоступна.');
    await this.queue.add('send', {
      ciphertext: this.crypto.encrypt({
        userId,
        to,
        subject,
        text,
        expiresAt: Date.now() + ttlSeconds * 1000,
      }),
    });
  }
}
