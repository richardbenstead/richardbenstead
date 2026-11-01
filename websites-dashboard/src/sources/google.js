// Google Search Console: per property, daily clicks and impressions, the top queries, and the sitemaps' state.
// Signs in as a service account: GOOGLE_SERVICE_ACCOUNT holds its JSON key, and its email must be added as a user
// (Restricted is enough) on each Search Console property.

import { SourceError, failure } from './context.js';
import { b64url } from '../auth.js';
import { sum } from '../format.js';

const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

let token = null; // { value, until }: Google's tokens last an hour, so one serves many page loads.

function serviceAccount(env) {
  let key;
  try {
    key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  } catch {
    throw new SourceError('GOOGLE_SERVICE_ACCOUNT is not valid JSON: paste the whole key file.');
  }
  if (!key.client_email || !key.private_key) throw new SourceError('GOOGLE_SERVICE_ACCOUNT lacks client_email or private_key.');
  return key;
}

// A signed JWT asking for read access to Search Console (RS256, the service account's key).
export async function serviceJwt(key, now = Date.now()) {
  const der = Uint8Array.from(
    atob(key.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')),
    (c) => c.charCodeAt(0),
  );
  const signer = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri || 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

async function accessToken(ctx) {
  if (token && token.until > Date.now()) return token.value;
  const key = serviceAccount(ctx.env);
  const res = await ctx.fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await serviceJwt(key) }),
  });
  if (!res.ok) throw await failure('Google sign-in', res);
  const body = await res.json();
  token = { value: body.access_token, until: Date.now() + ((body.expires_in || 3600) - 120) * 1000 };
  return token.value;
}
export const forgetGoogleToken = () => (token = null);

async function gsc(ctx, label, path, body) {
  const res = await ctx.fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${await accessToken(ctx)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await failure(`Search Console ${label}`, res);
  return res.json();
}

// The property for a domain, preferring the whole-domain one: sc-domain:x, then https://x/, then www and http.
export function propertyFor(domain, entries) {
  const urls = new Set(entries.map((e) => e.siteUrl));
  return [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`, `http://www.${domain}/`].find((u) =>
    urls.has(u),
  );
}

// `domains`: the sites search engines may list. Each gets { domain, property, totals, daily, queries, sitemaps }
// or { domain, missing: true } when the service account cannot see a property for it.
export async function loadGoogle(ctx, domains, period) {
  const { siteEntry = [] } = await gsc(ctx, 'sites', '/sites');
  const visible = siteEntry.filter((e) => e.permissionLevel !== 'siteUnverifiedUser');

  const sites = await Promise.all(
    domains.map(async (domain) => {
      const property = propertyFor(domain, visible);
      if (!property) return { domain, missing: true };
      const base = `/sites/${encodeURIComponent(property)}`;
      const range = { startDate: period.start, endDate: period.end, dataState: 'all' };
      const [daily, queries, sitemaps] = await Promise.all([
        gsc(ctx, 'performance', `${base}/searchAnalytics/query`, { ...range, dimensions: ['date'], rowLimit: 100 }),
        gsc(ctx, 'queries', `${base}/searchAnalytics/query`, { ...range, dimensions: ['query'], rowLimit: 10 }),
        gsc(ctx, 'sitemaps', `${base}/sitemaps`).catch(() => null),
      ]);

      const at = Object.fromEntries((daily.rows || []).map((r) => [r.keys[0], r]));
      // Google reports two or three days late: the days after its newest are gaps, not zeros.
      const newest = Object.keys(at).sort().pop();
      const day = (d, key) => (newest && d > newest ? null : at[d]?.[key] || 0);
      const clicks = period.dates.map((d) => day(d, 'clicks'));
      const impressions = period.dates.map((d) => day(d, 'impressions'));
      const totalClicks = sum(clicks);
      const totalImpressions = sum(impressions);
      // Average position, weighted by impressions as Search Console weights it.
      const weighted = (daily.rows || []).reduce((a, r) => a + r.position * r.impressions, 0);

      return {
        domain,
        property,
        clicks,
        impressions,
        totals: {
          clicks: totalClicks,
          impressions: totalImpressions,
          ctr: totalImpressions ? totalClicks / totalImpressions : null,
          position: totalImpressions ? weighted / totalImpressions : null,
        },
        queries: (queries.rows || []).map((r) => ({
          query: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        })),
        sitemaps: sitemaps
          ? (sitemaps.sitemap || []).map((s) => ({
              path: s.path,
              lastDownloaded: s.lastDownloaded || null,
              pending: !!s.isPending,
              errors: Number(s.errors) || 0,
              warnings: Number(s.warnings) || 0,
              submitted: (s.contents || []).reduce((a, c) => a + (Number(c.submitted) || 0), 0),
            }))
          : null,
      };
    }),
  );
  return { sites, account: serviceAccount(ctx.env).client_email };
}
