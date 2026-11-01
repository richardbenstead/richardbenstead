// Numbers, dates and periods. Dates are UTC days ("2026-10-31"), the unit every source reports in.

const DAY = 86400000;

export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

// The last `days` UTC days, today included: { days, start, end, dates: [...] }.
export function makePeriod(days, now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(isoDay(end - i * DAY));
  return { days, start: dates[0], end: dates[dates.length - 1], dates };
}

// Every day of the current UTC month: { year, month, dates, today, elapsed } (elapsed in days, fractional).
export function monthToDate(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const first = Date.UTC(year, month - 1, 1);
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = Array.from({ length }, (_, i) => isoDay(first + i * DAY));
  return { year, month, dates, today: isoDay(now), elapsed: (now.getTime() - first) / DAY };
}

const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

export const fmtInt = (n) => (n == null || !Number.isFinite(n) ? '–' : nf0.format(Math.round(n)));

// 1,284 / 12.9K / 4.2M: in full under ten thousand.
export function fmtCompact(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a < 10000) return fmtInt(n);
  if (a < 1e6) return `${nf1.format(n / 1e3)}K`;
  if (a < 1e9) return `${nf1.format(n / 1e6)}M`;
  return `${nf1.format(n / 1e9)}B`;
}

export const fmtPct = (x, digits = 1) =>
  x == null || !Number.isFinite(x) ? '–' : `${(x * 100).toFixed(digits)}%`;

export const fmtDec = (x, digits = 1) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(digits));

export const fmtMoney = (x) =>
  x == null || !Number.isFinite(x) ? '–' : `$${x.toFixed(2)}`;

export function fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${i ? nf1.format(n) : nf0.format(n)} ${units[i]}`;
}

// The client script formats tooltip values with the same names.
export const FORMATS = { int: fmtInt, compact: fmtCompact, pct: fmtPct, dec: fmtDec };
export const fmt = (kind, v) => (FORMATS[kind] || fmtInt)(v);

// "3 Oct"
export const fmtDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// "Sat 3 Oct, 14:05" in the owner's time zone.
export const fmtTime = (t, timeZone) =>
  new Date(t).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });

export function fmtAgo(t, now = Date.now()) {
  const s = Math.max(0, (now - new Date(t).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const sum = (xs) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
