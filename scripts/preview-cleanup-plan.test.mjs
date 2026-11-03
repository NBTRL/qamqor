import test from 'node:test';
import assert from 'node:assert/strict';
import { planClosedPreview } from './preview-cleanup-plan.mjs';

const pr = {
  number: 30,
  state: 'closed',
  head: { ref: 'feat/example', repo: { full_name: 'NBTRL/qamqor' } },
};
const preview = {
  uid: 'dpl_preview',
  state: 'READY',
  target: null,
  meta: { githubCommitRef: 'feat/example', githubCommitSha: 'a'.repeat(40) },
};

test('a closed PR produces only a plan for its own previews', () => {
  const result = planClosedPreview(pr, [
    preview,
    { ...preview, uid: 'dpl_production', target: 'production', meta: { githubCommitRef: 'main' } },
  ]);
  assert.equal(result.applied, false);
  assert.equal(result.mode, 'plan-only');
  assert.deepEqual(
    result.deployments.map((deployment) => deployment.id),
    ['dpl_preview'],
  );
});

test('open PRs, fork PRs, production refs, active or protected deployments stop planning', () => {
  assert.throws(() => planClosedPreview({ ...pr, state: 'open' }, [preview]));
  assert.throws(() =>
    planClosedPreview({ ...pr, head: { ...pr.head, repo: { full_name: 'other/qamqor' } } }, [
      preview,
    ]),
  );
  assert.throws(() => planClosedPreview({ ...pr, head: { ...pr.head, ref: 'main' } }, [preview]));
  for (const change of [
    { state: 'BUILDING' },
    { target: 'production' },
    { uid: 'dpl_8stb6sCABvW26eghCjMFjmqYZ6fd' },
  ])
    assert.throws(() => planClosedPreview(pr, [{ ...preview, ...change }]));
});
