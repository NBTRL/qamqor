import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { cliApi } from './registry-retention.mjs';

const teamId = 'team_ZpeBcU8O33dkdri3Ez2KuouL';
const projectId = 'prj_T3Gc0oRzs9Tc6azNqkeg7QFVVZlt';
const origin = 'https://qamqor-tawny.vercel.app';

export function validateRuntimeSummary(lines) {
  const summary = lines.find((line) => line.type === 'summary');
  if (!summary || !Number.isInteger(summary.recordsReturned) || summary.recordsReturned < 0)
    throw new Error('LOG_QUERY_UNVERIFIED');
  if (summary.excludedIntervals?.length) throw new Error('LOG_COVERAGE_INCOMPLETE');
  if (summary.recordsReturned > 0) throw new Error('PRODUCTION_RUNTIME_ERRORS');
}

export async function inspectProduction({
  api,
  request = fetch,
  readErrors,
  wait = delay,
  attempts = 3,
}) {
  let failure;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const project = api(`/v9/projects/${projectId}?teamId=${teamId}`);
      if (project.id !== projectId || project.accountId !== teamId)
        throw new Error('PROJECT_SCOPE_MISMATCH');
      const production = project.targets?.production;
      if (production?.readyState !== 'READY' || !production.id?.startsWith('dpl_'))
        throw new Error('PRODUCTION_NOT_READY');
      for (const path of ['/api/v1/health', '/api/v1/public/stats']) {
        const response = await request(origin + path, {
          signal: AbortSignal.timeout(45000),
          redirect: 'error',
        });
        if (response.status !== 200) throw new Error('PUBLIC_API_UNAVAILABLE');
        const body = await response.json();
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          (path.endsWith('/health') && body.status !== 'ok')
        )
          throw new Error('PUBLIC_API_RESPONSE_INVALID');
      }
      const result = api(
        `/v1/projects/${projectId}/daemons?teamId=${teamId}&scopeType=target&scopeValue=production`,
      );
      const worker = result.daemons?.find(
        (daemon) =>
          daemon.name === 'worker' &&
          daemon.scope?.type === 'target' &&
          daemon.scope.value === 'production',
      );
      if (
        !worker ||
        worker.deploymentId !== production.id ||
        worker.status !== 'ready' ||
        worker.instances?.desired < 1 ||
        worker.instances?.ready !== worker.instances?.desired ||
        worker.instances?.total !== worker.instances?.desired ||
        !Array.isArray(worker.instances?.items) ||
        worker.instances.items.length !== worker.instances.desired ||
        worker.instances.items.some((instance) => instance.alive !== true)
      )
        throw new Error('PRODUCTION_WORKER_UNHEALTHY');
      validateRuntimeSummary(await readErrors(production.id));
      return {
        production: production.id,
        api: 'healthy',
        worker: `${worker.instances.ready}/${worker.instances.desired}`,
        runtimeErrors: 0,
      };
    } catch (error) {
      // Never print fetched application logs, response bodies or authentication errors.
      failure = /^[A-Z_]+$/.test(error.message) ? error.message : 'MONITOR_CHECK_FAILED';
      if (attempt + 1 < attempts) await wait(20000);
    }
  }
  throw new Error(failure);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  inspectProduction({
    api: cliApi(),
    readErrors: async (deployment) => {
      const output = execFileSync(
        process.execPath,
        [
          process.env.VERCEL_CLI_ENTRY,
          'logs',
          'runtime',
          '--project',
          projectId,
          '--scope',
          'acme-5a14',
          '--deployment',
          deployment,
          '--query',
          'level:error OR level:fatal',
          '--since',
          '40m',
          '--limit',
          '1',
          '--json',
        ],
        {
          encoding: 'utf8',
          timeout: 60000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 1024 * 1024,
        },
      );
      return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
