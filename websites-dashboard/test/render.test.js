import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { clearCache } from '../src/sources/context.js';
import { forgetGoogleToken, serviceJwt } from '../src/sources/google.js';
import { ticks, lineChart, columnChart } from '../src/charts.js';
import { html, raw } from '../src/html.js';
import { makePeriod, monthToDate, fmtCompact, fmtAgo } from '../src/format.js';
import { demoEnv, demoFetcher, demoSession } from '../dev/fixtures.js';

const NOW = new Date('2026-11-18T09:00:00Z');

beforeEach(() => {
  clearCache();
  forgetGoogleToken();
});

async function dashboard(days = 30) {
  const env = await demoEnv();
  const res = await handle(
    new Request(`https://x.dev/?days=${days}`, { headers: { cookie: `__Host-session=${await demoSession(env)}` } }),
    env,
    { fetcher: demoFetcher({ now: NOW }), now: NOW },
  );
  assert.equal(res.status, 200);
  return res.text();
}

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('the page has every section, and every chart carries its data for the tooltips', async () => {
  const body = await dashboard();
  for (const id of ['traffic', 'ci', 'minutes', 'google', 'bing', 'duckduckgo']) assert.match(body, new RegExp(`<section id="${id}"`));
  const specs = [...body.matchAll(/data-chart="([^"]*)"/g)].map((m) => JSON.parse(unescape(m[1])));
  assert.ok(specs.length >= 10);
  for (const s of specs) {
    assert.ok(s.labels.length > 0);
    for (const series of s.series) assert.equal(series.values.length, s.labels.length);
  }
  // Every chart has a table, so no value is reachable only by hovering.
  assert.equal((body.match(/<details class="tv">/g) || []).length, specs.length);
});

test('text from the APIs is escaped: search queries and commit titles cannot add markup', async () => {
  const body = await dashboard();
  assert.ok(!body.includes('<script>alert(1)</script>'));
  assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!body.includes('<b>&</b>'));
  assert.ok(body.includes('K-pop collection page &lt;b&gt;&amp;&lt;/b&gt; &quot;quoted&quot;'));
  // The only scripts are the page's own.
  assert.deepEqual([...body.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['<script src="/app.js" defer>']);
});

test('the period links change the period, and anything else falls back to 30 days', async () => {
  assert.match(await dashboard(7), /aria-current="page">7 days/);
  assert.match(await dashboard(99), /aria-current="page">30 days/);
});

test('Cloudflare’s charts end with yesterday, the last full day', async () => {
  const body = await dashboard();
  const first = JSON.parse(unescape(/<section id="traffic".*?data-chart="([^"]*)"/s.exec(body)[1]));
  assert.equal(first.labels.length, 29);
  assert.equal(first.labels.at(-1), 'Tue 17 Nov');
});

test('the CI chart keeps today and says it is not over', async () => {
  const body = await dashboard();
  const ci = JSON.parse(unescape(/<section id="ci".*?data-chart="([^"]*)"/s.exec(body)[1]));
  assert.equal(ci.labels.at(-1), 'Wed 18 Nov (so far)');
});

test('html escapes values and leaves raw ones alone', () => {
  assert.equal(String(html`<p title="${'"x"'}">${'<b>'}${raw('<i>ok</i>')}${null}${false}${[1, '<']}</p>`), '<p title="&quot;x&quot;">&lt;b&gt;<i>ok</i>1&lt;</p>');
});

test('ticks are clean numbers from zero to at least the highest value', () => {
  assert.deepEqual(ticks(754), [0, 500, 1000]);
  assert.deepEqual(ticks(3), [0, 1, 2, 3]);
  assert.deepEqual(ticks(0), [0, 1]);
  assert.deepEqual(ticks(0.4), [0, 1]);
  assert.deepEqual(ticks(0.042, { integer: false }), [0, 0.02, 0.04, 0.06]);
  assert.deepEqual(ticks(5822), [0, 2000, 4000, 6000]);
  for (const max of [1, 7, 13, 99, 101, 1234, 99999]) {
    const t = ticks(max);
    assert.ok(t.at(-1) >= max && t.length <= 5, `${max}: ${t}`);
  }
});

test('a line chart breaks at missing days and draws a dashed series without a wash or end dot', () => {
  const out = String(
    lineChart({
      dates: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'],
      series: [
        { name: 'Used', values: [1, 2, null, null], slot: 1 },
        { name: 'At this pace', values: [null, 2, 3, 4], slot: 1, dashed: true },
      ],
    }),
  );
  assert.equal((out.match(/class="wash/g) || []).length, 1);
  assert.equal((out.match(/class="dot/g) || []).length, 1);
  assert.match(out, /class="stroke s1 dashed"/);
  assert.match(out, /<ul class="legend">/);
});

test('a column chart draws nothing for a zero', () => {
  const out = String(columnChart({ dates: ['2026-11-01', '2026-11-02'], series: [{ name: 'Failed', values: [0, 2], cls: 'critical' }] }));
  assert.equal((out.match(/class="bar critical"/g) || []).length, 1);
  assert.match(out, /style="height:100%"/);
});

test('periods and months are UTC days', () => {
  const p = makePeriod(7, new Date('2026-11-02T23:30:00Z'));
  assert.deepEqual(p.dates, ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  const m = monthToDate(new Date('2026-02-10T12:00:00Z'));
  assert.equal(m.dates.length, 28);
  assert.equal(m.today, '2026-02-10');
  assert.equal(m.elapsed, 9.5);
});

test('numbers are compact past ten thousand, and times read as how long ago', () => {
  assert.equal(fmtCompact(9999), '9,999');
  assert.equal(fmtCompact(12900), '12.9K');
  assert.equal(fmtCompact(4_200_000), '4.2M');
  const now = Date.parse('2026-11-18T09:00:00Z');
  assert.equal(fmtAgo('2026-11-18T08:59:30Z', now), 'just now');
  assert.equal(fmtAgo('2026-11-18T08:40:00Z', now), '20 min ago');
  assert.equal(fmtAgo('2026-11-18T04:00:00Z', now), '5 h ago');
  assert.equal(fmtAgo('2026-11-15T09:00:00Z', now), '3 days ago');
});

test('the Google service-account token request is a JWT signed with the account’s key', async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64').replace(/.{64}/g, '$&\n')}\n-----END PRIVATE KEY-----\n`;
  const jwt = await serviceJwt({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: pem }, Date.parse('2026-11-18T09:00:00Z'));
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), {
    iss: 'sa@x.iam.gserviceaccount.com',
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: Date.parse('2026-11-18T09:00:00Z') / 1000,
    exp: Date.parse('2026-11-18T09:00:00Z') / 1000 + 3600,
  });
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
  assert.ok(ok);
});
