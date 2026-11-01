// The websites dashboard: one Cloudflare Worker, behind sign-in with GitHub. It reads Cloudflare's analytics,
// the websites repo's GitHub Actions runs and minutes, Google Search Console and Bing Webmaster Tools, all at
// page load (with a short cache), and draws them on one page. public/ holds the stylesheet and the chart script.

import { authProblem, currentUser, startLogin, finishLogin, logout } from './auth.js';
import { makeContext, settle } from './sources/context.js';
import { loadSites, loadCI, loadMinutes, repoOf } from './sources/github.js';
import { loadTraffic } from './sources/cloudflare.js';
import { loadGoogle } from './sources/google.js';
import { loadBing } from './sources/bing.js';
import { makePeriod, monthToDate } from './format.js';
import { dashboardPage, signInPage, PERIODS } from './page.js';

const SECURITY = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'private, no-store',
};

const page = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY } });

const NOT_SET = { setup: true, ok: false };

// Everything the page shows, each source settled on its own so one failing leaves the rest.
export async function gather(env, { days, fresh = false, now = new Date(), fetcher } = {}) {
  const ctx = makeContext(env, { fresh, now, fetcher });
  const period = makePeriod(days, now);
  const month = monthToDate(now);
  const hasGitHub = !!env.GITHUB_TOKEN;

  const sites = hasGitHub
    ? await settle(ctx.cached('sites', 600, () => loadSites(ctx)), env)
    : { ok: false, error: 'GITHUB_TOKEN is not set, so the site list cannot be read from the websites repo.' };
  // The sites search engines may list; without the repo's list, SEARCH_DOMAINS names them.
  const searchDomains = sites.ok
    ? sites.value.filter((s) => s.index).map((s) => s.domain)
    : String(env.SEARCH_DOMAINS || '').split(/[\s,]+/).filter(Boolean);
  const key = `${days}:${searchDomains.join(',')}`;

  const [traffic, ci, minutes, google, bing] = await Promise.all([
    env.CF_API_TOKEN ? settle(ctx.cached(`cf:${days}`, 300, () => loadTraffic(ctx, period)), env) : NOT_SET,
    hasGitHub ? settle(ctx.cached(`ci:${days}`, 120, () => loadCI(ctx, period)), env) : NOT_SET,
    hasGitHub ? settle(ctx.cached(`minutes:${month.year}-${month.month}`, 600, () => loadMinutes(ctx, month)), env) : NOT_SET,
    env.GOOGLE_SERVICE_ACCOUNT ? settle(ctx.cached(`google:${key}`, 1800, () => loadGoogle(ctx, searchDomains, period)), env) : NOT_SET,
    env.BING_API_KEY ? settle(ctx.cached(`bing:${key}`, 1800, () => loadBing(ctx, searchDomains, period)), env) : NOT_SET,
  ]);

  return {
    days,
    now,
    period,
    month,
    repo: repoOf(env),
    timeZone: env.TIME_ZONE || 'UTC',
    sites,
    searchDomains,
    traffic,
    ci,
    minutes,
    google,
    bing,
    used: ctx.used,
    limit: ctx.limit,
  };
}

export async function handle(request, env, { fetcher = globalThis.fetch, now = new Date() } = {}) {
  const url = new URL(request.url);
  const method = request.method;

  if (url.pathname === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
  }

  const problem = authProblem(env);
  if (url.pathname === '/login' && method === 'GET') {
    return problem ? page(signInPage({ problem }), 503) : startLogin(request, env);
  }
  if (url.pathname === '/auth/callback' && method === 'GET') {
    if (problem) return page(signInPage({ problem }), 503);
    const result = await finishLogin(request, env, fetcher);
    return result.response || page(signInPage({ message: result.message, user: result.user, status: result.status }), result.status);
  }
  if (url.pathname === '/logout' && method === 'POST') return logout();

  if (url.pathname !== '/') return page(signInPage({ message: 'There is no page here.', status: 404 }), 404);
  if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });

  const user = await currentUser(request, env);
  if (!user) return page(signInPage({ problem }), 401);

  const asked = Number(url.searchParams.get('days'));
  const days = PERIODS.includes(asked) ? asked : 30;
  const data = await gather(env, { days, fresh: url.searchParams.has('fresh'), fetcher, now });
  return page(dashboardPage({ ...data, user }));
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error(e);
      return page(signInPage({ message: 'Something went wrong drawing the page. The Worker’s logs have the detail.', status: 500 }), 500);
    }
  },
};
