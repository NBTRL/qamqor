import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const teamId = 'team_ZpeBcU8O33dkdri3Ez2KuouL';
const projectId = 'prj_T3Gc0oRzs9Tc6azNqkeg7QFVVZlt';
const scope = new URLSearchParams({ teamId, projectId });
const pins = ['5409b6483fc8', '31d83f43634c', '79d8fe627a7d'];
export const cleanupThreshold = 45;

export function planRetention(images, protectedTags, now = Date.now()) {
  for (const tag of protectedTags) {
    if (!images.some((image) => image.tags.includes(tag)))
      throw new Error(`Protected image missing: ${tag}`);
  }
  const sorted = [...images].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const keep = new Set(sorted.slice(0, 10).map((image) => image.id));
  const candidates = sorted.filter(
    (image) =>
      !keep.has(image.id) &&
      image.status === 'ready' &&
      image.kind === 'manifest' &&
      image.tags.length > 0 &&
      image.tags.every((tag) => /^[a-f0-9]{12}$/.test(tag) && !protectedTags.includes(tag)) &&
      Date.parse(image.createdAt) < now - 24 * 60 * 60 * 1000,
  );
  return candidates.reverse().slice(0, Math.max(0, images.length - 30));
}

export function cliApi() {
  const cli = process.env.VERCEL_CLI_ENTRY;
  if (!cli)
    throw new Error('Set VERCEL_CLI_ENTRY to the installed official Vercel CLI entrypoint.');
  return function api(path, method = 'GET', inputFile) {
    // The official CLI handles login/refresh. Credentials never enter arguments or output.
    const args = [cli, 'api', path, '--method', method];
    if (inputFile) args.push('--input', inputFile);
    if (method === 'DELETE') args.push('--dangerously-skip-permissions');
    const output = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.trim() ? JSON.parse(output) : {};
  };
}

export function runRetention(api, { apply = false, log = console.log } = {}) {
  const summary = [];
  function pages(path, key, cursorName) {
    const result = [];
    let cursor;
    const seen = new Set();
    do {
      const page = api(
        `${path}&limit=100${cursor ? `&${cursorName}=${encodeURIComponent(cursor)}` : ''}`,
      );
      if (!Array.isArray(page[key])) throw new Error(`Unexpected response for ${key}`);
      result.push(...page[key]);
      cursor = page.pagination?.next ?? page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('Pagination did not advance');
      seen.add(cursor);
    } while (cursor);
    return result;
  }
  function protection() {
    const project = api(`/v9/projects/${projectId}?teamId=${teamId}`);
    if (project.id !== projectId || project.accountId !== teamId || project.name !== 'qamqor')
      throw new Error('Unexpected project');
    const current = project.targets?.production;
    if (current?.readyState !== 'READY') throw new Error('Production is not ready');
    const deployments = pages(`/v6/deployments?${scope}`, 'deployments', 'until');
    if (deployments.some((d) => !['READY', 'ERROR', 'CANCELED'].includes(d.state)))
      throw new Error('Deployment in progress; retry after it finishes');
    const sha = current.meta?.githubCommitSha;
    const rollback = deployments.find(
      (d) => d.target === 'production' && d.state === 'READY' && d.meta?.githubCommitSha !== sha,
    );
    if (
      !/^[a-f0-9]{40}$/.test(sha ?? '') ||
      !/^[a-f0-9]{40}$/.test(rollback?.meta?.githubCommitSha ?? '')
    )
      throw new Error('Cannot identify production and rollback commits');
    return [...new Set([...pins, sha.slice(0, 12), rollback.meta.githubCommitSha.slice(0, 12)])];
  }
  for (const repository of ['api', 'daemon.worker']) {
    const path = `/v1/vcr/repository/${repository}/images?${scope}`;
    const images = pages(path, 'images', 'cursor');
    if (images.length < cleanupThreshold) {
      const result = {
        repository,
        before: images.length,
        after: images.length,
        deleted: 0,
        threshold: cleanupThreshold,
        action: 'below-threshold',
      };
      log(JSON.stringify(result));
      summary.push(result);
      continue;
    }
    const protectedTags = protection();
    const plan = planRetention(images, protectedTags);
    if (images.length - plan.length > 30)
      throw new Error(
        `REGISTRY_CAPACITY_BLOCKED: ${repository}: cannot safely reduce to 30 images`,
      );
    log(
      JSON.stringify({
        repository,
        before: images.length,
        protectedTags,
        apply,
        delete: plan.map(({ id, tags, manifestDigest }) => ({ id, tags, manifestDigest })),
      }),
    );
    if (!apply) continue;
    for (const image of plan) {
      const freshProtection = protection();
      const fresh = pages(path, 'images', 'cursor');
      // Recompute from fresh state before every deletion, including rollback/production changes.
      if (!planRetention(fresh, freshProtection).some((candidate) => candidate.id === image.id))
        throw new Error('Registry or production changed; aborting cleanup');
      api(`/v1/vcr/repository/${repository}/images/${image.id}?${scope}`, 'DELETE');
    }
    const after = pages(path, 'images', 'cursor');
    planRetention(after, protection());
    if (plan.some((deleted) => after.some((image) => image.id === deleted.id)))
      throw new Error('Deleted image is still present');
    if (after.length > 30) throw new Error(`REGISTRY_CHANGED: ${repository}: retry preflight`);
    const result = { repository, after: after.length, deleted: plan.length };
    summary.push(result);
    log(JSON.stringify(result));
  }
  return summary;
}

export async function main() {
  runRetention(cliApi(), { apply: process.argv.includes('--apply') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
