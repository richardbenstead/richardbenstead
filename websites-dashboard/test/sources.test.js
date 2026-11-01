import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gather, handle } from '../src/index.js';
import { clearCache, redact } from '../src/sources/context.js';
import { forgetGoogleToken, propertyFor } from '../src/sources/google.js';
import { bingDate } from '../src/sources/bing.js';
import { engineOf } from '../src/sources/cloudflare.js';
import { demoEnv, demoFetcher, demoSession } from '../dev/fixtures.js';

// The middle of a month, so the month-to-date figures have something in them.
const NOW = new Date('2026-11-18T09:00:00Z');

beforeEach(() => {
  clearCache();
  forgetGoogleToken();
});

const load = async (extra = {}, overrides) =>
  gather(await demoEnv(extra), { days: 30, now: NOW, fetcher: demoFetcher({ now: NOW, overrides }) });

test('every source loads from answers shaped like the real APIs, within the request limit', async () => {
  const d = await load();
  for (const k of ['sites', 'traffic', 'ci', 'minutes', 'google', 'bing']) assert.ok(d[k].ok, `${k}: ${d[k].error}`);
  assert.equal(d.period.start, '2026-10-20');
  assert.equal(d.period.end, '2026-11-18');
  assert.ok(d.used <= 45, `${d.used} outbound requests`);
});

test('the site list comes from sites.json and tools.json, and only listed sites are searched', async () => {
  const d = await load();
  assert.deepEqual(
    d.sites.value.map((s) => [s.domain, s.kind, s.index]),
    [
      ['eventshawk.com', 'site', true],
      ['gigshawk.com', 'site', false],
      ['macrodates.com', 'site', false],
      ['dates.eventfox.workers.dev', 'tool', false],
      ['sky.eventfox.workers.dev', 'tool', false],
      ['units.eventfox.workers.dev', 'tool', false],
    ],
  );
  assert.deepEqual(d.searchDomains, ['eventshawk.com']);
  assert.deepEqual(d.google.value.sites.map((s) => s.domain), ['eventshawk.com']);
});

test('CI: failures and time-outs are counted per workflow and per day, and a failed latest run is failing now', async () => {
  const { ci } = await load();
  const v = ci.value;
  assert.equal(v.failures.length, 8);
  assert.equal(v.failures.filter((f) => f.conclusion === 'timed_out').length, 1);
  assert.equal(v.failedByDay.reduce((a, b) => a + b, 0), 8);
  assert.equal(v.failedByDay.length, 30);
  assert.equal(v.completed, 270 + 120 + 30 + 13);
  assert.deepEqual(v.failingNow.map((w) => w.name), ['Review']);
  const byName = Object.fromEntries(v.workflows.map((w) => [w.name, w]));
  assert.equal(byName['Update data'].failed, 4);
  assert.equal(byName.Deploy.failed, 3);
  assert.equal(byName['Refresh data'].failed, 0);
  // The newest three have their failed job and step; the rest do not cost a request each.
  assert.deepEqual(v.failures[0].jobs, [{ name: 'update', step: 'npm test', url: v.failures[0].jobs[0].url }]);
  assert.equal(v.failures[3].jobs, undefined);
  // Newest first.
  assert.ok(v.failures.every((f, i) => i === 0 || v.failures[i - 1].created >= f.created));
});

test('Actions minutes: private repositories count, public ones and storage do not', async () => {
  const { minutes } = await load();
  const m = minutes.value;
  assert.equal(m.budget, 2000);
  assert.equal(m.free, 18 * 3, 'the public repository’s 3 minutes a day');
  const websites = m.repos.find((r) => r.name === 'richardbenstead/websites');
  assert.equal(websites.isPublic, false);
  assert.equal(m.used, websites.minutes);
  assert.ok(m.repos.find((r) => r.name === 'richardbenstead/richardbenstead').isPublic);
  assert.equal(m.daily.length, 30);
  assert.equal(m.daily.filter((v) => v != null).length, 18);
  assert.equal(m.cumulative[17], m.used);
  assert.equal(m.cumulative[18], null);
  assert.ok(Math.abs(m.projected - (m.used / 17.375) * 30) < 1e-6);
  assert.equal(m.previous.month, 10);
  assert.ok(m.previous.used > 31 * 150 && m.previous.used < 31 * 221);
});

