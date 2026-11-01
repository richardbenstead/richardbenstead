// The dashboard page and the sign-in pages. Each source renders on its own: one that is not set up shows how to
// set it up, one that fails shows why, and the rest of the page is unaffected.

import { html, raw } from './html.js';
import { lineChart, columnChart, tile, meter, segmented, badge, statusIcon } from './charts.js';
import { fmtInt, fmtCompact, fmtPct, fmtDec, fmtMoney, fmtBytes, fmtDay, fmtTime, fmtAgo, sum } from './format.js';
import { FAILED } from './sources/github.js';

export const PERIODS = [7, 14, 30];

export function layout(title, body) {
  return `<!doctype html>${html`<html lang="en-GB"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
</head><body>${body}</body></html>`}`;
}

const mark = raw(
  '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8"/><path d="M7 21l5-6 4 3 7-9" /><circle cx="23" cy="9" r="2"/></svg>',
);

// ---------- Sign-in pages ----------

export function signInPage({ problem, message, user, status = 200 }) {
  const body = html`<main class="gate">
    <div class="card gate-card">
      ${mark}
      <h1>Websites dashboard</h1>
      ${message ? html`<p class="gate-msg">${badge(status === 403 ? 'critical' : 'warning', message)}</p>` : ''}
      ${user ? html`<p class="muted">Signed in to GitHub as <strong>@${user.login}</strong> (account id ${user.id}). To get in, add that id to ALLOWED_GITHUB_IDS.</p>` : ''}
      ${problem
        ? html`<p>${badge('warning', problem)}</p><p class="muted">Set it with <code>npx wrangler secret put NAME</code>, or in <code>wrangler.jsonc</code> for ALLOWED_GITHUB_IDS. The README in websites-dashboard has the steps.</p>`
        : html`<a class="button" href="/login">${raw('<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0z"/></svg>')}Sign in with GitHub</a>
           <p class="muted">Only the GitHub accounts listed in the settings can open it.</p>`}
    </div>
  </main>`;
  return layout('Sign in: Websites dashboard', body);
}

// ---------- Shared pieces ----------

const section = (id, title, sub, body) =>
  html`<section id="${id}" class="section"><header class="section-head"><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</header>${body}</section>`;

const setupCard = (what, steps) =>
  html`<div class="card note"><p>${badge('neutral', `${what} is not set up yet.`)}</p><ol>${steps.map((s) => html`<li>${s}</li>`)}</ol></div>`;

const errorCard = (error, hint) =>
  html`<div class="card note"><p>${badge('critical', 'Could not load')}</p><p class="err">${error}</p>${hint ? html`<p class="muted">${hint}</p>` : ''}</div>`;

const siteHead = (name, domain, extra) =>
  html`<header class="card-head"><h3>${name}</h3><a href="https://${domain}/" rel="noreferrer" target="_blank">${domain}</a>${extra ? html`<span class="muted">${extra}</span>` : ''}</header>`;

// Cloudflare's figures for today are still filling in, so charts of them end with yesterday, the last full day.
const fullDays = (values) => (values.length > 1 ? values.slice(0, -1) : values);
const fullDayAverage = (values) => {
  const full = fullDays(values);
  return full.length ? sum(full) / full.length : null;
};

// How a run started, in words.
const EVENTS = { schedule: 'on its schedule', push: 'after a push', workflow_dispatch: 'started by hand', pull_request: 'for a pull request', workflow_run: 'after another workflow' };

const runLink = (repo, w) => `https://github.com/${repo}/actions/workflows/${String(w.path).split('/').pop()}`;

function conclusionBadge(run) {
  if (!run) return badge('neutral', 'No runs');
  if (run.status && run.status !== 'completed') return badge('running', 'Running');
  if (run.conclusion === 'success') return badge('good', 'Passed');
  if (run.conclusion === 'timed_out') return badge('critical', 'Timed out');
  if (FAILED.has(run.conclusion)) return badge('critical', 'Failed');
  if (run.conclusion === 'cancelled') return badge('neutral', 'Cancelled');
  return badge('neutral', run.conclusion ? run.conclusion.replace(/_/g, ' ') : 'Unknown');
}

