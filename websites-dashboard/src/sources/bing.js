// Bing Webmaster Tools: per verified site, daily clicks and impressions, top queries, and crawling and the index.
// BING_API_KEY comes from Bing Webmaster Tools > Settings > API access. DuckDuckGo's results lean heavily on
// Bing's index, so this is also the nearest thing to DuckDuckGo's view of the sites.

import { SourceError, failure, bareHost } from './context.js';
import { sum } from '../format.js';

const API = 'https://ssl.bing.com/webmaster/api.svc/json';

async function bing(ctx, method, params = {}) {
  const url = new URL(`${API}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apikey', ctx.env.BING_API_KEY);
  const res = await ctx.fetch(url.toString(), { headers: { accept: 'application/json' } });
  // failure() never repeats the URL, which carries the key.
  if (!res.ok) throw await failure(`Bing ${method}`, res);
  const body = await res.json();
  if (body?.ErrorCode) throw new SourceError(`Bing ${method}: ${body.Message || `error ${body.ErrorCode}`}`);
  return Array.isArray(body?.d) ? body.d : [];
}

// Bing's dates are .NET JSON dates, "/Date(1730000000000-0700)/": milliseconds since 1970 in UTC.
export function bingDate(s) {
  const m = /\/Date\((-?\d+)/.exec(String(s));
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

export async function loadBing(ctx, domains, period) {
  const verified = (await bing(ctx, 'GetUserSites')).filter((s) => s.IsVerified !== false);
  const hostOf = (u) => {
    try {
      return bareHost(new URL(u).hostname);
    } catch {
      return '';
    }
  };
  const urlFor = (domain) => verified.find((s) => hostOf(s.Url) === domain)?.Url;

  const sites = await Promise.all(
    domains.map(async (domain) => {
      const siteUrl = urlFor(domain);
      if (!siteUrl) return { domain, missing: true };
      const [traffic, queries, crawl] = await Promise.all([
        bing(ctx, 'GetRankAndTrafficStats', { siteUrl }),
        bing(ctx, 'GetQueryStats', { siteUrl }),
        bing(ctx, 'GetCrawlStats', { siteUrl }).catch(() => null),
      ]);

      const inPeriod = (row) => {
        const d = bingDate(row.Date);
        return d && d >= period.start && d <= period.end;
      };
      const at = {};
      for (const r of traffic) {
        const d = bingDate(r.Date);
        if (d) at[d] = r;
      }
      // Bing reports a day or two late: the days after its newest are gaps, not zeros.
      const newest = Object.keys(at).sort().pop();
      const day = (d, key) => (newest && d > newest ? null : at[d]?.[key] || 0);
      const clicks = period.dates.map((d) => day(d, 'Clicks'));
      const impressions = period.dates.map((d) => day(d, 'Impressions'));
      const totalClicks = sum(clicks);
      const totalImpressions = sum(impressions);

      // Bing reports queries in weekly rows, each dated by its first day; add up the weeks that overlap the period.
      const weekStart = new Date(Date.parse(`${period.start}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
      const overlaps = (row) => {
        const d = bingDate(row.Date);
        return d && d >= weekStart && d <= period.end;
      };
      const byQuery = new Map();
      for (const r of queries.filter(overlaps)) {
        const q = byQuery.get(r.Query) || { query: r.Query, clicks: 0, impressions: 0, positionWeight: 0 };
        q.clicks += r.Clicks || 0;
        q.impressions += r.Impressions || 0;
        q.positionWeight += (r.AvgImpressionPosition || 0) * (r.Impressions || 0);
        byQuery.set(r.Query, q);
      }
      const topQueries = [...byQuery.values()]
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .slice(0, 10)
        .map((q) => ({
          query: q.query,
          clicks: q.clicks,
          impressions: q.impressions,
          ctr: q.impressions ? q.clicks / q.impressions : null,
          position: q.impressions ? q.positionWeight / q.impressions : null,
        }));

      let crawling = null;
      if (crawl) {
        const rows = crawl.filter(inPeriod).sort((a, b) => bingDate(a.Date).localeCompare(bingDate(b.Date)));
        const latest = [...crawl].sort((a, b) => (bingDate(b.Date) || '').localeCompare(bingDate(a.Date) || ''))[0];
        crawling = {
          crawled: rows.reduce((a, r) => a + (r.CrawledPages || 0), 0),
          errors: rows.reduce((a, r) => a + (r.CrawlErrors || 0), 0),
          inIndex: latest?.InIndex ?? null,
          inIndexOn: latest ? bingDate(latest.Date) : null,
          blocked: rows.reduce((a, r) => a + (r.BlockedByRobotsTxt || 0), 0),
          code5xx: rows.reduce((a, r) => a + (r.Code5xx || 0), 0),
          code4xx: rows.reduce((a, r) => a + (r.Code4xx || 0), 0),
        };
      }

      return {
        domain,
        siteUrl,
        clicks,
        impressions,
        totals: { clicks: totalClicks, impressions: totalImpressions, ctr: totalImpressions ? totalClicks / totalImpressions : null },
        queries: topQueries,
        crawling,
      };
    }),
  );
  return { sites };
}
