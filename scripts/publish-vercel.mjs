import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { cliApi, runRetention } from './registry-retention.mjs';

const teamId = 'team_ZpeBcU8O33dkdri3Ez2KuouL';
const projectId = 'prj_T3Gc0oRzs9Tc6azNqkeg7QFVVZlt';

export async function publish({
  api,
  sha,
  ref,
  production,
  dryRun = false,
  wait = delay,
  log = console.log,
}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('An exact tested commit SHA is required');
  // A failed capacity/security check must prevent even the deployment creation request.
  runRetention(api, { apply: !dryRun, log });
  if (dryRun) return { dryRun: true, sha };
  const directory = mkdtempSync(join(tmpdir(), 'qamqor-release-'));
  let deployment;
  try {
    const input = join(directory, 'deployment.json');
    writeFileSync(
      input,
      JSON.stringify({
        name: 'qamqor',
        project: projectId,
        ...(production ? { target: 'production' } : {}),
        gitSource: {
          type: 'github',
          repoId: '1437053883',
          ref: production ? 'main' : (ref ?? sha),
          sha,
        },
        meta: { registryPreflight: '45-to-30', testedCommit: sha },
      }),
    );
    deployment = api(`/v13/deployments?teamId=${teamId}`, 'POST', input);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (!deployment.id?.startsWith('dpl_')) throw new Error('Unexpected deployment response');
  log(JSON.stringify({ deployment: deployment.id, url: deployment.url, sha }));
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = api(`/v13/deployments/${deployment.id}?teamId=${teamId}`);
    if (current.projectId !== projectId || current.meta?.githubCommitSha !== sha)
      throw new Error('Deployment project/commit does not match the preflight');
    if (current.readyState === 'READY') return { id: current.id, url: current.url, sha };
    if (['ERROR', 'CANCELED'].includes(current.readyState))
      throw new Error(`Deployment ${current.id} ended in ${current.readyState}`);
    await wait(10000);
  }
  throw new Error(`Deployment wait timed out: ${deployment.id}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publish({
    api: cliApi(),
    sha: process.env.QAMQOR_DEPLOY_SHA,
    ref: process.env.QAMQOR_DEPLOY_REF,
    production: process.env.QAMQOR_DEPLOY_PRODUCTION === 'true',
    dryRun: process.argv.includes('--dry-run'),
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