function queriesTable(queries, caption) {
  if (!queries?.length) return html`<p class="muted small">No search queries in the period.</p>`;
  return html`<div class="tv-scroll"><table class="data">
    <caption>${caption}</caption>
    <thead><tr><th scope="col">Query</th><th scope="col" class="num">Clicks</th><th scope="col" class="num">Impressions</th><th scope="col" class="num">CTR</th><th scope="col" class="num">Position</th></tr></thead>
    <tbody>${queries.map(
      (q) => html`<tr><th scope="row" class="wrap">${q.query}</th><td class="num">${fmtInt(q.clicks)}</td><td class="num">${fmtInt(q.impressions)}</td><td class="num">${fmtPct(q.ctr)}</td><td class="num">${fmtDec(q.position)}</td></tr>`,
    )}</tbody></table></div>`;
}

const hiddenNote = (hidden) =>
  hidden.length
    ? html`<p class="muted small">Not checked, as search engines are kept away from them (<code>index</code> is false in the websites repo): ${hidden.map((s) => s.domain).join(', ')}.</p>`
    : '';

// ---------- Sections ----------

function trafficSection(d) {
  const r = d.traffic;
  if (r.setup)
    return setupCard('Cloudflare', [
      html`Create a Cloudflare API token with <strong>Zone › Zone › Read</strong>, <strong>Zone › Analytics › Read</strong> and <strong>Account › Account Analytics › Read</strong>, for all zones.`,
      html`Save it with <code>npx wrangler secret put CF_API_TOKEN</code>.`,
    ]);
  if (!r.ok) return errorCard(r.error, 'The token needs Zone › Zone › Read and Zone › Analytics › Read.');

  const { zones, web, webError } = r.value;
  const sites = d.sites.ok ? d.sites.value : [];
  const known = new Set(sites.map((s) => s.domain));
  const rows = [...sites, ...zones.filter((z) => !known.has(z.domain)).map((z) => ({ domain: z.domain, name: z.domain, kind: 'zone' }))];
  const measured = [];
  const unmeasured = [];
  for (const s of rows) {
    const zone = zones.find((z) => z.domain === s.domain);
    const w = web?.find((x) => x.domain === s.domain);
    (zone || w ? measured : unmeasured).push({ s, zone, w });
  }
  const dates = fullDays(d.period.dates);

  const overview = measured.length
    ? html`<div class="card"><div class="tv-scroll"><table class="data">
        <caption>All sites, last ${d.days} days</caption>
        <thead><tr><th scope="col">Site</th><th scope="col" class="num">Unique visitors a day</th><th scope="col" class="num">Page views</th><th scope="col" class="num">Visits</th><th scope="col" class="num">From search</th></tr></thead>
        <tbody>${measured.map(({ s, zone, w }) => {
          const searchVisits = w ? sum(Object.values(w.engines)) : null;
          return html`<tr><th scope="row">${s.name}<span class="muted block">${s.domain}</span></th>
            <td class="num">${zone ? fmtInt(fullDayAverage(zone.uniques)) : '–'}</td>
            <td class="num">${zone ? fmtCompact(sum(zone.pageViews)) : '–'}</td>
            <td class="num">${w ? fmtCompact(sum(w.visits)) : '–'}</td>
            <td class="num">${w ? `${fmtCompact(searchVisits)} (${fmtPct(sum(w.visits) ? searchVisits / sum(w.visits) : null, 0)})` : '–'}</td></tr>`;
        })}</tbody></table></div>
        <p class="muted small">Unique visitors and page views: Cloudflare's traffic statistics (distinct IP addresses a day, bots included). Visits: Cloudflare Web Analytics, only where its beacon is on the pages.</p></div>`
    : '';

  const cards = measured.map(({ s, zone, w }) => {
    const tiles = [];
    if (zone) {
      const requests = sum(zone.requests);
      tiles.push(
        tile({ label: 'Unique visitors a day', value: fmtInt(fullDayAverage(zone.uniques)), note: `average of full days` }),
        tile({ label: 'Page views', value: fmtCompact(sum(zone.pageViews)) }),
        tile({ label: 'Requests', value: fmtCompact(requests), note: `${fmtPct(requests ? sum(zone.cached) / requests : null, 0)} from cache, ${fmtBytes(sum(zone.bytes))}` }),
        tile({ label: 'Threats stopped', value: fmtInt(sum(zone.threats)) }),
      );
    }
    if (w) tiles.push(tile({ label: 'Visits', value: fmtCompact(sum(w.visits)), note: 'Web Analytics' }));
    return html`<article class="card site">
      ${siteHead(s.name, s.domain, s.kind === 'zone' ? 'not in the websites repo' : '')}
      <div class="tiles">${tiles}</div>
      ${zone ? lineChart({ title: 'Unique visitors a day', dates, series: [{ name: 'Unique visitors', values: fullDays(zone.uniques), slot: 1 }] }) : ''}
      ${w
        ? lineChart({
            title: 'Visits and page views a day (Web Analytics)',
            dates,
            series: [
              { name: 'Page views', values: fullDays(w.pageViews), slot: 1, area: false },
              { name: 'Visits', values: fullDays(w.visits), slot: 2, area: false },
            ],
          })
        : ''}
      ${w?.topReferrers?.length
        ? html`<div class="tv-scroll"><table class="data"><caption>Top referrers</caption>
            <thead><tr><th scope="col">From</th><th scope="col" class="num">Visits</th></tr></thead>
            <tbody>${w.topReferrers.map(([host, n]) => html`<tr><th scope="row">${host}</th><td class="num">${fmtInt(n)}</td></tr>`)}</tbody></table></div>`
        : ''}
    </article>`;
  });

  return html`${overview}<div class="grid-cards">${cards}</div>
    ${unmeasured.length
      ? html`<div class="card note"><p>${badge('neutral', 'Not measured')}</p><p>${unmeasured.map((u) => `${u.s.name} (${u.s.domain})`).join(', ')}.</p>
          <p class="muted small">Sites on workers.dev have no Cloudflare zone, so no traffic statistics, and their pages carry no Web Analytics beacon yet. Once they do, their visits appear here by themselves.</p></div>`
      : ''}
    ${webError ? html`<p class="muted small">${statusIcon('warning')} Web Analytics could not be read: ${webError} The token needs Account › Account Analytics › Read.</p>` : ''}`;
}

