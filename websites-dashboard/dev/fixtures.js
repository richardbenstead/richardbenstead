// Made-up answers from every API the dashboard reads, shaped like the real ones, for the tests and for
// "npm run preview". The numbers are deterministic (a seeded generator), so tests can count on them.

import { sign } from '../src/auth.js';
import { isoDay } from '../src/format.js';

const DAY = 86400000;
export const OWNER_ID = 52471242;
export const ACCOUNT = 'acc0000000000000000000000000000a';

// mulberry32: small, seeded, good enough for made-up traffic.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SITES = [
  { domain: 'eventshawk.com', name: 'Events Hawk', index: true, analytics: 'cd0234d7b34042d4a26f3b97718877b4' },
  { domain: 'gigshawk.com', name: 'Gigs Hawk', index: false },
  { domain: 'macrodates.com', name: 'Macro Hawk', index: false },
];
export const TOOLS = [
  { id: 'dates', domain: 'dates.eventfox.workers.dev', name: 'Dates Hawk', index: false },
  { id: 'sky', domain: 'sky.eventfox.workers.dev', name: 'Sky Hawk', index: false },
  { id: 'units', domain: 'units.eventfox.workers.dev', name: 'Units Hawk', index: false },
];

const ZONES = [
  { id: 'z1', name: 'eventshawk.com', base: 420 },
  { id: 'z2', name: 'gigshawk.com', base: 70 },
  { id: 'z3', name: 'macrodates.com', base: 26 },
];

const WORKFLOWS = [
  { id: 101, name: 'Deploy', path: '.github/workflows/deploy.yml' },
  { id: 102, name: 'Update data', path: '.github/workflows/update-data.yml' },
  { id: 103, name: 'Refresh data', path: '.github/workflows/refresh-data.yml' },
  { id: 104, name: 'Review', path: '.github/workflows/review.yml' },
];

