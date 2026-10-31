import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@club/shared';
import { ContentService, cleanHtml } from './content.service.js';
import { ApiException } from '../common/api-exception.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/audit.service.js';
import type { StorageService } from '../storage/storage.service.js';
import type { Actor } from '../common/http.js';

const verify = vi.fn();
const transaction = vi.fn();
const service = new ContentService(
  { $transaction: transaction } as unknown as PrismaService,
  {} as AuditService,
  { verifyPublicUrl: verify } as unknown as StorageService,
);
const actor = { id: '11111111-1111-4111-8111-111111111111' } as Actor;
beforeEach(() => {
  verify.mockReset();
  transaction.mockReset();
});
describe('CMS HTML writes', () => {
  it.each(['', '<p><br></p>', '<p>&nbsp; &#160; &#xA0;</p>', '<script>alert(1)</script>'])(
    'normalizes empty sanitized HTML %s',
    (html) => {
      expect(cleanHtml(html)).toBe('');
    },
  );
  it('preserves image-only content and removes unsafe markup', () => {
    expect(cleanHtml('<p><img src="https://example.test/image.png" onerror="alert(1)"></p>')).toBe(
      '<p><img src="https://example.test/image.png" /></p>',
    );
  });
  it.each(['pages', 'news', 'interviews', 'projects'] as const)(
    'verifies every sanitized image source on %s, including relative links and HTML entities',
    async (resource) => {
      await service.write(actor, resource, {
        bodyHtml:
          '<p><img src="/api/v1/files/11111111-1111-4111-8111-111111111111"><img src="https://example.test/a.png?a=1&amp;b=2"><img src="https://example.test/a.png?a=1&amp;b=2"></p>',
      });
      expect(verify.mock.calls).toEqual([
        ['/api/v1/files/11111111-1111-4111-8111-111111111111', 'CONTENT'],
        ['https://example.test/a.png?a=1&b=2', 'CONTENT'],
      ]);
    },
  );
  it('rejects an invalid image before persisting the article', async () => {
    verify.mockRejectedValue(new ApiException(ErrorCode.VALIDATION_ERROR));
    await expect(
      service.write(actor, 'pages', {
        bodyHtml: '<img src="/api/v1/files/11111111-1111-4111-8111-111111111111">',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    expect(transaction).not.toHaveBeenCalled();
  });
});
