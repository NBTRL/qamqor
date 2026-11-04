import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { githubApi } from './monitor-clock.mjs';

const base = '/repos/NBTRL/qamqor';
const marker = '<!-- qamqor-production-monitor:v1 -->';
const isTest = (run) => run.display_title === 'Qamqor production monitor / clock-test';

function validRun(run) {
  return (
    Number.isSafeInteger(run?.id) &&
    run.id > 0 &&
    run.workflow_id === 405941521 &&
    run.path === '.github/workflows/monitor.yml' &&
    run.head_branch === 'main' &&
    run.head_repository?.full_name === 'NBTRL/qamqor' &&
    ['schedule', 'workflow_dispatch', 'workflow_run'].includes(run.event) &&
    run.status === 'completed' &&
    Number.isFinite(Date.parse(run.updated_at))
  );
}

export async function syncMonitorIssue({ api, runId }) {
  if (!/^\d+$/.test(String(runId))) throw new Error('MONITOR_ALERT_RUN_ID_REJECTED');
  const run = await api(`${base}/actions/runs/${runId}`);
  if (!validRun(run) || String(run.id) !== String(runId))
    throw new Error('MONITOR_ALERT_SOURCE_REJECTED');
  if (!['success', 'failure', 'timed_out'].includes(run.conclusion))
    return { notification: 'ignored-conclusion' };
  const recent = await api(`${base}/actions/workflows/monitor.yml/runs?per_page=100`);
  if (!Array.isArray(recent.workflow_runs)) throw new Error('MONITOR_ALERT_RUNS_INVALID');
  // A late delivery of an older completion must not reopen/close a newer incident.
  if (
    recent.workflow_runs.some(
      (other) =>
        validRun(other) &&
        isTest(other) === isTest(run) &&
        ['success', 'failure', 'timed_out'].includes(other.conclusion) &&
        Date.parse(other.updated_at) > Date.parse(run.updated_at),
    )
  )
    return { notification: 'superseded' };

  const title = isTest(run)
    ? '[monitor test] Проверка уведомлений Qamqor'
    : '[monitor] Сбой проверки production Qamqor';
  const issues = [];
  for (let page = 1; ; page++) {
    if (page > 10) throw new Error('MONITOR_ALERT_ISSUE_PAGINATION_LIMIT');
    const result = await api(`${base}/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(result)) throw new Error('MONITOR_ALERT_ISSUES_INVALID');
    issues.push(
      ...result.filter(
        (issue) =>
          !issue.pull_request &&
          issue.title === title &&
          issue.user?.login === 'github-actions[bot]' &&
          issue.body?.includes(marker),
      ),
    );
    if (result.length < 100) break;
  }
  if (issues.length > 1) throw new Error('MONITOR_ALERT_DUPLICATE_ISSUES');
  const issue = issues[0];
  const link = `https://github.com/NBTRL/qamqor/actions/runs/${run.id}`;
  if (run.conclusion !== 'success') {
    if (issue) return { notification: 'incident-already-open', issue: issue.number };
    const created = await api(`${base}/issues`, 'POST', {
      title,
      body: `${marker}\n\n@NBTRL ${
        isTest(run)
          ? 'Это тест канала уведомлений. Ожидаемая ошибка добавлена после проверки production; приложение не останавливалось.'
          : 'Мониторинг Qamqor обнаружил ошибку. Проверь API, worker и механизм следующих запусков.'
      }\n\n[Неуспешная проверка](${link}).\n\nПовторные сбои сохраняют эту issue без новых сообщений. Следующая успешная проверка закроет её автоматически.`,
      assignees: ['NBTRL'],
    });
    if (!Number.isSafeInteger(created?.number)) throw new Error('MONITOR_ALERT_CREATE_UNVERIFIED');
    return { notification: 'incident-opened', issue: created.number };
  }
  if (!issue) return { notification: 'healthy-no-message' };
  if (!Number.isSafeInteger(issue.number)) throw new Error('MONITOR_ALERT_ISSUE_ID_REJECTED');
  await api(`${base}/issues/${issue.number}`, 'PATCH', {
    state: 'closed',
    state_reason: 'completed',
    body: `${issue.body}\n\nВосстановлено: [успешная проверка](${link}).`,
  });
  return { notification: 'incident-closed', issue: issue.number };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.env.GITHUB_EVENT_NAME !== 'workflow_run' ||
      process.env.GITHUB_REPOSITORY !== 'NBTRL/qamqor' ||
      process.env.GITHUB_WORKFLOW_REF !==
        'NBTRL/qamqor/.github/workflows/monitor-alert.yml@refs/heads/main'
    )
      throw new Error('MONITOR_ALERT_CONTEXT_REJECTED');
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    console.log(
      JSON.stringify(
        await syncMonitorIssue({
          api: githubApi(process.env.GITHUB_TOKEN),
          runId: event.workflow_run?.id,
        }),
      ),
    );
  } catch (error) {
    console.error(
      /^MONITOR_[A-Z_0-9]+$/.test(error.message) ? error.message : 'MONITOR_ALERT_FAILED',
    );
    process.exitCode = 1;
  }
}
