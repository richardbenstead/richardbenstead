// HTML built from template strings, with every interpolated value escaped unless it is marked raw.
// Page data (search queries, commit messages, API errors) only ever reaches the page through here.

export class Raw {
  constructor(s) {
    this.s = String(s);
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => new Raw(s);

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ENTITIES[c]);

const part = (v) => {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
};

export const html = (strings, ...values) =>
  raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));
