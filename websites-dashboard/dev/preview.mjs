// Runs the dashboard on this machine, at http://localhost:8787 (PORT to change it).
//
//   npm run preview         made-up data from dev/fixtures.js; no secrets needed.
//   npm run preview:live    the real APIs, with the secrets in .dev.vars (KEY=value lines, as wrangler dev reads).
//
// Either way, open /__dev-login first: it signs you in as the first id in ALLOWED_GITHUB_IDS without going through
// GitHub. That route exists only in this file; the deployed Worker has no way round sign-in.
// "npx wrangler dev" also works and runs the real Workers runtime, but signs in through GitHub like the live site.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../src/index.js';
import { sign } from '../src/auth.js';
import { demoEnv, demoFetcher } from './fixtures.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 8787;
const live = process.argv.includes('--live');
// --now=2026-11-18T09:00:00Z draws the page as at that moment (made-up data only), to see a month further along.
const at = process.argv.find((a) => a.startsWith('--now='))?.slice(6);
const now = () => (at ? new Date(at) : new Date());

async function liveEnv() {
  // wrangler.jsonc's vars (comments dropped), then .dev.vars on top.
  const config = JSON.parse((await readFile(join(root, 'wrangler.jsonc'), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  const env = { ...config.vars };
  let text = '';
  try {
    text = await readFile(join(root, '.dev.vars'), 'utf8');
  } catch {
    console.warn('No .dev.vars: only the sources with nothing to set up will load.');
  }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  env.SESSION_SECRET ||= 'local-preview-session-secret-0123456789abcdef';
  env.GITHUB_CLIENT_ID ||= 'local';
  env.GITHUB_CLIENT_SECRET ||= 'local';
  return env;
}

const env = live ? await liveEnv() : await demoEnv();
const fetcher = live ? globalThis.fetch : demoFetcher({ now: now() });
const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname === '/__dev-login') {
        const id = Number(String(env.ALLOWED_GITHUB_IDS).split(/[\s,]+/)[0]);
        const token = await sign({ id, login: 'richardbenstead', avatar: null, exp: Math.floor(Date.now() / 1000) + 86400 }, env.SESSION_SECRET);
        res.writeHead(302, { location: '/', 'set-cookie': `__Host-session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax` });
        return res.end();
      }
      if (TYPES[extname(url.pathname)] && !url.pathname.includes('..')) {
        const file = await readFile(join(root, 'public', url.pathname)).catch(() => null);
        if (file) {
          res.writeHead(200, { 'content-type': TYPES[extname(url.pathname)] });
          return res.end(file);
        }
      }
      const request = new Request(url, { method: req.method, headers: req.headers });
      const response = await handle(request, env, { fetcher, now: now() });
      const headers = Object.fromEntries([...response.headers].filter(([k]) => k !== 'set-cookie'));
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e?.stack || e));
    }
  })
  .listen(port, () => console.log(`Dashboard (${live ? 'live data' : 'made-up data'}): http://localhost:${port}/__dev-login`));
