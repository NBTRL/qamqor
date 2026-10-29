import { describe, expect, it } from 'vitest';
import { fileReferences } from './file-references.js';
const id = '11111111-1111-4111-8111-111111111111';
const env = {
  WEB_URL: 'https://club.test',
  PUBLIC_API_URL: 'https://api.test',
  S3_BUCKET: 'files',
  S3_ENDPOINT: 'http://localhost:9000',
};
describe('managed file references', () => {
  it('recognizes local absolute and relative URLs and deduplicates HTML references', () => {
    expect(
      fileReferences(
        [
          `https://club.test/api/v1/files/${id}?x=1`,
          `<img src="/api/v1/files/${id}"><a href="https://api.test/api/v1/files/${id}/">File</a>`,
        ],
        env,
      ),
    ).toEqual([{ id }]);
  });
  it('decodes percent-encoded file identifiers', () => {
    expect(fileReferences(`/api/v1/files/%31${id.slice(1)}`, env)).toEqual([{ id }]);
  });
  it('recognizes canonical S3 URIs and signed path-style S3 URLs', () => {
    expect(
      fileReferences(
        [
          's3://files/private/test.png',
          'http://localhost:9000/files/private/test.png?X-Amz-Signature=fixture',
        ],
        env,
      ),
    ).toEqual([{ key: 'private/test.png' }]);
  });
  it('does not treat foreign origins, UUID prefixes, or another bucket as managed references', () => {
    expect(
      fileReferences(
        [
          `https://foreign.test/api/v1/files/${id}`,
          `/api/v1/files/${id}-extra`,
          's3://other/private/test.png',
        ],
        env,
      ),
    ).toEqual([]);
  });
  it('finds nested arrays and escaped attributes while ignoring plain unrelated text', () => {
    expect(
      fileReferences(
        {
          value: [{ body: `<p>Text</p><img src="/api/v1/files/${id}?x=1&amp;y=2">` }],
          title: 'not a file',
        },
        env,
      ),
    ).toEqual([{ id }]);
  });
});