function ciSection(d) {
  const r = d.ci;
  if (r.setup) return setupCard('GitHub', githubSteps(d));
  if (!r.ok) return errorCard(r.error, 'The token needs Actions: read on the websites repository.');
  const ci = r.value;
  const failed = ci.failures.length;
  const rate = ci.completed ? failed / ci.completed : null;
  const last = ci.failures[0];

  const tiles = html`<div class="tiles">
    ${tile({ label: 'Failed runs', value: fmtInt(failed), icon: failed ? 'critical' : 'good', note: `of ${fmtInt(ci.completed)} completed` })}
    ${tile({ label: 'Failure rate', value: fmtPct(rate) })}
    ${tile({
      label: 'Failing now',
      value: fmtInt(ci.failingNow.length),
      icon: ci.failingNow.length ? 'critical' : 'good',
      note: ci.failingNow.length ? ci.failingNow.map((w) => w.name).join(', ') : 'every latest run passed',
    })}
    ${tile({ label: 'Last failure', value: last ? fmtAgo(last.created, d.now) : 'None', note: last ? last.name : `in ${d.days} days` })}
  </div>`;

  const chart = failed
    ? columnChart({
        title: 'Failed runs a day',
        dates: d.period.dates,
        partialLast: true,
        series: [{ name: 'Failed runs', values: ci.failedByDay, cls: 'critical', format: 'int' }],
      })
    : html`<p>${badge('good', `No failed runs in the last ${d.days} days.`)}</p>`;

  const table = html`<div class="tv-scroll"><table class="data">
    <caption>Workflows in ${ci.repo}</caption>
    <thead><tr><th scope="col">Workflow</th><th scope="col">Latest run</th><th scope="col" class="num">Runs</th><th scope="col" class="num">Failed</th><th scope="col" class="num">Rate</th><th scope="col">Last failed</th></tr></thead>
    <tbody>${ci.workflows.map(
      (w) => html`<tr>
        <th scope="row"><a href="${runLink(ci.repo, w)}" rel="noreferrer" target="_blank">${w.name}</a></th>
        <td>${w.latest ? html`<a href="${w.latest.url}" rel="noreferrer" target="_blank" title="${fmtTime(w.latest.updated, d.timeZone)}">${conclusionBadge(w.latest)}</a>` : conclusionBadge(null)}</td>
        <td class="num">${fmtInt(w.completed)}</td>
        <td class="num">${fmtInt(w.failed)}</td>
        <td class="num">${fmtPct(w.completed ? w.failed / w.completed : null, 0)}</td>
        <td>${w.lastFailure ? html`<span title="${fmtTime(w.lastFailure.created, d.timeZone)}">${fmtAgo(w.lastFailure.created, d.now)}</span>` : html`<span class="muted">–</span>`}</td>
      </tr>`,
    )}</tbody></table></div>`;

  const list = failed
    ? html`<h4 class="sub">Recent failures</h4><ul class="runs">${ci.failures.slice(0, 8).map(
        (f) => html`<li>
          <div class="run-top">${conclusionBadge(f)}<a href="${f.url}" rel="noreferrer" target="_blank"><strong>${f.name}</strong></a>
            <span class="muted" title="${fmtTime(f.created, d.timeZone)}">${fmtAgo(f.created, d.now)}</span></div>
          <div class="run-title">${f.title}</div>
          <div class="muted small">On ${f.branch}, ${EVENTS[f.event] || f.event}${f.attempt > 1 ? `, attempt ${f.attempt}` : ''}</div>
          ${f.jobs?.length
            ? html`<ul class="jobs">${f.jobs.map((j) => html`<li><a href="${j.url}" rel="noreferrer" target="_blank">${j.name}</a>${j.step ? html` <span class="muted">failed at</span> ${j.step}` : ''}</li>`)}</ul>`
            : ''}
        </li>`,
      )}</ul>${ci.truncated ? html`<p class="muted small">More than 100 failures in the period: the counts cover the newest 100 of each kind.</p>` : ''}`
    : '';

  return html`<div class="card">${tiles}${chart}${table}${list}</div>`;
}

