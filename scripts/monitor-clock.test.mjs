import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureNextCheck, githubApi } from './monitor-clock.mjs';

const now = Date.parse('2026-11-04T08:00:00Z');
function fixture(overrides = {}) {
  const calls = [];
  const config = {
    now,
    context: {
      repository: 'NBTRL/qamqor',
      ref: 'refs/heads/main',
      workflowRef: 'NBTRL/qamqor/.github/workflows/monitor.yml@refs/heads/main',
      runId: '100',
    },
    enabled: 'true',
    mode: 'now',
    calls,
    api: async (path, method = 'GET', body) => {
      calls.push({ path, method, body });
      if (method === 'POST') return;
      if (path.endsWith('/deployment-branch-policies'))
        return { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
      if (path.includes('/environments/')) {
        const testing = path.endsWith('-test');
        return {
          name: testing ? 'qamqor-monitor-clock-test' : 'qamqor-monitor-clock',
          protection_rules: [
            { type: 'wait_timer', wait_timer: testing ? 1 : 30 },
            { type: 'branch_policy' },
          ],
          deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        };
      }
      return { workflow_runs: [] };
    },
    ...overrides,
  };
  return config;
}

function run(overrides = {}) {
  return {
    id: 101,
    head_branch: 'main',
    event: 'workflow_dispatch',
    display_title: 'Qamqor production monitor / clock',
    status: 'waiting',
    created_at: '2026-11-04T07:40:00Z',
    ...overrides,
  };
}

test('dispatches only the trusted main clock with its required 30-minute timer', async () => {
  const config = fixture();
  assert.deepEqual(await ensureNextCheck(config), {
    clock: 'dispatched',
    mode: 'clock',
    waitMinutes: 30,
  });
  assert.deepEqual(
    config.calls.filter((call) => call.method === 'POST'),
    [
      {
        path: '/repos/NBTRL/qamqor/actions/workflows/monitor.yml/dispatches',
        method: 'POST',
        body: { ref: 'main', inputs: { mode: 'clock' } },
      },
    ],
  );
});

test('disable switch, foreign context and invalid test count never dispatch', async () => {
  for (const enabled of [undefined, '', 'false', 'TRUE']) {
    const config = fixture({ enabled });
    assert.deepEqual(await ensureNextCheck(config), { clock: 'disabled' });
    assert.equal(config.calls.length, 0);
  }
  for (const context of [
    { repository: 'someone/else' },
    { ref: 'refs/heads/feature' },
    { workflowRef: 'NBTRL/qamqor/.github/workflows/other.yml@refs/heads/main' },
  ]) {
    const config = fixture();
    config.context = { ...config.context, ...context };
    await assert.rejects(ensureNextCheck(config), { message: 'MONITOR_CLOCK_CONTEXT_REJECTED' });
    assert.equal(config.calls.length, 0);
  }
  await assert.rejects(ensureNextCheck(fixture({ mode: 'clock-test', testChecks: '3' })), {
    message: 'MONITOR_CLOCK_TEST_BOUND_REJECTED',
  });
});

test('a missing timer, changed timer or broader branch rule cannot create a rapid loop', async () => {
  for (const change of [
    (result) => {
      if (result.protection_rules) result.protection_rules = [];
    },
    (result) => {
      if (result.protection_rules) result.protection_rules[0].wait_timer = 0;
    },
    (result) => {
      if (result.branch_policies) result.branch_policies[0].name = '*';
    },
    (result) => {
      if (result.protection_rules) result.protection_rules.push({ type: 'required_reviewers' });
    },
  ]) {
    const config = fixture();
    const api = config.api;
    config.api = async (...args) => {
      const result = await api(...args);
      change(result);
      return result;
    };
    await assert.rejects(
      ensureNextCheck(config),
      /MONITOR_CLOCK_(ENVIRONMENT|BRANCH_RULE)_REJECTED/,
    );
    assert.equal(
      config.calls.some((call) => call.method === 'POST'),
      false,
    );
  }
});

test('deduplicates all active statuses, excludes this run and ignores unrelated work', async () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
    const config = fixture();
    const api = config.api;
    config.api = async (path, ...args) =>
      path.includes('/runs?')
        ? {
            workflow_runs: [
              run({ status }),
              run({ id: 100 }),
              run({ id: 102, head_branch: 'feature' }),
              run({ id: 103, display_title: 'Qamqor production monitor / now' }),
              run({ id: 104, status: 'completed' }),
            ],
          }
        : api(path, ...args);
    assert.deepEqual(await ensureNextCheck(config), { clock: 'already-pending', run: 101 });
    assert.equal(
      config.calls.some((call) => call.method === 'POST'),
      false,
    );
  }
});

test('stalled, duplicated or unreadable pending clocks fail visibly without dispatch', async () => {
  for (const runs of [
    [run({ created_at: '2026-11-04T05:00:00Z' })],
    [run(), run({ id: 102 })],
    [run({ status: 'unknown' })],
    undefined,
  ]) {
    const config = fixture();
    const api = config.api;
    config.api = async (path, ...args) =>
      path.includes('/runs?') ? { workflow_runs: runs } : api(path, ...args);
    await assert.rejects(ensureNextCheck(config), /MONITOR_CLOCK_/);
    assert.equal(
      config.calls.some((call) => call.method === 'POST'),
      false,
    );
  }
});

test('bounded test dispatches exactly one continuation then stops, independent of enable switch', async () => {
  const config = fixture({ mode: 'clock-test', enabled: 'false' });
  assert.equal((await ensureNextCheck(config)).waitMinutes, 1);
  assert.deepEqual(config.calls.find((call) => call.method === 'POST').body, {
    ref: 'main',
    inputs: { mode: 'clock-test', test_checks: '1' },
  });
  const last = fixture({ mode: 'clock-test', testChecks: '1' });
  assert.deepEqual(await ensureNextCheck(last), { clock: 'test-complete' });
  assert.equal(last.calls.length, 0);
});

test('GitHub requests keep credentials in headers, reject redirects and redact errors', async () => {
  const calls = [];
  const api = githubApi('test-secret', async (...args) => {
    calls.push(args);
    return { status: 204 };
  });
  await api('/repos/NBTRL/qamqor/actions/workflows/monitor.yml/dispatches', 'POST', {
    ref: 'main',
  });
  assert.equal(calls[0][0].includes('test-secret'), false);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-secret');
  assert.equal(calls[0][1].redirect, 'error');
  await assert.rejects(api('/repos/someone/else/actions'), /MONITOR_API_SCOPE_MISMATCH/);
  await assert.rejects(
    githubApi('test-secret', async () => {
      throw new Error('test-secret');
    })('/repos/NBTRL/qamqor/actions'),
    { message: 'MONITOR_GITHUB_REQUEST_FAILED' },
  );
  await assert.rejects(
    githubApi('test-secret', async () => ({ status: 403 }))('/repos/NBTRL/qamqor/actions'),
    { message: 'MONITOR_GITHUB_HTTP_403' },
  );
});
