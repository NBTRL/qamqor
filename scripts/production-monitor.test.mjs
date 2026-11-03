import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProduction, validateRuntimeSummary } from './production-monitor.mjs';

function fixture() {
  const production = 'dpl_test';
  return {
    api: (path) =>
      path.includes('/daemons')
        ? {
            daemons: [
              {
                name: 'worker',
                scope: { type: 'target', value: 'production' },
                deploymentId: production,
                status: 'ready',
                instances: { desired: 1, ready: 1, total: 1, items: [{ alive: true }] },
              },
            ],
          }
        : {
            id: 'prj_T3Gc0oRzs9Tc6azNqkeg7QFVVZlt',
            accountId: 'team_ZpeBcU8O33dkdri3Ez2KuouL',
            targets: { production: { id: production, readyState: 'READY' } },
          },
    request: async () => ({ status: 200, json: async () => ({ status: 'ok' }) }),
    readErrors: async () => [{ type: 'summary', recordsReturned: 0, excludedIntervals: [] }],
    wait: async () => {},
    attempts: 1,
  };
}

test('checks public API, database-backed route, current production worker and runtime errors', async () => {
  const config = fixture();
  const paths = [];
  config.request = async (path) => {
    paths.push(path);
    return { status: 200, json: async () => ({ status: 'ok' }) };
  };
  assert.equal((await inspectProduction(config)).worker, '1/1');
  assert.deepEqual(
    paths.map((path) => new URL(path).pathname),
    ['/api/v1/health', '/api/v1/public/stats'],
  );
});

test('rejects an old deployment worker, missing instances and a false successful HTTP response', async () => {
  for (const change of [
    (config) => {
      const original = config.api;
      config.api = (path) => {
        const result = original(path);
        if (result.daemons) result.daemons[0].deploymentId = 'dpl_old';
        return result;
      };
    },
    (config) => {
      const original = config.api;
      config.api = (path) => {
        const result = original(path);
        if (result.daemons) result.daemons[0].instances.items = [];
        return result;
      };
    },
    (config) => {
      config.request = async () => ({ status: 200, json: async () => ({ error: 'not healthy' }) });
    },
  ]) {
    const config = fixture();
    change(config);
    await assert.rejects(inspectProduction(config));
  }
});

test('unknown or partial log coverage never reports a healthy production', () => {
  for (const records of [
    [],
    [{ type: 'summary', recordsReturned: 1 }],
    [{ type: 'summary', recordsReturned: 0, excludedIntervals: [{}] }],
  ])
    assert.throws(() => validateRuntimeSummary(records));
});

test('retries transient failures and suppresses raw credential or log details', async () => {
  const config = fixture();
  let reads = 0;
  config.attempts = 2;
  config.readErrors = async () => {
    if (++reads === 1) throw new Error('sensitive response detail');
    return [{ type: 'summary', recordsReturned: 0 }];
  };
  await inspectProduction(config);
  assert.equal(reads, 2);
  config.readErrors = async () => {
    throw new Error('sensitive response detail');
  };
  await assert.rejects(inspectProduction(config), { message: 'MONITOR_CHECK_FAILED' });
});