const githubSteps = (d) => [
  html`Create a fine-grained personal access token (GitHub › Settings › Developer settings) for <strong>${d.repo}</strong> with <strong>Actions: read</strong> and <strong>Contents: read</strong>, and the account permission <strong>Plan: read</strong> for the minutes.`,
  html`Save it with <code>npx wrangler secret put GITHUB_TOKEN</code>.`,
];

const monthName = ({ year, month }) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

function minutesSection(d) {
  const r = d.minutes;
  if (r.setup) return setupCard('GitHub', githubSteps(d));
  if (!r.ok)
    return errorCard(
      r.error,
      'Reading the billing report needs the token’s account permission Plan: read, and an account on GitHub’s enhanced billing platform.',
    );
  const m = r.value;
  const month = d.month;
  const frac = m.budget ? m.used / m.budget : 0;
  const todayIndex = month.dates.indexOf(month.today);
  const rate = month.elapsed > 0 ? m.used / month.elapsed : 0;
  const pace = m.projected == null ? null : month.dates.map((_, i) => (i < todayIndex ? null : i === todayIndex ? m.cumulative[i] : rate * (i + 1)));
  const daysLeft = month.dates.length - todayIndex - 1;
  const over = m.projected != null && m.projected > m.budget;

  const tiles = html`<div class="tiles">
    ${tile({ label: 'Minutes used', value: fmtInt(m.used), note: html`of ${fmtInt(m.budget)} included, ${fmtPct(frac, 0)}${meter(frac, 'Share of the included minutes used')}` })}
    ${tile({ label: 'At this pace', value: m.projected == null ? '–' : fmtInt(m.projected), icon: over ? 'warning' : m.projected != null ? 'good' : null, note: over ? `${fmtInt(m.projected - m.budget)} over by the month’s end` : 'by the month’s end' })}
    ${tile({ label: 'Left this month', value: fmtInt(Math.max(0, m.budget - m.used)), note: `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to go` })}
    ${m.previous ? tile({ label: `In ${monthName(m.previous)}`, value: fmtInt(m.previous.used), icon: m.previous.used > m.budget ? 'warning' : null, note: `${fmtPct(m.budget ? m.previous.used / m.budget : null, 0)} of the included minutes` }) : ''}
    ${tile({ label: 'Billed so far', value: fmtMoney(m.net), note: 'after the included minutes' })}
  </div>`;

  const chart = lineChart({
    title: `Minutes used in ${monthName(month)}, running total`,
    dates: month.dates,
    height: 150,
    series: [
      { name: 'Used', values: m.cumulative, slot: 1 },
      ...(pace ? [{ name: 'At this pace', values: pace, slot: 1, dashed: true }] : []),
    ],
    refs: [{ value: m.budget, label: `Included: ${fmtInt(m.budget)}` }],
  });

  const repos = m.repos.length
    ? html`<div class="tv-scroll"><table class="data"><caption>By repository</caption>
        <thead><tr><th scope="col">Repository</th><th scope="col" class="num">Minutes</th><th scope="col">Counts</th></tr></thead>
        <tbody>${m.repos.map(
          (x) => html`<tr><th scope="row">${x.name}</th><td class="num">${fmtInt(x.minutes)}</td><td>${x.isPublic ? html`<span class="muted">No: public, free</span>` : 'Yes'}</td></tr>`,
        )}</tbody></table></div>`
    : html`<p class="muted small">No Actions minutes yet this month.</p>`;

  return html`<div class="card">${tiles}${chart}${repos}
    <p class="muted small">Month to date for @${m.user}, from GitHub’s billing report; it starts again on the 1st (UTC) and the period above does not apply. Windows and macOS minutes count double and tenfold, as GitHub counts them. Included minutes: ACTIONS_MINUTES_BUDGET.</p></div>`;
}