export async function demoEnv(extra = {}) {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/.{64}/g, '$&\n')}\n-----END PRIVATE KEY-----\n`;
  return {
    ALLOWED_GITHUB_IDS: String(OWNER_ID),
    WEBSITES_REPO: 'richardbenstead/websites',
    ACTIONS_MINUTES_BUDGET: '2000',
    TIME_ZONE: 'Australia/Sydney',
    GITHUB_CLIENT_ID: 'demo-client',
    GITHUB_CLIENT_SECRET: 'demo-secret',
    SESSION_SECRET: 'demo-session-secret-that-is-long-enough-0123456789',
    GITHUB_TOKEN: 'demo-github-token',
    CF_API_TOKEN: 'demo-cloudflare-token',
    GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'dashboard@demo.iam.gserviceaccount.com', private_key: pem }),
    BING_API_KEY: 'demo-bing-key-0000',
    ...extra,
  };
}

export const demoSession = (env, user = { id: OWNER_ID, login: 'richardbenstead', avatar: null }) =>
  sign({ ...user, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// A fetch that answers like the real APIs. `overrides(url, init)` may return a Response to replace one answer.
export function demoFetcher({ now = new Date(), overrides } = {}) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = (n, from = today) => Array.from({ length: n }, (_, i) => isoDay(from - (n - 1 - i) * DAY));
  const weekend = (d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

  // Failed runs: a broken data update a week ago, a couple of flaky deploys, and the review failing now.
  const fail = (wf, ago, title, extra = {}) => {
    const created = new Date(now.getTime() - ago * 3600000).toISOString();
    return {
      id: 9000 + Math.round(ago),
      workflow_id: wf.id,
      name: wf.name,
      display_title: title,
      head_branch: 'main',
      event: 'schedule',
      status: 'completed',
      conclusion: 'failure',
      created_at: created,
      updated_at: new Date(new Date(created).getTime() + 7 * 60000).toISOString(),
      html_url: `https://github.com/richardbenstead/websites/actions/runs/${9000 + Math.round(ago)}`,
      run_attempt: 1,
      ...extra,
    };
  };
  const failures = [
    fail(WORKFLOWS[3], 5, 'Review list for the week'),
    fail(WORKFLOWS[0], 30, 'Data: 4 changes from the official sources', { event: 'push' }),
    fail(WORKFLOWS[1], 7 * 24 + 3, 'Update data'),
    fail(WORKFLOWS[1], 7 * 24 + 9, 'Update data'),
    fail(WORKFLOWS[1], 7 * 24 + 15, 'Update data'),
    fail(WORKFLOWS[0], 12 * 24, 'Gigs Hawk: K-pop collection page <b>&</b> "quoted"', { event: 'push' }),
    fail(WORKFLOWS[0], 19 * 24 + 4, 'Units Hawk: drag to zoom', { event: 'push' }),
  ];
  const timedOut = [fail(WORKFLOWS[1], 3 * 24 + 2, 'Update data', { conclusion: 'timed_out' })];

  function github(u) {
    const p = u.pathname;
    if (p.endsWith('/contents/sites.json')) return new Response(JSON.stringify(SITES));
    if (p.endsWith('/contents/tools.json')) return new Response(JSON.stringify(TOOLS));
    if (p.endsWith('/actions/workflows')) {
      return json({
        total_count: WORKFLOWS.length,
        workflows: WORKFLOWS.map((w) => ({ ...w, state: 'active', html_url: `https://github.com/richardbenstead/websites/blob/main/${w.path}` })),
      });
    }
    const wf = /\/actions\/workflows\/(\d+)\/runs$/.exec(p);
    if (wf) {
      const w = WORKFLOWS.find((x) => x.id === Number(wf[1]));
      const since = u.searchParams.get('created')?.slice(2) || isoDay(today - 29 * DAY);
      const span = Math.round((today - Date.parse(`${since}T00:00:00Z`)) / DAY) + 1;
      const perDay = { 101: 9, 102: 4, 103: 1, 104: 0.43 }[w.id];
      const latest = failures.find((f) => f.workflow_id === w.id && w.id === 104) || {
        ...fail(w, 1.5, w.name),
        conclusion: 'success',
        id: 8000 + w.id,
        html_url: `https://github.com/richardbenstead/websites/actions/runs/${8000 + w.id}`,
      };
      return json({ total_count: Math.round(span * perDay), workflow_runs: [latest] });
    }
    if (p.endsWith('/actions/runs')) {
      const since = Date.parse(`${u.searchParams.get('created').slice(2)}T00:00:00Z`);
      const list = (u.searchParams.get('status') === 'timed_out' ? timedOut : failures).filter((f) => Date.parse(f.created_at) >= since);
      return json({ total_count: list.length, workflow_runs: list });
    }
    const jobs = /\/actions\/runs\/(\d+)\/jobs$/.exec(p);
    if (jobs) {
      return json({
        total_count: 1,
        jobs: [
          {
            name: 'update',
            conclusion: 'failure',
            html_url: `https://github.com/richardbenstead/websites/actions/runs/${jobs[1]}/job/1`,
            steps: [
              { name: 'Set up job', conclusion: 'success' },
              { name: 'npm test', conclusion: 'failure' },
            ],
          },
        ],
      });
    }
    if (/\/users\/[^/]+\/settings\/billing\/usage$/.test(p)) {
      const year = Number(u.searchParams.get('year'));
      const month = Number(u.searchParams.get('month'));
      const first = Date.UTC(year, month - 1, 1);
      const r = rng(month * 31 + year);
      const usageItems = [];
      for (let t = first; t <= today && new Date(t).getUTCMonth() === month - 1; t += DAY) {
        const date = `${isoDay(t)}T00:00:00Z`;
        const minutes = Math.round(150 + r() * 70);
        usageItems.push(
          { date, product: 'actions', sku: 'actions_linux', quantity: minutes, unitType: 'minutes', pricePerUnit: 0.008, grossAmount: minutes * 0.008, discountAmount: minutes * 0.008, netAmount: 0, repositoryName: 'richardbenstead/websites' },
          { date, product: 'actions', sku: 'actions_linux', quantity: 3, unitType: 'minutes', pricePerUnit: 0.008, grossAmount: 0.024, discountAmount: 0.024, netAmount: 0, repositoryName: 'richardbenstead/richardbenstead' },
          { date, product: 'actions', sku: 'actions_storage', quantity: 0.2, unitType: 'GigabyteHours', pricePerUnit: 0.0003, grossAmount: 0, discountAmount: 0, netAmount: 0, repositoryName: 'richardbenstead/websites' },
        );
      }
      return json({ usageItems });
    }
    if (/\/users\/[^/]+\/repos$/.test(p)) {
      return json([
        { name: 'websites', private: true },
        { name: 'richardbenstead', private: false },
        { name: 'tronbyt_apps', private: false },
      ]);
    }
    return json({ message: 'Not Found' }, 404);
  }

  async function cloudflare(u, init) {
    if (u.pathname.endsWith('/zones')) {
      return json({ success: true, result: ZONES.map((z) => ({ id: z.id, name: z.name, status: 'active', plan: { name: 'Free Website' }, account: { id: ACCOUNT } })) });
    }
    if (u.pathname.endsWith('/graphql')) {
      const { query } = JSON.parse(init.body);
      const start = /date_geq: "(\d{4}-\d\d-\d\d)"/.exec(query)?.[1] || /datetime_geq: "(\d{4}-\d\d-\d\d)/.exec(query)?.[1];
      const n = Math.round((today - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
      const dates = days(n);
      if (query.includes('httpRequests1dGroups')) {
        return json({
          data: {
            viewer: {
              zones: ZONES.map((z, k) => {
                const r = rng(k + 7);
                return {
                  zoneTag: z.id,
                  httpRequests1dGroups: dates.map((date, i) => {
                    const growth = 1 + i / 60;
                    const partial = i === dates.length - 1 ? now.getUTCHours() / 24 : 1;
                    const uniques = Math.round(z.base * growth * (weekend(date) ? 1.35 : 1) * (0.85 + r() * 0.3) * partial);
                    const requests = uniques * 14;
                    return {
                      dimensions: { date },
                      uniq: { uniques },
                      sum: { requests, pageViews: uniques * 3, cachedRequests: Math.round(requests * 0.82), bytes: requests * 52000, threats: Math.round(r() * 4) },
                    };
                  }),
                };
              }),
            },
          },
        });
      }
      if (query.includes('rumPageloadEventsAdaptiveGroups')) {
        const r = rng(99);
        const refs = [
          ['', 0.52],
          ['www.google.com', 0.22],
          ['www.google.co.uk', 0.05],
          ['www.bing.com', 0.06],
          ['duckduckgo.com', 0.035],
          ['search.brave.com', 0.01],
          ['www.reddit.com', 0.06],
          ['t.co', 0.025],
          ['eventshawk.com', 0.02],
        ];
        const groups = [];
        dates.forEach((date, i) => {
          const visitsToday = Math.round(180 * (1 + i / 60) * (weekend(date) ? 1.4 : 1) * (0.85 + r() * 0.3) * (i === dates.length - 1 ? now.getUTCHours() / 24 : 1));
          for (const [host, share] of refs) {
            const visits = Math.round(visitsToday * share * (0.6 + r() * 0.8));
            if (!visits) continue;
            groups.push({ count: Math.round(visits * 2.6), sum: { visits }, dimensions: { date, requestHost: 'eventshawk.com', refererHost: host } });
          }
        });
        return json({ data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: groups }] } } });
      }
    }
    return json({ success: false, errors: [{ message: 'not found' }] }, 404);
  }

  async function google(u, init) {
    if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'demo-google-token', expires_in: 3599 });
    const p = decodeURIComponent(u.pathname);
    if (p.endsWith('/webmasters/v3/sites')) {
      return json({ siteEntry: [{ siteUrl: 'sc-domain:eventshawk.com', permissionLevel: 'siteRestrictedUser' }] });
    }
    if (p.endsWith('/searchAnalytics/query')) {
      const body = JSON.parse(init.body);
      const all = days(Math.round((Date.parse(body.endDate) - Date.parse(body.startDate)) / DAY) + 1, Date.parse(`${body.endDate}T00:00:00Z`));
      const r = rng(5);
      if (body.dimensions[0] === 'date') {
        return json({
          rows: all.slice(0, -2).map((d, i) => {
            const impressions = Math.round(900 * (1 + i / 40) * (weekend(d) ? 1.3 : 1) * (0.8 + r() * 0.4));
            const clicks = Math.round(impressions * (0.035 + r() * 0.015));
            return { keys: [d], clicks, impressions, ctr: clicks / impressions, position: 14 - i / 10 + r() };
          }),
        });
      }
      const qs = ['rugby world cup 2027 fixtures', 'f1 schedule local time', 'motogp next race time', 'nrl grand final 2026 time', 'six nations 2027 dates', 'premier league fixtures uk time', 'australian grand prix 2027', 'nfl london games 2026', 'afl fixture 2027', '<script>alert(1)</script>'];
      return json({ rows: qs.map((q, i) => ({ keys: [q], clicks: Math.round(300 / (i + 1)), impressions: Math.round(5200 / (i + 1)), ctr: 300 / 5200, position: 3 + i * 1.7 })) });
    }
    if (p.endsWith('/sitemaps')) {
      return json({
        sitemap: [
          { path: 'https://eventshawk.com/sitemap.xml', lastDownloaded: new Date(now.getTime() - 20 * 3600000).toISOString(), isPending: false, errors: '0', warnings: '0', contents: [{ type: 'web', submitted: '4180', indexed: '0' }] },
        ],
      });
    }
    return json({ error: { message: 'not found' } }, 404);
  }

  function bing(u) {
    const method = u.pathname.split('/').pop();
    const netDate = (iso) => `/Date(${Date.parse(`${iso}T07:00:00Z`)}-0700)/`;
    const r = rng(11);
    if (method === 'GetUserSites') return json({ d: [{ __type: 'Site', Url: 'https://eventshawk.com/', IsVerified: true }] });
    if (method === 'GetRankAndTrafficStats') {
      return json({ d: days(90, today - 2 * DAY).map((d, i) => ({ Date: netDate(d), Clicks: Math.round(12 + i / 8 + r() * 10), Impressions: Math.round(380 + i * 3 + r() * 120) })) });
    }
    if (method === 'GetQueryStats') {
      const weeks = days(8, today - 3 * DAY).filter((_, i) => i % 7 === 0);
      const qs = ['f1 race start time', 'motogp schedule', 'rugby league fixtures', 'nfl schedule australia time'];
      return json({ d: weeks.flatMap((w) => qs.map((q, i) => ({ Query: q, Date: netDate(w), Clicks: 9 - i * 2, Impressions: 140 - i * 25, AvgClickPosition: 4 + i, AvgImpressionPosition: 6 + i }))) });
    }
    if (method === 'GetCrawlStats') {
      return json({ d: days(60, today - 1 * DAY).map((d, i) => ({ Date: netDate(d), CrawledPages: Math.round(300 + r() * 200), CrawlErrors: i % 17 === 0 ? 2 : 0, InIndex: 2600 + i * 9, InLinks: 40, Code2xx: 300, Code4xx: i % 17 === 0 ? 2 : 0, Code5xx: 0, BlockedByRobotsTxt: 0 })) });
    }
    return json({ ErrorCode: 3, Message: 'Unknown method' }, 400);
  }

  return async function fetcher(url, init = {}) {
    const u = new URL(url);
    const replaced = overrides?.(u, init);
    if (replaced) return replaced;
    if (u.hostname === 'api.github.com') return github(u);
    if (u.hostname === 'api.cloudflare.com') return cloudflare(u, init);
    if (u.hostname.endsWith('googleapis.com')) return google(u, init);
    if (u.hostname === 'ssl.bing.com') return bing(u);
    throw new Error(`The demo has no answer for ${u.hostname}`);
  };
}
