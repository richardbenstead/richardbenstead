// Cloudflare: per zone, the daily traffic statistics (unique visitors, requests, page views, cache, threats), and
// per Web Analytics site, the daily visits and page views by referrer, which also give the search-engine split.
// One token, CF_API_TOKEN: Zone > Zone > Read, Zone > Analytics > Read and Account > Account Analytics > Read.
//
// "Unique visitors" here is Cloudflare's own figure: distinct IP addresses a day, bots included, so it overstates
// people. Web Analytics' "visits" (page views arriving from another site or from nowhere) is closer to people but
// only exists where the beacon is on the page.

import { SourceError, failure, settle, bareHost } from './context.js';

const API = 'https://api.cloudflare.com/client/v4';

async function cf(ctx, path, init = {}) {
  const res = await ctx.fetch(API + path, {
    ...init,
    headers: { authorization: `Bearer ${ctx.env.CF_API_TOKEN}`, 'content-type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw await failure(`Cloudflare ${path.split('?')[0]}`, res);
  const body = await res.json();
  if (body.success === false) throw new SourceError(`Cloudflare ${path}: ${body.errors?.[0]?.message || 'refused'}`);
  return body;
}

async function graphql(ctx, label, query) {
  const body = await cf(ctx, '/graphql', { method: 'POST', body: JSON.stringify({ query }) });
  if (body.errors?.length) throw new SourceError(`Cloudflare ${label}: ${body.errors[0].message}`);
  return body.data;
}

// Values go into the query as JSON literals, which GraphQL reads the same way; all of them are ours (zone ids,
// dates), never page input.
const lit = (v) => JSON.stringify(v);

// Search engines by referrer host. DuckDuckGo has no webmaster tools, so its referrals are the only measure of it.
const ENGINES = [
  ['google', /(^|\.)google\.[a-z.]+$/],
  ['bing', /(^|\.)bing\.com$/],
  ['duckduckgo', /(^|\.)duckduckgo\.com$/],
  ['other', /(^|\.)(yahoo\.com|yahoo\.co\.jp|ecosia\.org|search\.brave\.com|yandex\.[a-z]+|baidu\.com|startpage\.com|qwant\.com|kagi\.com|ask\.com|naver\.com|seznam\.cz)$/],
];
export const engineOf = (host) => ENGINES.find(([, re]) => re.test(bareHost(host)))?.[0] || null;

export async function loadTraffic(ctx, period) {
  const zones = (await cf(ctx, '/zones?per_page=50')).result || [];
  const accountId = ctx.env.CF_ACCOUNT_ID || zones[0]?.account?.id || null;

  const zoneQuery = zones.length
    ? graphql(
        ctx,
        'zone analytics',
        `{ viewer { zones(filter: { zoneTag_in: ${lit(zones.map((z) => z.id))} }) {
            zoneTag
            httpRequests1dGroups(limit: 1000, filter: { date_geq: ${lit(period.start)}, date_leq: ${lit(period.end)} }) {
              dimensions { date }
              uniq { uniques }
              sum { requests pageViews cachedRequests bytes threats }
            }
          } } }`,
      )
    : Promise.resolve({ viewer: { zones: [] } });

  const rumQuery = accountId
    ? graphql(
        ctx,
        'Web Analytics',
        `{ viewer { accounts(filter: { accountTag: ${lit(accountId)} }) {
            # ponytail: one row per day, host and referrer, up to 10,000 (the most Cloudflare gives). Ample for these
            # sites; a site with thousands of referrers a day would lose its smallest ones from the totals.
            rumPageloadEventsAdaptiveGroups(limit: 10000, filter: {
              datetime_geq: ${lit(`${period.start}T00:00:00Z`)}, datetime_leq: ${lit(new Date(ctx.now).toISOString())}
            }) {
              count
              sum { visits }
              dimensions { date requestHost refererHost }
            }
          } } }`,
      )
    : Promise.reject(new SourceError('Cloudflare Web Analytics: no account id (set CF_ACCOUNT_ID).'));

  const [zoneData, rumData] = await Promise.all([settle(zoneQuery, ctx.env), settle(rumQuery, ctx.env)]);
  if (!zoneData.ok) throw new SourceError(zoneData.error);

  const index = Object.fromEntries(period.dates.map((d, i) => [d, i]));
  const blank = () => period.dates.map(() => 0);

  const byZone = new Map((zoneData.value.viewer?.zones || []).map((z) => [z.zoneTag, z.httpRequests1dGroups || []]));
  const zonesOut = zones.map((z) => {
    const series = { uniques: blank(), requests: blank(), pageViews: blank(), cached: blank(), bytes: blank(), threats: blank() };
    for (const g of byZone.get(z.id) || []) {
      const i = index[g.dimensions?.date];
      if (i === undefined) continue;
      series.uniques[i] = g.uniq?.uniques || 0;
      series.requests[i] = g.sum?.requests || 0;
      series.pageViews[i] = g.sum?.pageViews || 0;
      series.cached[i] = g.sum?.cachedRequests || 0;
      series.bytes[i] = g.sum?.bytes || 0;
      series.threats[i] = g.sum?.threats || 0;
    }
    return { id: z.id, domain: bareHost(z.name), plan: z.plan?.name || null, status: z.status, ...series };
  });

  // Web Analytics, per host: visits and page views a day, and visits by referrer host and by search engine.
  let web = null;
  let webError = null;
  if (rumData.ok) {
    web = new Map();
    for (const g of rumData.value.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups || []) {
      const host = bareHost(g.dimensions?.requestHost);
      const i = index[g.dimensions?.date];
      if (!host || i === undefined) continue;
      const site =
        web.get(host) ||
        { domain: host, visits: blank(), pageViews: blank(), referrers: new Map(), engines: { google: 0, bing: 0, duckduckgo: 0, other: 0 }, duckduckgo: blank() };
      const visits = g.sum?.visits || 0;
      site.visits[i] += visits;
      site.pageViews[i] += g.count || 0;
      const ref = bareHost(g.dimensions?.refererHost);
      if (ref && ref !== host) site.referrers.set(ref, (site.referrers.get(ref) || 0) + visits);
      const engine = engineOf(ref);
      if (engine) site.engines[engine] += visits;
      if (engine === 'duckduckgo') site.duckduckgo[i] += visits;
      web.set(host, site);
    }
    for (const site of web.values()) {
      site.topReferrers = [...site.referrers].sort((a, b) => b[1] - a[1]).slice(0, 8);
      delete site.referrers;
    }
  } else {
    webError = rumData.error;
  }

  return { zones: zonesOut, web: web ? [...web.values()] : null, webError };
}