function searchSetup(d, which) {
  if (which === 'google')
    return setupCard('Google Search Console', [
      html`In Google Cloud, create a service account, turn on the <strong>Google Search Console API</strong> for its project, and download a JSON key.`,
      html`In Search Console, add the service account’s email as a user (Restricted is enough) on each property.`,
      html`Save the key with <code>npx wrangler secret put GOOGLE_SERVICE_ACCOUNT &lt; key.json</code>.`,
    ]);
  return setupCard('Bing Webmaster Tools', [
    html`In Bing Webmaster Tools, open Settings › API access and generate an API key.`,
    html`Save it with <code>npx wrangler secret put BING_API_KEY</code>.`,
  ]);
}

function searchSites(d) {
  if (!d.sites.ok) return { checked: d.searchDomains.map((domain) => ({ domain, name: domain })), hidden: [] };
  return { checked: d.sites.value.filter((s) => s.index), hidden: d.sites.value.filter((s) => !s.index) };
}

function googleSection(d) {
  const r = d.google;
  if (r.setup) return searchSetup(d, 'google');
  if (!r.ok) return errorCard(r.error);
  const { checked, hidden } = searchSites(d);
  const nameOf = (domain) => checked.find((s) => s.domain === domain)?.name || domain;
  const cards = r.value.sites.map((g) => {
    if (g.missing)
      return html`<article class="card site">${siteHead(nameOf(g.domain), g.domain)}<p>${badge('warning', 'No Search Console property found')}</p>
        <p class="muted small">Add <code>${r.value.account}</code> as a user on the property for ${g.domain}.</p></article>`;
    const sitemaps = g.sitemaps?.length
      ? html`<div class="tv-scroll"><table class="data"><caption>Sitemaps</caption>
          <thead><tr><th scope="col">Sitemap</th><th scope="col" class="num">URLs</th><th scope="col">State</th><th scope="col">Last read</th></tr></thead>
          <tbody>${g.sitemaps.map(
            (s) => html`<tr><th scope="row" class="wrap">${s.path.replace(/^https?:\/\/[^/]+/, '')}</th><td class="num">${fmtInt(s.submitted)}</td>
              <td>${s.errors ? badge('critical', `${s.errors} ${s.errors === 1 ? 'error' : 'errors'}`) : s.warnings ? badge('warning', `${s.warnings} ${s.warnings === 1 ? 'warning' : 'warnings'}`) : s.pending ? badge('running', 'Pending') : badge('good', 'OK')}</td>
              <td>${s.lastDownloaded ? html`<span title="${fmtTime(s.lastDownloaded, d.timeZone)}">${fmtAgo(s.lastDownloaded, d.now)}</span>` : '–'}</td></tr>`,
          )}</tbody></table></div>`
      : g.sitemaps
        ? html`<p>${badge('warning', 'No sitemap submitted')}</p>`
        : '';
    return html`<article class="card site">
      ${siteHead(nameOf(g.domain), g.domain, g.property)}
      <div class="tiles">
        ${tile({ label: 'Clicks', value: fmtCompact(g.totals.clicks) })}
        ${tile({ label: 'Impressions', value: fmtCompact(g.totals.impressions) })}
        ${tile({ label: 'Click-through rate', value: fmtPct(g.totals.ctr) })}
        ${tile({ label: 'Average position', value: fmtDec(g.totals.position) })}
      </div>
      ${lineChart({ title: 'Clicks a day', dates: d.period.dates, series: [{ name: 'Clicks', values: g.clicks, slot: 1 }] })}
      ${lineChart({ title: 'Impressions a day', dates: d.period.dates, series: [{ name: 'Impressions', values: g.impressions, slot: 1 }] })}
      ${queriesTable(g.queries, 'Top queries')}
      ${sitemaps}
    </article>`;
  });
  return html`<div class="grid-cards">${cards}</div>${!cards.length ? html`<p class="muted">No sites are open to search engines.</p>` : ''}
    ${hiddenNote(hidden)}<p class="muted small">Google’s figures arrive two or three days late; the newest days fill in as they do.</p>`;
}

