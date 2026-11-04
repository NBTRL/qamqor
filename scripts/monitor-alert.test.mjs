import test from 'node:test';
import assert from 'node:assert/strict';
import { syncMonitorIssue } from './monitor-alert.mjs';

const marker = '<!-- qamqor-production-monitor:v1 -->';
function fixture({ conclusion = 'failure', testing = false, issues = [] } = {}) {
  const calls = [];
  const run = {
    id: 100,
    workflow_id: 405941521,
    path: '.github/workflows/monitor.yml',
    head_branch: 'main',
    head_repository: { full_name: 'NBTRL/qamqor' },
    display_title: `Qamqor production monitor / ${testing ? 'clock-test' : 'clock'}`,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion,
    updated_at: '2026-11-04T08:00:00Z',
  };
  return {
    runId: 100,
    calls,
    run,
    api: async (path, method = 'GET', body) => {
      calls.push({ path, method, body });
      if (method === 'POST') return { number: 40 };
      if (method === 'PATCH') return { number: 40, state: 'closed' };
      if (path.endsWith('/actions/runs/100')) return run;
      if (path.includes('/runs?')) return { workflow_runs: [run] };
      return issues;
    },
  };
}

function incident(overrides = {}) {
  return {
    number: 40,
    title: '[monitor] Сбой проверки production Qamqor',
    user: { login: 'github-actions[bot]' },
    body: `${marker}\n\nFailure`,
    ...overrides,
  };
}

test('one failure issue mentions only the owner and contains no raw logs or response bodies', async () => {
  const config = fixture();
  assert.deepEqual(await syncMonitorIssue(config), { notification: 'incident-opened', issue: 40 });
  const writes = config.calls.filter((call) => call.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/repos/NBTRL/qamqor/issues');
  assert.deepEqual(writes[0].body.assignees, ['NBTRL']);
  assert.match(writes[0].body.body, /@NBTRL/);
  assert.match(writes[0].body.body, /https:\/\/github.com\/NBTRL\/qamqor\/actions\/runs\/100/);
});

test('repeated failures produce no new issue, comment or update', async () => {
  const config = fixture({ issues: [incident()] });
  assert.equal((await syncMonitorIssue(config)).notification, 'incident-already-open');
  assert.equal(
    config.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('healthy monitoring is silent; recovery closes only its own bot issue', async () => {
  const quiet = fixture({
    conclusion: 'success',
    issues: [incident({ user: { login: 'NBTRL' } })],
  });
  assert.equal((await syncMonitorIssue(quiet)).notification, 'healthy-no-message');
  assert.equal(
    quiet.calls.some((call) => call.method !== 'GET'),
    false,
  );
  const recovered = fixture({ conclusion: 'success', issues: [incident()] });
  assert.equal((await syncMonitorIssue(recovered)).notification, 'incident-closed');
  const write = recovered.calls.find((call) => call.method === 'PATCH');
  assert.equal(write.path, '/repos/NBTRL/qamqor/issues/40');
  assert.equal(write.body.state, 'closed');
  assert.match(write.body.body, /Восстановлено/);
});

test('a bounded self-test has its own explicitly marked incident and cannot close production incidents', async () => {
  const config = fixture({ testing: true, issues: [incident()] });
  assert.equal((await syncMonitorIssue(config)).notification, 'incident-opened');
  const write = config.calls.find((call) => call.method === 'POST');
  assert.match(write.body.title, /^\[monitor test\]/);
  assert.match(write.body.body, /Это тест канала уведомлений/);
  const success = fixture({ testing: true, conclusion: 'success', issues: [incident()] });
  assert.equal((await syncMonitorIssue(success)).notification, 'healthy-no-message');
});

test('untrusted sources, duplicate incidents and late completions cannot modify issues', async () => {
  for (const change of [
    { workflow_id: 1 },
    { head_branch: 'feature' },
    { head_repository: { full_name: 'someone/else' } },
    { event: 'pull_request' },
  ]) {
    const config = fixture();
    Object.assign(config.run, change);
    await assert.rejects(syncMonitorIssue(config), /MONITOR_ALERT_SOURCE_REJECTED/);
    assert.equal(
      config.calls.some((call) => call.method !== 'GET'),
      false,
    );
  }
  await assert.rejects(
    syncMonitorIssue(fixture({ issues: [incident(), incident({ number: 41 })] })),
    /MONITOR_ALERT_DUPLICATE_ISSUES/,
  );
  const stale = fixture();
  const api = stale.api;
  stale.api = async (path, ...args) =>
    path.includes('/runs?')
      ? {
          workflow_runs: [
            { ...stale.run, id: 101, conclusion: 'success', updated_at: '2026-11-04T08:01:00Z' },
          ],
        }
      : api(path, ...args);
  assert.equal((await syncMonitorIssue(stale)).notification, 'superseded');
  assert.equal(
    stale.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('intentional cancellation is not reported as an outage', async () => {
  const config = fixture({ conclusion: 'cancelled' });
  assert.equal((await syncMonitorIssue(config)).notification, 'ignored-conclusion');
  assert.equal(config.calls.length, 1);
});
