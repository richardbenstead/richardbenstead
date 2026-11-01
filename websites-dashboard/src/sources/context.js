// What every source shares for one page load: the environment, a fetch that counts outbound requests, and a cache.
//
// The Workers free plan allows 50 outbound requests per page load. The counter stops at SUBREQUEST_LIMIT (default
// 45, leaving room for sign-in) and the source that would go past it says so on the page instead of failing the
// whole load.
//
// ponytail: the cache lives in the Worker's memory, so it is per data centre and is lost whenever Cloudflare
// recycles the Worker (often, for a page one person opens). It is there to make reloads and period changes
// cheap, not to cut the cold-start cost. A KV namespace would make it durable if that ever matters.

export class SourceError extends Error {}

const memory = new Map();

export function makeContext(env, { fresh = false, fetcher = globalThis.fetch, now = new Date() } = {}) {
  const limit = Number(env.SUBREQUEST_LIMIT) || 45;
  const ctx = {
    env,
    now,
    used: 0,
    limit,
    fetch(url, init) {
      if (ctx.used >= limit) {
        throw new SourceError(
          `Skipped: this page reached its limit of ${limit} outbound requests (SUBREQUEST_LIMIT; the Workers free plan allows 50).`,
        );
      }
      ctx.used++;
      return fetcher(url, init);
    },
    // The value saved under `key` if younger than `seconds`, else whatever load() gives (then saved).
    // Only settled values are kept: a Worker may not wait on another request's unfinished fetch.
    async cached(key, seconds, load) {
      const hit = memory.get(key);
      if (!fresh && hit && hit.until > Date.now()) return hit.value;
      const value = await load();
      memory.set(key, { value, until: Date.now() + seconds * 1000 });
      return value;
    },
  };
  return ctx;
}

export const clearCache = () => memory.clear();

const SECRETS = ['GITHUB_TOKEN', 'CF_API_TOKEN', 'BING_API_KEY', 'GOOGLE_SERVICE_ACCOUNT', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET'];

// An error message with every secret's value taken out, in case an API's answer repeats what it was sent.
export function redact(message, env = {}) {
  let out = String(message);
  for (const name of SECRETS) {
    const value = env[name];
    if (typeof value === 'string' && value.length >= 8) out = out.split(value).join(`[${name}]`);
  }
  return out;
}

// { ok: true, value } or { ok: false, error }, so one source failing leaves the others on the page.
export async function settle(promise, env) {
  try {
    return { ok: true, value: await promise };
  } catch (e) {
    return { ok: false, error: redact(e instanceof SourceError ? e.message : `Unexpected error: ${e?.message || e}`, env) };
  }
}

// A short, safe excerpt of an error response. Never includes the request URL, which can carry a key (Bing's).
export async function failure(label, res) {
  let detail = '';
  try {
    const text = (await res.text()).replace(/\s+/g, ' ').trim();
    try {
      const j = JSON.parse(text);
      detail = j.message || j.error?.message || j.errors?.[0]?.message || j.Message || j.error_description || '';
    } catch {
      detail = text.startsWith('<') ? '' : text;
    }
  } catch {
    // The body could not be read; the status says enough.
  }
  return new SourceError(`${label}: HTTP ${res.status}${detail ? ` (${String(detail).slice(0, 200)})` : ''}`);
}

export const bareHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
