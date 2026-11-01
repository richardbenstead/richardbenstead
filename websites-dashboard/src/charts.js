// Charts, drawn on the server so the page is complete without JavaScript; public/app.js adds the crosshair and
// tooltips. The marks are an SVG stretched to the plot (lines keep their 2px with non-scaling strokes); text,
// gridlines and dots are HTML laid over it, so nothing distorts at any width. Every chart has a table view.
//
// Colours by role: series slots 1 and 2 (blue, orange) for identity, status colours only where the value means
// good or bad (failed runs). Text never wears a series colour.

import { html, raw } from './html.js';
import { fmt, fmtDay } from './format.js';

// Clean ticks from 0 to at least max: 0 / 5 / 10 / 15, in steps of 1, 2, 2.5 or 5 times a power of ten.
export function ticks(max, { integer = true } = {}) {
  if (!(max > 0)) return integer ? [0, 1] : [0, 0.5, 1].map((v) => v * (max > 0 ? max : 1));
  const rough = max / 3;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  if (integer && step < 1) step = 1;
  const top = Math.ceil(max / step - 1e-9) * step;
  const out = [];
  for (let i = 0; i * step <= top + step / 1e6; i++) out.push(Number((i * step).toFixed(10)));
  return out;
}

const pct = (x) => `${Math.round(x * 1000) / 1000}%`;
const longDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// Where along the axis day i sits, in percent: line points run edge to edge, columns sit in the middle of a band.
const lineX = (i, n) => (n === 1 ? 50 : (i / (n - 1)) * 100);
const bandX = (i, n) => ((i + 0.5) / n) * 100;

function xAxis(dates, x) {
  const n = dates.length;
  const picks = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [...dates.keys()];
  return html`<div class="xaxis" aria-hidden="true">${picks.map((i, k) => {
    const align = k === 0 && picks.length > 1 ? 'start' : k === picks.length - 1 && picks.length > 1 ? 'end' : 'mid';
    return html`<span class="${align}" style="left:${pct(x(i, n))}">${fmtDay(dates[i])}</span>`;
  })}</div>`;
}

function yAxis(t, format) {
  const top = t[t.length - 1];
  return html`<div class="yaxis" aria-hidden="true">${t.map(
    (v) => html`<span style="bottom:${pct((v / top) * 100)}">${fmt(format === 'pct' ? 'pct' : 'compact', v)}</span>`,
  )}</div>`;
}

const grid = (t) => {
  const top = t[t.length - 1];
  return t.map((v, i) => html`<div class="${i ? 'grid' : 'grid base'}" style="bottom:${pct((v / top) * 100)}"></div>`);
};

function legend(series, kind) {
  if (series.length < 2) return '';
  return html`<ul class="legend">${series.map(
    (s) => html`<li><span class="key ${kind === 'col' ? 'box' : 'line'} ${s.dashed ? 'dashed' : ''} ${s.cls || `s${s.slot || 1}`}"></span>${s.name}</li>`,
  )}</ul>`;
}

// Day labels for tooltips and tables; the last says "so far" when it is today and still filling in.
const dayLabels = (dates, partialLast) =>
  dates.map((d, i) => `${longDay(d)}${partialLast && i === dates.length - 1 ? ' (so far)' : ''}`);

function tableView(labels, series) {
  return html`<details class="tv"><summary>Table</summary><div class="tv-scroll"><table>
    <thead><tr><th scope="col">Day</th>${series.map((s) => html`<th scope="col" class="num">${s.name}</th>`)}</tr></thead>
    <tbody>${labels.map(
      (d, i) => html`<tr><th scope="row">${d}</th>${series.map((s) => html`<td class="num">${fmt(s.format, s.values[i])}</td>`)}</tr>`,
    )}</tbody></table></div></details>`;
}

// What the client script needs for tooltips: day labels and each series' values, names and formats.
const spec = (kind, labels, series) =>
  JSON.stringify({
    kind,
    labels,
    series: series.map((s) => ({ name: s.name, values: s.values, format: s.format, cls: s.cls || `s${s.slot || 1}`, dashed: !!s.dashed })),
  });

function summary(title, dates, series) {
  const s = series[0];
  const vals = s.values.filter((v) => v != null);
  if (!vals.length) return `${title}: no data.`;
  const last = [...s.values].reverse().find((v) => v != null);
  return `${title}, ${fmtDay(dates[0])} to ${fmtDay(dates[dates.length - 1])}: latest ${fmt(s.format, last)}, highest ${fmt(s.format, Math.max(...vals))}.`;
}

