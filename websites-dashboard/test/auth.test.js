import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { sign, verify, allowedIds, authProblem } from '../src/auth.js';
import { demoEnv, demoFetcher, demoSession, OWNER_ID } from '../dev/fixtures.js';
import { clearCache } from '../src/sources/context.js';

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';
const ORIGIN = 'https://websites-dashboard.example.workers.dev';
const get = (path, cookie) => new Request(ORIGIN + path, { headers: cookie ? { cookie } : {} });
const cookieFrom = (res, name) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1);

test('a signed token round-trips, and any change to it is refused', async () => {
  const token = await sign({ id: 1, exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  assert.equal((await verify(token, SECRET)).id, 1);
  const [body, mac] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ id: 2, exp: 9999999999 })).toString('base64url');
  assert.equal(await verify(`${forged}.${mac}`, SECRET), null, 'a changed body');
  assert.equal(await verify(`${body}.${mac.slice(0, -2)}AA`, SECRET), null, 'a changed signature');
  assert.equal(await verify(token, `${SECRET}-other`), null, 'another secret');
  assert.equal(await verify(`${token}.x`, SECRET), null, 'an extra part');
  assert.equal(await verify('garbage', SECRET), null);
  assert.equal(await verify(null, SECRET), null);
});

test('an expired token is refused', async () => {
  const token = await sign({ id: 1, exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
  assert.equal(await verify(token, SECRET), null);
});

test('the allowlist takes numeric ids only, and an empty one stops sign-in', () => {
  assert.deepEqual([...allowedIds({ ALLOWED_GITHUB_IDS: '52471242, 7 richard x12' })], [52471242, 7]);
  const env = { GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b', SESSION_SECRET: SECRET, ALLOWED_GITHUB_IDS: '' };
  assert.match(authProblem(env), /nobody can sign in/);
  assert.match(authProblem({ ...env, ALLOWED_GITHUB_IDS: '1', SESSION_SECRET: 'short' }), /32 characters/);
  assert.match(authProblem({ ALLOWED_GITHUB_IDS: '1' }), /GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SESSION_SECRET are missing/);
  assert.equal(authProblem({ ...env, ALLOWED_GITHUB_IDS: '1' }), null);
});

test('without a session the dashboard shows only the sign-in page', async () => {
  const env = await demoEnv();
  let calls = 0;
  const res = await handle(get('/'), env, { fetcher: (...a) => (calls++, demoFetcher()(...a)) });
  assert.equal(res.status, 401);
  const body = await res.text();
  assert.match(body, /Sign in with GitHub/);
  assert.doesNotMatch(body, /Unique visitors|Failed CI runs/);
  assert.equal(calls, 0, 'nothing is fetched for someone not signed in');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
});

test('a session forged with another secret, or for an id no longer allowed, is refused', async () => {
  const env = await demoEnv();
  const forged = await demoSession({ SESSION_SECRET: 'some-other-secret-that-is-long-enough-000' });
  assert.equal((await handle(get('/', `__Host-session=${forged}`), env, { fetcher: demoFetcher() })).status, 401);
  const session = await demoSession(env);
  const removed = { ...env, ALLOWED_GITHUB_IDS: '12345' };
  assert.equal((await handle(get('/', `__Host-session=${session}`), removed, { fetcher: demoFetcher() })).status, 401);
});

test('sign-in that is not set up says what is missing and does not go to GitHub', async () => {
  const env = await demoEnv({ GITHUB_CLIENT_SECRET: '' });
  const res = await handle(get('/login'), env);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /GITHUB_CLIENT_SECRET is missing/);
});

// GitHub's side of the sign-in: trades the code for a token and says who the token belongs to.
const github = (user) => async (url, init) => {
  if (url === 'https://github.com/login/oauth/access_token') {
    const body = JSON.parse(init.body);
    return Response.json(body.code === 'good-code' ? { access_token: 'gho_x', token_type: 'bearer' } : { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
  }
  if (url === 'https://api.github.com/user') {
    assert.equal(init.headers.authorization, 'Bearer gho_x');
    return Response.json(user);
  }
  throw new Error(`unexpected fetch ${url}`);
};

async function startLogin(env) {
  const res = await handle(get('/login'), env);
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(to.searchParams.get('client_id'), env.GITHUB_CLIENT_ID);
  assert.equal(to.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback`);
  assert.equal(to.searchParams.get('scope'), null, 'asks for no scope');
  const state = to.searchParams.get('state');
  const cookie = res.headers.getSetCookie()[0];
  assert.match(cookie, /^__Host-oauth=.+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
  return { state, oauth: cookieFrom(res, '__Host-oauth') };
}

test('an allowed GitHub account signs in and gets the dashboard', async () => {
  clearCache();
  const env = await demoEnv();
  const { state, oauth } = await startLogin(env);
  const res = await handle(get(`/auth/callback?code=good-code&state=${state}`, `__Host-oauth=${oauth}`), env, {
    fetcher: github({ id: OWNER_ID, login: 'richardbenstead', avatar_url: 'https://avatars.githubusercontent.com/u/52471242?v=4' }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  const session = cookieFrom(res, '__Host-session');
  assert.ok(session);
  assert.match(res.headers.getSetCookie().find((c) => c.startsWith('__Host-session=')), /HttpOnly; SameSite=Lax; Max-Age=604800/);
  assert.ok(!session.includes('gho_x') && !Buffer.from(session.split('.')[0], 'base64url').toString().includes('gho_x'), 'the GitHub token is not kept');

  const page = await handle(get('/', `__Host-session=${session}`), env, { fetcher: demoFetcher() });
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.match(body, /@richardbenstead/);
  assert.ok(body.includes('src="https://avatars.githubusercontent.com/u/52471242?v=4&amp;s=56"'), 'the avatar, from GitHub only');
});

test('a GitHub account not on the list is turned away with no session', async () => {
  const env = await demoEnv();
  const { state, oauth } = await startLogin(env);
  const res = await handle(get(`/auth/callback?code=good-code&state=${state}`, `__Host-oauth=${oauth}`), env, {
    fetcher: github({ id: 999, login: 'someone-else' }),
  });
  assert.equal(res.status, 403);
  assert.equal(res.headers.getSetCookie().length, 0);
  const body = await res.text();
  assert.match(body, /@someone-else/);
  assert.match(body, /account id 999/);
});

test('a callback with the wrong state, no state cookie, or a bad code is refused', async () => {
  const env = await demoEnv();
  const { state, oauth } = await startLogin(env);
  const fetcher = github({ id: OWNER_ID, login: 'richardbenstead' });
  const wrong = await handle(get(`/auth/callback?code=good-code&state=other`, `__Host-oauth=${oauth}`), env, { fetcher });
  assert.equal(wrong.status, 400);
  const noCookie = await handle(get(`/auth/callback?code=good-code&state=${state}`), env, { fetcher });
  assert.equal(noCookie.status, 400);
  const badCode = await handle(get(`/auth/callback?code=bad&state=${state}`, `__Host-oauth=${oauth}`), env, { fetcher });
  assert.equal(badCode.status, 502);
  assert.match(await badCode.text(), /incorrect or expired/);
});

test('signing out clears the session', async () => {
  const env = await demoEnv();
  const res = await handle(new Request(`${ORIGIN}/logout`, { method: 'POST' }), env);
  assert.equal(res.status, 302);
  assert.match(res.headers.getSetCookie()[0], /^__Host-session=; .*Max-Age=0$/);
});

test('robots are kept out, and unknown paths are not found', async () => {
  const env = await demoEnv();
  assert.equal(await (await handle(get('/robots.txt'), env)).text(), 'User-agent: *\nDisallow: /\n');
  assert.equal((await handle(get('/admin'), env)).status, 404);
});