test('Actions minutes: no projection before a full day of the month has gone by', async () => {
  const early = new Date('2026-11-01T09:00:00Z');
  const env = await demoEnv();
  const d = await gather(env, { days: 7, now: early, fetcher: demoFetcher({ now: early }) });
  assert.equal(d.minutes.value.projected, null);
  assert.equal(d.minutes.value.previous.month, 10);
});

test('Cloudflare: zones by day, Web Analytics by host, and search engines told apart by referrer', async () => {
  const { traffic } = await load();
  const t = traffic.value;
  assert.deepEqual(t.zones.map((z) => z.domain), ['eventshawk.com', 'gigshawk.com', 'macrodates.com']);
  assert.ok(t.zones.every((z) => z.uniques.length === 30 && z.uniques.every((u) => u >= 0)));
  assert.equal(t.web.length, 1);
  const w = t.web[0];
  assert.equal(w.domain, 'eventshawk.com');
  assert.ok(w.engines.google > w.engines.bing && w.engines.bing > w.engines.duckduckgo && w.engines.duckduckgo > 0);
  assert.equal(w.duckduckgo.reduce((a, b) => a + b, 0), w.engines.duckduckgo);
  assert.ok(!w.topReferrers.some(([h]) => h === 'eventshawk.com'), 'the site itself is not a referrer');
  assert.ok(w.topReferrers.some(([h]) => h === 'google.com'), 'www. is dropped');
});

test('search engines are recognised by referrer host', () => {
  assert.equal(engineOf('www.google.com'), 'google');
  assert.equal(engineOf('www.google.co.uk'), 'google');
  assert.equal(engineOf('cn.bing.com'), 'bing');
  assert.equal(engineOf('duckduckgo.com'), 'duckduckgo');
  assert.equal(engineOf('html.duckduckgo.com'), 'duckduckgo');
  assert.equal(engineOf('search.brave.com'), 'other');
  assert.equal(engineOf('www.reddit.com'), null);
  assert.equal(engineOf('notgoogle.com'), null);
  assert.equal(engineOf(''), null);
});

test('Google and Bing: totals add up, and days not reported yet are gaps rather than zeros', async () => {
  const d = await load();
  const g = d.google.value.sites[0];
  assert.equal(g.property, 'sc-domain:eventshawk.com');
  assert.equal(g.clicks.at(-1), null);
  assert.equal(g.clicks.at(-2), null);
  assert.notEqual(g.clicks.at(-3), null);
  assert.equal(g.totals.clicks, g.clicks.reduce((a, b) => a + (b || 0), 0));
  assert.ok(g.totals.position > 0 && g.totals.ctr > 0 && g.totals.ctr < 1);
  assert.equal(g.queries.length, 10);
  assert.equal(g.sitemaps[0].submitted, 4180);

  const b = d.bing.value.sites[0];
  assert.equal(b.siteUrl, 'https://eventshawk.com/');
  assert.equal(b.clicks.at(-1), null);
  assert.notEqual(b.clicks.at(-3), null);
  assert.equal(b.queries[0].query, 'f1 race start time');
  assert.ok(b.crawling.inIndex > 2600);
});

test('Search Console properties are matched whole-domain first', () => {
  const entries = [{ siteUrl: 'https://www.eventshawk.com/' }, { siteUrl: 'sc-domain:eventshawk.com' }];
  assert.equal(propertyFor('eventshawk.com', entries), 'sc-domain:eventshawk.com');
  assert.equal(propertyFor('eventshawk.com', [{ siteUrl: 'https://www.eventshawk.com/' }]), 'https://www.eventshawk.com/');
  assert.equal(propertyFor('gigshawk.com', entries), undefined);
});

test('Bing’s .NET dates are read as UTC days', () => {
  assert.equal(bingDate('/Date(1761894000000-0700)/'), '2025-10-31');
  assert.equal(bingDate('/Date(1761894000000)/'), '2025-10-31');
  assert.equal(bingDate('nonsense'), null);
});