function bingSection(d) {
  const r = d.bing;
  if (r.setup) return searchSetup(d, 'bing');
  if (!r.ok) return errorCard(r.error);
  const { checked, hidden } = searchSites(d);
  const nameOf = (domain) => checked.find((s) => s.domain === domain)?.name || domain;
  const cards = r.value.sites.map((b) => {
    if (b.missing)
      return html`<article class="card site">${siteHead(nameOf(b.domain), b.domain)}<p>${badge('warning', 'Not a verified site in Bing Webmaster Tools')}</p></article>`;
    const c = b.crawling;
    return html`<article class="card site">
      ${siteHead(nameOf(b.domain), b.domain)}
      <div class="tiles">
        ${tile({ label: 'Clicks', value: fmtCompact(b.totals.clicks) })}
        ${tile({ label: 'Impressions', value: fmtCompact(b.totals.impressions) })}
        ${tile({ label: 'Click-through rate', value: fmtPct(b.totals.ctr) })}
        ${c ? tile({ label: 'Pages in the index', value: fmtCompact(c.inIndex), note: c.inIndexOn ? `on ${fmtDay(c.inIndexOn)}` : null }) : ''}
        ${c ? tile({ label: 'Pages crawled', value: fmtCompact(c.crawled), note: `${fmtInt(c.errors)} crawl ${c.errors === 1 ? 'error' : 'errors'}`, icon: c.errors ? 'warning' : null }) : ''}
      </div>
      ${lineChart({ title: 'Clicks a day', dates: d.period.dates, series: [{ name: 'Clicks', values: b.clicks, slot: 1 }] })}
      ${lineChart({ title: 'Impressions a day', dates: d.period.dates, series: [{ name: 'Impressions', values: b.impressions, slot: 1 }] })}
      ${queriesTable(b.queries, 'Top queries')}
      ${c && (c.code5xx || c.code4xx || c.blocked)
        ? html`<p class="muted small">While crawling: ${fmtInt(c.code4xx)} pages answered 4xx, ${fmtInt(c.code5xx)} answered 5xx, ${fmtInt(c.blocked)} were blocked by robots.txt.</p>`
        : ''}
    </article>`;
  });
  return html`<div class="grid-cards">${cards}</div>${!cards.length ? html`<p class="muted">No sites are open to search engines.</p>` : ''}${hiddenNote(hidden)}`;
}

