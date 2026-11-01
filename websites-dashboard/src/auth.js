// Sign-in with GitHub. Only the numeric GitHub account ids in ALLOWED_GITHUB_IDS get in: an id never changes,
// unlike a login, which can be renamed and then claimed by someone else.
//
// The session is a cookie signed with SESSION_SECRET (HMAC-SHA256), holding the id, login and expiry. Nothing is
// stored on the server, and GitHub's access token is used once, to read who signed in, and then dropped.
// The allowlist is checked again on every request, so removing an id locks that account out at once.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const UA = 'websites-dashboard (+https://github.com/richardbenstead/richardbenstead)';

export const SESSION_COOKIE = '__Host-session';
const STATE_COOKIE = '__Host-oauth';
const SESSION_DAYS = 7;

export const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const fromB64url = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(mac)}`;
}

// The payload, or null when the token is malformed, tampered with or expired.
export async function verify(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(mac), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64url(body)));
    return payload && payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

export const allowedIds = (env) =>
  new Set(
    String(env.ALLOWED_GITHUB_IDS || '')
      .split(/[\s,]+/)
      .filter((s) => /^\d+$/.test(s))
      .map(Number),
  );

export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

// Why sign-in cannot work yet, or null when it is set up.
export function authProblem(env) {
  const missing = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET'].filter((k) => !env[k]);
  if (missing.length) return `Sign-in is not set up: ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing.`;
  if (String(env.SESSION_SECRET).length < 32) return 'SESSION_SECRET must be at least 32 characters.';
  if (!allowedIds(env).size) return 'ALLOWED_GITHUB_IDS lists no GitHub account ids, so nobody can sign in.';
  return null;
}

// The signed-in user ({ id, login, avatar }), or null.
export async function currentUser(request, env) {
  if (authProblem(env)) return null;
  const session = await verify(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
  return session && allowedIds(env).has(session.id) ? session : null;
}

const redirect = (location, cookies = []) => {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
};

// GET /login: off to GitHub, with a random state bound to this browser by a short-lived signed cookie.
export async function startLogin(request, env) {
  const url = new URL(request.url);
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const signed = await sign({ s: state, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'false');
  // No scope: reading who signed in needs none.
  return redirect(authorize.toString(), [cookie(STATE_COOKIE, signed, 600)]);
}

// GET /auth/callback: check the state, trade the code for a token, read the account, let it in if it is listed.
// Returns { response } on success, or { status, message, user? } for the caller to show.
export async function finishLogin(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error')) return { status: 400, message: `GitHub did not sign you in: ${url.searchParams.get('error_description') || url.searchParams.get('error')}.` };
  const expected = await verify(readCookie(request, STATE_COOKIE), env.SESSION_SECRET);
  if (!code || !state || !expected || expected.s !== state) {
    return { status: 400, message: 'The sign-in link expired or came from another browser. Try again.' };
  }

  const tokenRes = await fetcher('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  const token = tokenRes.ok ? await tokenRes.json() : {};
  if (!token.access_token) {
    return { status: 502, message: `GitHub refused the sign-in${token.error_description ? `: ${token.error_description}` : '.'}` };
  }

  const userRes = await fetcher('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json', 'user-agent': UA },
  });
  if (!userRes.ok) return { status: 502, message: `GitHub would not say who signed in (HTTP ${userRes.status}).` };
  const user = await userRes.json();
  if (!allowedIds(env).has(user.id)) {
    return { status: 403, message: 'This GitHub account is not on the list of accounts allowed in.', user };
  }

  const session = await sign(
    { id: user.id, login: user.login, avatar: user.avatar_url, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 },
    env.SESSION_SECRET,
  );
  return {
    response: redirect('/', [cookie(SESSION_COOKIE, session, SESSION_DAYS * 86400), cookie(STATE_COOKIE, '', 0)]),
  };
}

export const logout = () => redirect('/', [cookie(SESSION_COOKIE, '', 0)]);
