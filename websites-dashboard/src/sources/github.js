// GitHub: the site list (sites.json and tools.json in the websites repo), its Actions runs, and the account's
// Actions minutes this month. One token, GITHUB_TOKEN: a fine-grained personal access token with, on the websites
// repository, Actions: read and Contents: read, and the account permission Plan: read (for the billing report).

import { SourceError, failure, bareHost } from './context.js';
import { UA } from '../auth.js';

const API = 'https://api.github.com';

async function gh(ctx, path, { raw = false } = {}) {
  const res = await ctx.fetch(API + path, {
    headers: {
      authorization: `Bearer ${ctx.env.GITHUB_TOKEN}`,
      accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': UA,
    },
  });
  if (!res.ok) throw await failure(`GitHub ${path.split('?')[0]}`, res);
  return raw ? res.text() : res.json();
}

export const repoOf = (env) => env.WEBSITES_REPO || 'richardbenstead/websites';

// Every site the websites repo publishes, in its own order: the hub sites, then the tool sites.
// { domain, name, kind: 'site' | 'tool', index, analytics }. `index` is whether search engines may list it.
export async function loadSites(ctx) {
  const repo = repoOf(ctx.env);
  const read = async (file) => {
    const list = JSON.parse(await gh(ctx, `/repos/${repo}/contents/${file}`, { raw: true }));
    if (!Array.isArray(list)) throw new SourceError(`${file} in ${repo} is not a list.`);
    return list.filter((s) => s && typeof s.domain === 'string');
  };
  const [sites, tools] = await Promise.all([read('sites.json'), read('tools.json')]);
  const entry = (s, kind) => ({
    domain: bareHost(s.domain),
    name: String(s.name || s.domain),
    kind,
    index: s.index === true,
    analytics: typeof s.analytics === 'string' ? s.analytics : null,
  });
  return [...sites.map((s) => entry(s, 'site')), ...tools.map((t) => entry(t, 'tool'))];
}

// A run that went wrong, as opposed to one that was cancelled or skipped.
export const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

const runSummary = (r) => ({
  id: r.id,
  workflowId: r.workflow_id,
  name: r.name,
  title: r.display_title || r.head_commit?.message?.split('\n')[0] || '',
  branch: r.head_branch,
  event: r.event,
  conclusion: r.conclusion,
  status: r.status,
  created: r.created_at,
  updated: r.updated_at,
  url: r.html_url,
  attempt: r.run_attempt,
});

