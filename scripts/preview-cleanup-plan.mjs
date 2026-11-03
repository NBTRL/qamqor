import { pathToFileURL } from 'node:url';
import { cliApi } from './registry-retention.mjs';

const teamId = 'team_ZpeBcU8O33dkdri3Ez2KuouL';
const projectId = 'prj_T3Gc0oRzs9Tc6azNqkeg7QFVVZlt';
const referencePreview = 'dpl_8stb6sCABvW26eghCjMFjmqYZ6fd';

export function planClosedPreview(pr, deployments) {
  if (pr.state !== 'closed' || pr.head?.repo?.full_name !== 'NBTRL/qamqor')
    throw new Error('Only a closed same-repository PR can be planned');
  const ref = pr.head.ref;
  if (!ref || ref === 'main') throw new Error('Production ref is protected');
  const matching = deployments.filter((deployment) => deployment.meta?.githubCommitRef === ref);
  if (matching.some((deployment) => !['READY', 'ERROR', 'CANCELED'].includes(deployment.state)))
    throw new Error('Preview deployment still active');
  if (
    matching.some(
      (deployment) =>
        deployment.target === 'production' ||
        (deployment.uid ?? deployment.id) === referencePreview,
    )
  )
    throw new Error('Protected deployment in preview ref');
  return {
    mode: 'plan-only',
    applied: false,
    pr: pr.number,
    ref,
    expectedNeonBranch: `preview/${ref}`,
    deployments: matching.map((deployment) => ({
      id: deployment.uid ?? deployment.id,
      sha: deployment.meta?.githubCommitSha,
      state: deployment.state,
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const number = process.env.QAMQOR_PR_NUMBER;
  if (!/^[1-9][0-9]*$/.test(number ?? '')) throw new Error('An exact PR number is required');
  const response = await fetch(`https://api.github.com/repos/NBTRL/qamqor/pulls/${number}`);
  if (!response.ok) throw new Error('Cannot verify PR state');
  const pr = await response.json();
  const api = cliApi();
  const project = api(`/v9/projects/${projectId}?teamId=${teamId}`);
  if (project.id !== projectId || project.accountId !== teamId)
    throw new Error('Project scope mismatch');
  const deployments = [];
  const seen = new Set();
  let until;
  do {
    const page = api(
      `/v6/deployments?teamId=${teamId}&projectId=${projectId}&limit=100${until ? `&until=${encodeURIComponent(until)}` : ''}`,
    );
    if (!Array.isArray(page.deployments)) throw new Error('Unknown deployment response');
    deployments.push(...page.deployments);
    until = page.pagination?.next;
    if (until && seen.has(until)) throw new Error('Pagination did not advance');
    seen.add(until);
  } while (until);
  console.log(JSON.stringify(planClosedPreview(pr, deployments), null, 2));
}