const ENGINE_PARTS = [
  ['google', 'Google', 1],
  ['bing', 'Bing', 2],
  ['duckduckgo', 'DuckDuckGo', 3],
  ['other', 'Other search engines', 4],
];

function duckSection(d) {
  const intro = html`<p class="muted">DuckDuckGo has no webmaster tools and no API, so what can be measured is what it sends: visits
    whose referrer is duckduckgo.com, from Cloudflare Web Analytics. Much of DuckDuckGo’s results come from Bing’s index, so the Bing
    section above is the nearest view of how it sees the sites.</p>`;
  const r = d.traffic;
  if (r.setup) return html`${intro}${setupCard('Cloudflare', ['Set up Cloudflare (above) to measure visits from DuckDuckGo.'])}`;
  if (!r.ok) return html`${intro}${errorCard(r.error)}`;
  const { web, webError } = r.value;
  if (!web) return html`${intro}${errorCard(webError, 'The Cloudflare token needs Account › Account Analytics › Read.')}`;
  if (!web.length) return html`${intro}<p>${badge('neutral', 'No Web Analytics data in the period.')}</p>`;

  const names = new Map((d.sites.ok ? d.sites.value : []).map((s) => [s.domain, s.name]));
  const cards = web.map((w) => {
    const ddg = sum(w.duckduckgo);
    const searchTotal = sum(Object.values(w.engines));
    const parts = ENGINE_PARTS.map(([key, name, slot]) => ({ name, value: w.engines[key], slot }));
    return html`<article class="card site">
      ${siteHead(names.get(w.domain) || w.domain, w.domain)}
      <div class="tiles">
        ${tile({ label: 'Visits from DuckDuckGo', value: fmtInt(ddg) })}
        ${tile({ label: 'Share of search visits', value: fmtPct(searchTotal ? ddg / searchTotal : null, 0), note: `of ${fmtInt(searchTotal)} from search engines` })}
      </div>
      ${ddg
        ? columnChart({ title: 'Visits from DuckDuckGo a day', dates: fullDays(d.period.dates), series: [{ name: 'Visits from DuckDuckGo', values: fullDays(w.duckduckgo), slot: 3, format: 'int' }] })
        : html`<p class="muted small">No visits from DuckDuckGo in the last ${d.days} days.</p>`}
      ${searchTotal
        ? html`<h4 class="sub">Search visits by engine</h4>${segmented(parts, 'Search visits by engine')}
          <div class="tv-scroll"><table class="data" aria-label="Search visits by engine">
            <thead><tr><th scope="col">Engine</th><th scope="col" class="num">Visits</th><th scope="col" class="num">Share</th></tr></thead>
            <tbody>${parts.map(
              (p) => html`<tr><th scope="row"><span class="key box s${p.slot}"></span>${p.name}</th><td class="num">${fmtInt(p.value)}</td><td class="num">${fmtPct(p.value / searchTotal, 0)}</td></tr>`,
            )}</tbody></table></div>`
        : ''}
    </article>`;
  });
  return html`${intro}<div class="grid-cards">${cards}</div>`;
}

// ---------- Overview ----------

