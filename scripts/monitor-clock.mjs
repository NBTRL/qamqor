import { pathToFileURL } from 'node:url';

const repository = 'NBTRL/qamqor';
const workflow = 'monitor.yml';
const base = `/repos/${repository}`;
const activeStatuses = ['queued', 'in_progress', 'waiting', 'pending', 'requested'];
const completedStatuses = ['completed'];
const title = (mode) => `Qamqor production monitor / ${mode}`;

export function githubApi(token, request = fetch) {
  if (!token) throw new Error('MONITOR_GITHUB_TOKEN_MISSING');
  return async (path, method = 'GET', body) => {
    if (!path.startsWith(`${base}/`)) throw new Error('MONITOR_API_SCOPE_MISMATCH');
    let response;
    try {
      response = await request(`https://api.github.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('MONITOR_GITHUB_REQUEST_FAILED');
    }
    if (method === 'POST' && response.status === 204) return;
    if (method !== 'GET' || response.status !== 200)
      throw new Error(`MONITOR_GITHUB_HTTP_${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error('MONITOR_GITHUB_RESPONSE_INVALID');
    }
  };
}

export async function ensureNextCheck({
  api,
  context,
  enabled,
  mode = 'now',
  testChecks = '2',
  now = Date.now(),
}) {
  if (
    context.repository !== repository ||
    context.ref !== 'refs/heads/main' ||
    context.workflowRef !== `${repository}/.github/workflows/${workflow}@refs/heads/main` ||
    !/^\d+$/.test(context.runId ?? '')
  )
    throw new Error('MONITOR_CLOCK_CONTEXT_REJECTED');
  if (!['now', 'clock', 'clock-test'].includes(mode))
    throw new Error('MONITOR_CLOCK_MODE_REJECTED');
  const testing = mode === 'clock-test';
  if (testing && !['1', '2'].includes(testChecks))
    throw new Error('MONITOR_CLOCK_TEST_BOUND_REJECTED');
  if (testing && testChecks === '1') return { clock: 'test-complete' };
  if (!testing && enabled !== 'true') return { clock: 'disabled' };

  const nextMode = testing ? 'clock-test' : 'clock';
  const environment = `qamqor-monitor-${nextMode}`;
  const config = await api(`${base}/environments/${environment}`);
  const wait = testing ? 1 : 30;
  if (
    config.name !== environment ||
    !Array.isArray(config.protection_rules) ||
    config.protection_rules.filter((rule) => rule.type === 'wait_timer').length !== 1 ||
    config.protection_rules.find((rule) => rule.type === 'wait_timer')?.wait_timer !== wait ||
    config.protection_rules.some((rule) => !['wait_timer', 'branch_policy'].includes(rule.type)) ||
    config.deployment_branch_policy?.protected_branches !== false ||
    config.deployment_branch_policy?.custom_branch_policies !== true
  )
    throw new Error('MONITOR_CLOCK_ENVIRONMENT_REJECTED');
  const branches = await api(`${base}/environments/${environment}/deployment-branch-policies`);
  if (
    branches.total_count !== 1 ||
    branches.branch_policies?.length !== 1 ||
    branches.branch_policies[0].name !== 'main' ||
    branches.branch_policies[0].type !== 'branch'
  )
    throw new Error('MONITOR_CLOCK_BRANCH_RULE_REJECTED');

  const pending = new Map();
  for (const status of activeStatuses) {
    for (let page = 1; ; page++) {
      if (page > 10) throw new Error('MONITOR_CLOCK_RUN_PAGINATION_LIMIT');
      const result = await api(
        `${base}/actions/workflows/${workflow}/runs?event=workflow_dispatch&status=${status}&per_page=100&page=${page}`,
      );
      if (!Array.isArray(result.workflow_runs)) throw new Error('MONITOR_CLOCK_RUNS_INVALID');
      for (const run of result.workflow_runs) {
        if (
          String(run.id) === context.runId ||
          run.head_branch !== 'main' ||
          run.event !== 'workflow_dispatch' ||
          run.display_title !== title(nextMode)
        )
          continue;
        if (![...activeStatuses, ...completedStatuses].includes(run.status))
          throw new Error('MONITOR_CLOCK_RUN_STATUS_UNKNOWN');
        if (!activeStatuses.includes(run.status)) continue;
        const age = now - Date.parse(run.created_at);
        if (!Number.isFinite(age) || age < 0 || age > 75 * 60 * 1000)
          throw new Error('MONITOR_CLOCK_STALLED_CANCEL_OLD_RUN_AND_RESTART');
        pending.set(run.id, run);
      }
      if (result.workflow_runs.length < 100) break;
    }
  }
  if (pending.size > 1) throw new Error('MONITOR_CLOCK_MULTIPLE_PENDING_RUNS');
  if (pending.size === 1) return { clock: 'already-pending', run: [...pending.keys()][0] };

  await api(`${base}/actions/workflows/${workflow}/dispatches`, 'POST', {
    ref: 'main',
    inputs: { mode: nextMode, ...(testing ? { test_checks: '1' } : {}) },
  });
  return { clock: 'dispatched', mode: nextMode, waitMinutes: wait };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(
      JSON.stringify(
        await ensureNextCheck({
          api: githubApi(process.env.GITHUB_TOKEN),
          context: {
            repository: process.env.GITHUB_REPOSITORY,
            ref: process.env.GITHUB_REF,
            workflowRef: process.env.GITHUB_WORKFLOW_REF,
            runId: process.env.GITHUB_RUN_ID,
          },
          enabled: process.env.QAMQOR_MONITOR_CLOCK_ENABLED,
          mode: process.env.MONITOR_MODE,
          testChecks: process.env.MONITOR_TEST_CHECKS,
        }),
      ),
    );
  } catch (error) {
    console.error(
      /^MONITOR_[A-Z_0-9]+$/.test(error.message) ? error.message : 'MONITOR_CLOCK_FAILED',
    );
    process.exitCode = 1;
  }
}
