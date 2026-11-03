import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRetention } from './registry-retention.mjs';
import { publish } from './publish-vercel.mjs';

const sha = 'd0fde2ec379a7ffdad3c89710c751e8370d66d62';
const rollback = '7f041268b89d6b5acb883eec33fb115572ee50f4';
const tags = [
  sha.slice(0, 12),
  rollback.slice(0, 12),
  '5409b6483fc8',
  '31d83f43634c',
  '79d8fe627a7d',
];
function fixture(count = 45, fresh = false) {
  const make = () =>
    Array.from({ length: count }, (_, i) => ({
      id: `image_${i}`,
      tags: [tags[i] ?? i.toString(16).padStart(12, '0')],
      status: 'ready',
      kind: 'manifest',
      createdAt: new Date(Date.now() - (fresh ? 1000 : (i + 2) * 86400000)).toISOString(),
    }));
  const images = { api: make(), 'daemon.worker': make() };
  const writes = [];
  function api(path, method = 'GET', input) {
    if (method === 'POST') {
      writes.push({ method, body: JSON.parse(readFileSync(input, 'utf8')) });
      return { id: 'dpl_test', url: 'test.vercel.app' };
    }
    if (path.startsWith('/v9/projects/'))
      return {
        id: 'prj_T3Gc0oRzs9Tc6azNqkeg7QFVVZlt',
        accountId: 'team_ZpeBcU8O33dkdri3Ez2KuouL',
        name: 'qamqor',
        targets: { production: { readyState: 'READY', meta: { githubCommitSha: sha } } },
      };
    if (path.startsWith('/v6/deployments?'))
      return {
        deployments: [sha, rollback].map((commit) => ({
          state: 'READY',
          target: 'production',
          meta: { githubCommitSha: commit },
        })),
      };
    if (path.startsWith('/v13/deployments/'))
      return {
        id: 'dpl_test',
        projectId: 'prj_T3Gc0oRzs9Tc6azNqkeg7QFVVZlt',
        readyState: 'READY',
        url: 'test.vercel.app',
        meta: { githubCommitSha: sha },
      };
    const match = path.match(/^\/v1\/vcr\/repository\/([^/]+)\/images(?:\/([^?]+))?\?/);
    assert(match, 'Unexpected API request');
    const [, repo, id] = match;
    if (method === 'DELETE') {
      writes.push({ method, repo, id });
      images[repo] = images[repo].filter((image) => image.id !== id);
      return {};
    }
    return { images: images[repo] };
  }
  return { api, images, writes };
}
const quiet = () => {};
test('below 45 images neither repository is cleaned', () => {
  const f = fixture(44);
  runRetention(f.api, { apply: true, log: quiet });
  assert.equal(f.writes.length, 0);
});
test('45 triggers cleanup through 30, rechecking protection after each deletion', () => {
  const f = fixture();
  runRetention(f.api, { apply: true, log: quiet });
  for (const list of Object.values(f.images)) {
    assert.equal(list.length, 30);
    for (const tag of tags) assert(list.some((image) => image.tags.includes(tag)));
  }
  assert.equal(f.writes.length, 30);
});
test('capacity failure or API error prevents deployment creation', async () => {
  const f = fixture(45, true);
  await assert.rejects(
    publish({ api: f.api, sha, production: true, log: quiet }),
    /CAPACITY_BLOCKED/,
  );
  assert.equal(f.writes.length, 0);
  await assert.rejects(
    publish({
      api: () => {
        throw new Error('Unavailable');
      },
      sha,
      log: quiet,
    }),
    /Unavailable/,
  );
});
test('publication uses exact tested SHA after both repositories pass', async () => {
  const f = fixture();
  await publish({ api: f.api, sha, production: true, log: quiet });
  assert.equal(f.writes.at(-1).method, 'POST');
  assert.equal(f.writes.at(-1).body.gitSource.sha, sha);
  assert.equal(f.writes.at(-1).body.gitSource.ref, 'main');
  assert.equal(f.writes.at(-1).body.target, 'production');
});
test('dry run and invalid SHA never publish or delete', async () => {
  const f = fixture();
  await publish({ api: f.api, sha, dryRun: true, log: quiet });
  await assert.rejects(publish({ api: f.api, sha: 'main', log: quiet }), /exact tested commit/);
  assert.equal(f.writes.length, 0);
});
test('waits for queued deployment metadata and rejects a mismatched ready commit', async () => {
  const f = fixture(30);
  let reads = 0;
  const api = (path, ...args) => {
    const result = f.api(path, ...args);
    if (path.startsWith('/v13/deployments/')) {
      reads++;
      if (reads === 1) return { ...result, readyState: 'QUEUED', meta: {} };
    }
    return result;
  };
  await publish({ api, sha, production: true, wait: async () => {}, log: quiet });
  assert.equal(reads, 2);
  const wrong = (path, ...args) => {
    const result = f.api(path, ...args);
    return path.startsWith('/v13/deployments/')
      ? { ...result, meta: { githubCommitSha: rollback } }
      : result;
  };
  await assert.rejects(publish({ api: wrong, sha, log: quiet }), /does not match/);
});