function overview(d) {
  const na = (r) => (r.setup ? 'not set up' : 'could not load');
  const t = [];

  if (d.traffic.ok) {
    const perDay = sum(d.traffic.value.zones.map((z) => fullDayAverage(z.uniques) || 0));
    t.push(tile({ label: 'Unique visitors a day', value: fmtInt(perDay), note: `${d.traffic.value.zones.length} Cloudflare zones`, href: '#traffic' }));
  } else t.push(tile({ label: 'Unique visitors a day', value: '–', note: na(d.traffic), href: '#traffic' }));

  if (d.ci.ok) {
    const n = d.ci.value.failures.length;
    const now = d.ci.value.failingNow.length;
    t.push(tile({ label: 'Failed CI runs', value: fmtInt(n), icon: now ? 'critical' : n ? 'warning' : 'good', note: now ? `${now} failing now` : 'all passing now', href: '#ci' }));
  } else t.push(tile({ label: 'Failed CI runs', value: '–', note: na(d.ci), href: '#ci' }));

  if (d.minutes.ok) {
    const m = d.minutes.value;
    const frac = m.budget ? m.used / m.budget : 0;
    t.push(tile({ label: 'Actions minutes', value: fmtInt(m.used), icon: frac >= 0.9 ? 'critical' : frac >= 0.7 ? 'warning' : null, note: html`of ${fmtInt(m.budget)} this month, ${fmtPct(frac, 0)}${meter(frac, 'Share of the included minutes used')}`, href: '#minutes' }));
  } else t.push(tile({ label: 'Actions minutes', value: '–', note: na(d.minutes), href: '#minutes' }));

  const searchTile = (label, r, href) => {
    if (!r.ok) return tile({ label, value: '–', note: na(r), href });
    const found = r.value.sites.filter((s) => !s.missing);
    return tile({ label, value: fmtCompact(sum(found.map((s) => s.totals.clicks))), note: `${fmtCompact(sum(found.map((s) => s.totals.impressions)))} impressions`, href });
  };
  t.push(searchTile('Google clicks', d.google, '#google'), searchTile('Bing clicks', d.bing, '#bing'));

  if (d.traffic.ok && d.traffic.value.web) {
    t.push(tile({ label: 'DuckDuckGo visits', value: fmtInt(sum(d.traffic.value.web.map((w) => sum(w.duckduckgo)))), note: 'by referrer', href: '#duckduckgo' }));
  } else t.push(tile({ label: 'DuckDuckGo visits', value: '–', note: d.traffic.ok ? 'no Web Analytics' : na(d.traffic), href: '#duckduckgo' }));

  return html`<div class="tiles overview">${t}</div>`;
}

// ---------- The page ----------

// GitHub's avatar at twice the size shown; only from GitHub's avatar host, which the page's CSP allows.
function avatar(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'avatars.githubusercontent.com') return null;
    u.searchParams.set('s', '56');
    return u.toString();
  } catch {
    return null;
  }
}

export function dashboardPage(d) {
  const periodLinks = PERIODS.map(
    (p) => html`<a href="?days=${p}" ${p === d.days ? raw('aria-current="page"') : ''}>${p} days</a>`,
  );
  const body = html`
  <header class="top">
    <div class="brand">${mark}<div><h1>Websites</h1><p class="muted"><a href="https://github.com/${d.repo}" rel="noreferrer" target="_blank">${d.repo}</a></p></div></div>
    <div class="who">
      ${avatar(d.user.avatar) ? html`<img src="${avatar(d.user.avatar)}" alt="" width="28" height="28">` : ''}
      <span>@${d.user.login}</span>
      <form method="post" action="/logout"><button type="submit" class="link">Sign out</button></form>
    </div>
  </header>
  <nav class="filters" aria-label="Period">
    <span class="muted">Last</span><div class="seg-links">${periodLinks}</div>
    <span class="muted updated">Updated ${fmtTime(d.now, d.timeZone)} <a href="?days=${d.days}&amp;fresh=1">Refresh</a></span>
  </nav>
  <main>
    ${d.sites.ok ? '' : html`<p class="banner">${badge('warning', 'The site list could not be read from the websites repo')} <span class="muted">${d.sites.error}</span></p>`}
    ${overview(d)}
    ${section('traffic', 'Traffic', 'Cloudflare', trafficSection(d))}
    ${section('ci', 'CI', `GitHub Actions in ${d.repo}`, ciSection(d))}
    ${section('minutes', 'Actions minutes', 'Against the included minutes', minutesSection(d))}
    ${section('google', 'Google', 'Search Console', googleSection(d))}
    ${section('bing', 'Bing', 'Webmaster Tools', bingSection(d))}
    ${section('duckduckgo', 'DuckDuckGo', 'Visits it sends', duckSection(d))}
  </main>
  <footer class="muted small">Days are UTC; times are ${d.timeZone}. This page made ${d.used} of its ${d.limit} outbound requests.</footer>`;
  return layout('Websites dashboard', body);
}