// The websites repo's workflows over the period: runs, failures and the state of each one now.
export async function loadCI(ctx, period) {
  const repo = repoOf(ctx.env);
  const since = encodeURIComponent(`>=${period.start}`);
  const { workflows = [] } = await gh(ctx, `/repos/${repo}/actions/workflows?per_page=100`);
  const active = workflows.filter((w) => w.state === 'active');

  // Per workflow, one request gives both the count of completed runs in the period and the newest of them.
  const perWorkflow = Promise.all(
    active.map(async (w) => {
      const r = await gh(ctx, `/repos/${repo}/actions/workflows/${w.id}/runs?per_page=1&status=completed&created=${since}`);
      return { w, completed: r.total_count || 0, latest: r.workflow_runs?.[0] ? runSummary(r.workflow_runs[0]) : null };
    }),
  );
  // Failures and time-outs, the two ways a completed run goes wrong that the runs list can filter on.
  const failedRuns = Promise.all(
    ['failure', 'timed_out'].map((status) =>
      gh(ctx, `/repos/${repo}/actions/runs?per_page=100&status=${status}&created=${since}`),
    ),
  );
  const [rows, failedPages] = await Promise.all([perWorkflow, failedRuns]);

  const failures = failedPages
    .flatMap((p) => p.workflow_runs || [])
    .map(runSummary)
    .sort((a, b) => b.created.localeCompare(a.created));
  const truncated = failedPages.some((p) => (p.total_count || 0) > (p.workflow_runs || []).length);

  // What broke in the newest few: the failed jobs and the step each failed on.
  const detailed = failures.slice(0, Number(ctx.env.CI_FAILURE_DETAILS ?? 3));
  await Promise.all(
    detailed.map(async (run) => {
      try {
        const { jobs = [] } = await gh(ctx, `/repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`);
        run.jobs = jobs
          .filter((j) => FAILED.has(j.conclusion))
          .map((j) => ({ name: j.name, step: (j.steps || []).find((s) => FAILED.has(s.conclusion))?.name || null, url: j.html_url }));
      } catch {
        run.jobs = null; // Leave the run on the list without its detail.
      }
    }),
  );

  const failedByDay = Object.fromEntries(period.dates.map((d) => [d, 0]));
  for (const f of failures) {
    const d = f.created.slice(0, 10);
    if (d in failedByDay) failedByDay[d]++;
  }

  const workflowsOut = rows
    .map(({ w, completed, latest }) => {
      const failed = failures.filter((f) => f.workflowId === w.id);
      return {
        id: w.id,
        name: w.name,
        path: w.path,
        url: w.html_url,
        completed,
        failed: failed.length,
        latest,
        lastFailure: failed[0] || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const completed = workflowsOut.reduce((a, w) => a + w.completed, 0);
  return {
    repo,
    workflows: workflowsOut,
    completed,
    failures,
    truncated,
    failedByDay: period.dates.map((d) => failedByDay[d]),
    failingNow: workflowsOut.filter((w) => w.latest && FAILED.has(w.latest.conclusion)),
  };
}

// Runner minutes count against the included minutes at these rates (GitHub's multipliers).
const multiplier = (sku) => (/mac/i.test(sku) ? 10 : /windows/i.test(sku) ? 2 : 1);

// This month's Actions minutes for the account, from GitHub's billing usage report, and last month's total.
// Public repositories' minutes are free and do not count against the included minutes, so they are kept apart.
export async function loadMinutes(ctx, month) {
  const user = ctx.env.GITHUB_BILLING_USER || repoOf(ctx.env).split('/')[0];
  const prev = month.month === 1 ? { year: month.year - 1, month: 12 } : { year: month.year, month: month.month - 1 };
  const report = (m) => gh(ctx, `/users/${user}/settings/billing/usage?year=${m.year}&month=${m.month}`);
  const [usage, previous, repos] = await Promise.all([
    report(month),
    report(prev).catch(() => null),
    gh(ctx, `/users/${user}/repos?type=owner&per_page=100`).catch(() => []),
  ]);
  const publicRepos = new Set(repos.filter((r) => !r.private).map((r) => r.name.toLowerCase()));
  const isPublic = (name) => publicRepos.has(String(name || '').split('/').pop().toLowerCase());
  const actionMinutes = (report) =>
    (report?.usageItems || [])
      .filter((i) => String(i.product).toLowerCase() === 'actions' && /^minutes?$/i.test(String(i.unitType)))
      .map((i) => ({ ...i, minutes: (Number(i.quantity) || 0) * multiplier(i.sku), name: i.repositoryName || '(no repository)' }));

  const byDay = Object.fromEntries(month.dates.map((d) => [d, 0]));
  const byRepo = new Map();
  let counted = 0;
  let free = 0;
  let net = 0;
  for (const i of actionMinutes(usage)) {
    const pub = isPublic(i.name);
    net += Number(i.netAmount) || 0;
    const r = byRepo.get(i.name) || { name: i.name, minutes: 0, isPublic: pub };
    r.minutes += i.minutes;
    byRepo.set(i.name, r);
    if (pub) {
      free += i.minutes;
      continue;
    }
    counted += i.minutes;
    const d = String(i.date).slice(0, 10);
    if (d in byDay) byDay[d] += i.minutes;
  }

  const budget = Number(ctx.env.ACTIONS_MINUTES_BUDGET) || 2000;
  const daily = month.dates.map((d) => (d <= month.today ? byDay[d] : null));
  let running = 0;
  const cumulative = daily.map((v) => (v == null ? null : (running += v)));
  // At this month's pace so far, once a day has gone by. ponytail: a straight line from the 1st, so a busy first
  // week overstates the month.
  const projected = month.elapsed >= 1 ? (counted / month.elapsed) * month.dates.length : null;

  return {
    user,
    budget,
    used: counted,
    free,
    net,
    projected,
    daily,
    cumulative,
    previous: previous ? { ...prev, used: actionMinutes(previous).filter((i) => !isPublic(i.name)).reduce((a, i) => a + i.minutes, 0) } : null,
    repos: [...byRepo.values()].sort((a, b) => b.minutes - a.minutes),
  };
}