// series: [{ name, values (null where there is no data), slot: 1 | 2, format, dashed, area }]
// refs: [{ value, label }] drawn as reference lines (a budget).
export function lineChart({ title, dates, series, height = 120, refs = [], partialLast = false }) {
  const n = dates.length;
  const labels = dayLabels(dates, partialLast);
  const format = series[0].format || 'int';
  const values = series.flatMap((s) => s.values).filter((v) => v != null);
  const t = ticks(Math.max(0, ...values, ...refs.map((r) => r.value)), { integer: !['pct', 'dec'].includes(format) });
  const top = t[t.length - 1] || 1;
  const X = (i) => lineX(i, n) * 10; // SVG units: 0 to 1000 across, 0 to 100 down.
  const Y = (v) => 100 - (v / top) * 100;

  const paths = series.map((s) => {
    const runs = [];
    let run = [];
    s.values.forEach((v, i) => {
      if (v == null) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push([X(i), Y(v)]);
    });
    if (run.length) runs.push(run);
    const line = runs
      .map((r) => (r.length === 1 ? `M${r[0][0] - 4} ${r[0][1]}H${r[0][0] + 4}` : `M${r.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(2)}`).join('L')}`))
      .join('');
    const area =
      s.area !== false && !s.dashed
        ? runs
            .filter((r) => r.length > 1)
            .map((r) => `M${r[0][0].toFixed(1)} 100L${r.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(2)}`).join('L')}L${r[r.length - 1][0].toFixed(1)} 100Z`)
            .join('')
        : '';
    const cls = s.cls || `s${s.slot || 1}`;
    return html`${area ? html`<path class="wash ${cls}" d="${area}"/>` : ''}<path class="stroke ${cls} ${s.dashed ? 'dashed' : ''}" d="${line}" vector-effect="non-scaling-stroke"/>`;
  });

  // An end dot on each measured series' newest point (a projection gets none: it is not data). The tiles above
  // carry the numbers; the tooltip and table carry each day.
  const dots = [];
  for (const s of series) {
    const i = s.values.findLastIndex((v) => v != null);
    if (i < 0 || s.dashed) continue;
    dots.push(html`<span class="dot ${s.cls || `s${s.slot || 1}`}" style="left:${pct(lineX(i, n))};top:${pct(Y(s.values[i]))}"></span>`);
  }

  return html`<figure class="chart" data-chart="${spec('line', labels, series)}">
    ${title ? html`<figcaption>${title}</figcaption>` : ''}
    ${legend(series, 'line')}
    <div class="plot" style="height:${height}px">
      ${yAxis(t, format)}
      <div class="area" tabindex="0" role="img" aria-label="${summary(title || series[0].name, dates, series)}">
        ${grid(t)}
        ${refs.map((r) => html`<div class="ref" style="bottom:${pct((r.value / top) * 100)}"><span>${r.label}</span></div>`)}
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>
        ${dots}
      </div>
    </div>
    ${xAxis(dates, lineX)}
    ${tableView(labels, series)}
  </figure>`;
}

// One series of columns from a shared baseline: { name, values, format, cls (a status colour) or slot }.
export function columnChart({ title, dates, series, height = 90, partialLast = false }) {
  const labels = dayLabels(dates, partialLast);
  const s = series[0];
  const t = ticks(Math.max(0, ...s.values.filter((v) => v != null)));
  const top = t[t.length - 1] || 1;
  const cls = s.cls || `s${s.slot || 1}`;
  return html`<figure class="chart" data-chart="${spec('col', labels, series)}">
    ${title ? html`<figcaption>${title}</figcaption>` : ''}
    <div class="plot" style="height:${height}px">
      ${yAxis(t, s.format)}
      <div class="area" tabindex="0" role="img" aria-label="${summary(title || s.name, dates, series)}">
        ${grid(t)}
        <div class="bars">${s.values.map(
          (v) => html`<div class="band">${v ? html`<div class="bar ${cls}" style="height:${pct((v / top) * 100)}"></div>` : ''}</div>`,
        )}</div>
      </div>
    </div>
    ${xAxis(dates, bandX)}
    ${tableView(labels, series)}
  </figure>`;
}

// A stat tile: label, value, optional note; `href` makes the whole tile a link.
export function tile({ label, value, note, icon, href }) {
  const body = html`<div class="tile-label">${label}</div><div class="tile-value">${icon ? statusIcon(icon) : ''}${value}</div>${
    note ? html`<div class="tile-note">${note}</div>` : ''
  }`;
  return href ? html`<a class="tile" href="${href}">${body}</a>` : html`<div class="tile">${body}</div>`;
}

// A meter: the fill turns from blue to the warning and then the critical colour as it fills.
export function meter(fraction, label) {
  const f = Math.max(0, fraction || 0);
  const level = f >= 0.9 ? 'critical' : f >= 0.7 ? 'warning' : 'ok';
  return html`<div class="meter ${level}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}" aria-label="${label}"><div style="width:${pct(Math.min(1, f) * 100)}"></div></div>`;
}

// A thin bar split into parts: [{ name, value, slot }]. The legend beside it carries the names and numbers.
export function segmented(parts, label) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return '';
  return html`<div class="seg" role="img" aria-label="${label}: ${parts.map((p) => `${p.name} ${Math.round((p.value / total) * 100)}%`).join(', ')}">${parts
    .filter((p) => p.value > 0)
    .map((p) => html`<span class="s${p.slot}" style="flex-grow:${p.value}" title="${p.name}: ${fmt('int', p.value)}"></span>`)}</div>`;
}

const ICONS = {
  good: '<circle cx="8" cy="8" r="7"/><path d="M4.8 8.3l2.1 2.1 4.3-4.6" class="ink"/>',
  critical: '<circle cx="8" cy="8" r="7"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" class="ink"/>',
  warning: '<path d="M8 1.2l7 12.6H1z"/><path d="M8 6v3.6M8 11.6v.3" class="ink"/>',
  running: '<circle cx="8" cy="8" r="7"/><path d="M8 4.5V8l2.4 1.6" class="ink"/>',
  neutral: '<circle cx="8" cy="8" r="7"/><path d="M5 8h6" class="ink"/>',
};
export const statusIcon = (kind) =>
  raw(`<svg class="ic st-${kind}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[kind] || ICONS.neutral}</svg>`);

// A status always shows as icon and word together, never colour alone.
export const badge = (kind, word) => html`<span class="badge">${statusIcon(kind)}<span>${word}</span></span>`;
