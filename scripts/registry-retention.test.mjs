import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRetention } from './registry-retention.mjs';

const now = Date.parse('2026-11-03T00:00:00Z');
const images = Array.from({ length: 50 }, (_, i) => ({
  id: `image_${i}`,
  tags: [i.toString(16).padStart(12, '0')],
  status: 'ready',
  kind: 'manifest',
  createdAt: new Date(now - (i + 2) * 86400000).toISOString(),
}));
test('keeps production and rollback even when they are oldest, reserves twenty slots', () => {
  const plan = planRetention(images, [images[49].tags[0], images[48].tags[0]], now);
  assert.equal(plan.length, 20);
  assert(!plan.some((image) => [49, 48].includes(Number(image.id.slice(6)))));
  assert(!plan.some((image) => Number(image.id.slice(6)) < 10));
});
test('fails closed when a protected image is absent', () => {
  assert.throws(() => planRetention(images, ['ffffffffffff'], now), /Protected image missing/);
});
test('preserves untagged, custom-tagged, recent and non-ready images', () => {
  const special = [
    { ...images[49], tags: [] },
    { ...images[48], tags: ['release'] },
    { ...images[47], createdAt: new Date(now - 1000).toISOString() },
    { ...images[46], status: 'pending' },
  ];
  const plan = planRetention([...images.slice(0, 46), ...special], [], now);
  assert(!plan.some((image) => special.some((item) => item.id === image.id)));
  assert.deepEqual(planRetention(images.slice(0, 30), [], now), []);
});