test('a site without a property or verification is reported, not dropped', async () => {
  const d = await load({}, (u) => {
    if (u.pathname.endsWith('/webmasters/v3/sites')) return Response.json({ siteEntry: [] });
    if (u.pathname.endsWith('/GetUserSites')) return Response.json({ d: [] });
  });
  assert.deepEqual(d.google.value.sites, [{ domain: 'eventshawk.com', missing: true }]);
  assert.deepEqual(d.bing.value.sites, [{ domain: 'eventshawk.com', missing: true }]);
});

test('one source failing leaves the others, and its error never shows a secret', async () => {
  const d = await load({}, (u) => {
    if (u.hostname === 'api.cloudflare.com') return Response.json({ success: false, errors: [{ message: 'Authentication error' }] }, { status: 403 });
    // An answer that repeats the request, key and all.
    if (u.hostname === 'ssl.bing.com') return new Response(`Bad request: ${u.toString()}`, { status: 400 });
  });
  assert.equal(d.traffic.ok, false);
  assert.match(d.traffic.error, /HTTP 403 \(Authentication error\)/);
  assert.equal(d.bing.ok, false);
  assert.doesNotMatch(d.bing.error, /demo-bing-key-0000/);
  assert.match(d.bing.error, /\[BING_API_KEY\]/);
  assert.ok(d.ci.ok && d.minutes.ok && d.google.ok);
});

test('redact takes every secret out of a message', () => {
  const env = { GITHUB_TOKEN: 'ghp_secretsecret', CF_API_TOKEN: 'cf-secret-token' };
  assert.equal(redact('a ghp_secretsecret b cf-secret-token ghp_secretsecret', env), 'a [GITHUB_TOKEN] b [CF_API_TOKEN] [GITHUB_TOKEN]');
});

test('the request limit stops the sources that would pass it, and the page still draws', async () => {
  const env = await demoEnv({ SUBREQUEST_LIMIT: '6' });
  const d = await gather(env, { days: 30, now: NOW, fetcher: demoFetcher({ now: NOW }) });
  assert.equal(d.used, 6);
  const skipped = ['traffic', 'ci', 'minutes', 'google', 'bing'].filter((k) => !d[k].ok);
  assert.ok(skipped.length >= 1);
  for (const k of skipped) assert.match(d[k].error, /Skipped: this page reached its limit of 6 outbound requests/);
  const res = await handle(new Request('https://x.dev/', { headers: { cookie: `__Host-session=${await demoSession(env)}` } }), env, {
    fetcher: demoFetcher({ now: NOW }),
    now: NOW,
  });
  assert.equal(res.status, 200);
});

test('a second load within the cache time makes no requests, and ?fresh=1 makes them again', async () => {
  const env = await demoEnv();
  let calls = 0;
  const base = demoFetcher({ now: NOW });
  const fetcher = (...a) => (calls++, base(...a));
  await gather(env, { days: 30, now: NOW, fetcher });
  const first = calls;
  const again = await gather(env, { days: 30, now: NOW, fetcher });
  assert.equal(calls, first);
  assert.equal(again.used, 0);
  await gather(env, { days: 30, now: NOW, fetcher, fresh: true });
  assert.ok(calls > first);
});

test('with no tokens set, every source says it is not set up', async () => {
  const env = await demoEnv({ GITHUB_TOKEN: '', CF_API_TOKEN: '', GOOGLE_SERVICE_ACCOUNT: '', BING_API_KEY: '' });
  let calls = 0;
  const d = await gather(env, { days: 30, now: NOW, fetcher: () => calls++ });
  assert.equal(calls, 0);
  for (const k of ['traffic', 'ci', 'minutes', 'google', 'bing']) assert.ok(d[k].setup, k);
  const res = await handle(new Request('https://x.dev/', { headers: { cookie: `__Host-session=${await demoSession(env)}` } }), env, { now: NOW });
  const body = await res.text();
  assert.equal(res.status, 200);
  for (const what of ['Cloudflare', 'GitHub', 'Google Search Console', 'Bing Webmaster Tools']) assert.match(body, new RegExp(`${what} is not set up yet`));
  assert.match(body, /wrangler secret put CF_API_TOKEN/);
});
