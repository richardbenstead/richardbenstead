// A crosshair and tooltip for every chart: pointer, touch or arrow keys. Everything a tooltip shows is also in the
// chart's table, so the page loses nothing without this. Names and values go in with textContent, never as HTML.

const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const FORMATS = {
  int: (v) => nf0.format(Math.round(v)),
  compact: (v) => (Math.abs(v) < 10000 ? nf0.format(Math.round(v)) : Math.abs(v) < 1e6 ? `${nf1.format(v / 1e3)}K` : `${nf1.format(v / 1e6)}M`),
  pct: (v) => `${(v * 100).toFixed(1)}%`,
  dec: (v) => v.toFixed(1),
};
const show = (format, v) => (v == null || !Number.isFinite(v) ? '–' : (FORMATS[format] || FORMATS.int)(v));

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

for (const fig of document.querySelectorAll('figure.chart[data-chart]')) {
  let spec;
  try {
    spec = JSON.parse(fig.dataset.chart);
  } catch {
    continue;
  }
  const area = fig.querySelector('.area');
  const n = spec.labels?.length || 0;
  if (!area || !n) continue;

  const columns = spec.kind === 'col';
  const bands = columns ? [...area.querySelectorAll('.band')] : [];
  const line = el('div', 'xhair');
  const tip = el('div', 'tip');
  line.hidden = tip.hidden = true;
  area.append(line, tip);
  let at = -1;

  function place(i) {
    at = Math.max(0, Math.min(n - 1, i));
    const x = columns ? (at + 0.5) / n : n === 1 ? 0.5 : at / (n - 1);
    if (!columns) {
      line.style.left = `${x * 100}%`;
      line.hidden = false;
    }
    bands.forEach((b, k) => b.classList.toggle('on', k === at));

    const rows = spec.series.map((s) => {
      const row = el('div', 'tip-row');
      row.append(el('span', `key ${columns ? 'box' : 'line'}${s.dashed ? ' dashed' : ''} ${s.cls}`), el('strong', null, show(s.format, s.values[at])), el('span', null, s.name));
      return row;
    });
    tip.replaceChildren(el('div', 'tip-date', spec.labels[at]), ...rows);
    tip.hidden = false;

    // Beside the crosshair, on whichever side has room.
    const width = area.clientWidth;
    const px = x * width;
    const tw = tip.offsetWidth;
    let left = px + 10;
    if (left + tw > width) left = px - 10 - tw;
    if (left < 0) left = Math.max(0, Math.min(width - tw, px - tw / 2));
    tip.style.left = `${left}px`;
  }

  function hide() {
    at = -1;
    tip.hidden = line.hidden = true;
    bands.forEach((b) => b.classList.remove('on'));
  }

  const fromPointer = (e) => {
    const r = area.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    return columns ? Math.floor(f * n) : Math.round(f * (n - 1));
  };

  area.addEventListener('pointermove', (e) => place(fromPointer(e)));
  area.addEventListener('pointerdown', (e) => place(fromPointer(e)));
  area.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hide();
  });
  area.addEventListener('focus', () => place(at < 0 ? n - 1 : at));
  area.addEventListener('blur', hide);
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return hide();
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    place((at < 0 ? n - 1 : at) + step);
  });
}

// A tap outside any chart puts its tooltip away (touch screens have no pointer leaving).
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  for (const area of document.querySelectorAll('.chart .area')) {
    if (!area.contains(e.target)) {
      area.querySelectorAll('.tip, .xhair').forEach((x) => (x.hidden = true));
      area.querySelectorAll('.band.on').forEach((b) => b.classList.remove('on'));
    }
  }
});
