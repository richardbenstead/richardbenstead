# Websites dashboard

One page that shows how the sites in [richardbenstead/websites](https://github.com/richardbenstead/websites) are doing.
It is a Cloudflare Worker that only GitHub accounts on an allowlist can open.

| Section | What it shows | Where it comes from |
| --- | --- | --- |
| Traffic | For each site: unique visitors a day, page views, requests, cache share and threats. Where the Web Analytics beacon is on the pages: visits, page views and top referrers. | Cloudflare GraphQL Analytics (`httpRequests1dGroups`, `rumPageloadEventsAdaptiveGroups`) |
| CI | For each workflow: failed runs, the failure rate and the latest result, plus the workflows failing now. The newest failures name the job and step that broke. | GitHub Actions API |
| Actions minutes | Minutes used this month against the included minutes, the pace to the month's end, last month's total, the amount billed, and minutes by repository. | GitHub billing usage report |
| Google | For each site open to search engines: clicks, impressions, click-through rate, average position, top queries and sitemap state. | Search Console API |
| Bing | Clicks, impressions, click-through rate, top queries, pages in the index, and crawling and its errors. | Bing Webmaster Tools API |
| DuckDuckGo | Visits DuckDuckGo sends, and its share of search visits next to Google, Bing and the rest. | Cloudflare Web Analytics referrers |

The site list is read from `sites.json` and `tools.json` in the websites repo, so a new site shows up by itself.
Google and Bing are only asked about sites with `"index": true`; the rest are named as not checked.

Some figures need reading with care:

- **Unique visitors** is Cloudflare's own count: distinct IP addresses a day, bots included, so it overstates people.
  **Visits** from Web Analytics is closer to people, but it only exists where the beacon is on the pages. Today that
  is eventshawk.com only.
- **The workers.dev tool sites** have no Cloudflare zone, so they have no traffic statistics. They appear under "Not
  measured" until their pages carry the Web Analytics beacon.
- **DuckDuckGo** has no webmaster tools and no API, so its referrals are the only measure. Its results lean on Bing's
  index, so the Bing section is the nearest view of how it sees the sites.
- **Cloudflare's daily charts end with yesterday**, because today's figures are still coming in. Google and Bing
  report two or three days late, and their newest days are gaps, not zeros.
- **Actions minutes** are month to date in UTC. Public repositories' minutes are free and are listed but not counted.
  The included minutes are `ACTIONS_MINUTES_BUDGET`: 2,000 on GitHub Free, 3,000 on Pro.
- **The period** can be 7, 14 or 30 days. Cloudflare can be asked for at most 30 days at a time.

## Setting it up

Run every command from this folder. You need Node 20 or newer; Wrangler comes through `npx`. Each data source works
without the others. One that is not set up shows its own setup steps on the page.

### 1. Sign-in

1. **Create a GitHub OAuth app** at GitHub › Settings › Developer settings › OAuth Apps › New OAuth App.
   - Homepage URL: `https://websites-dashboard.<your-subdomain>.workers.dev`
   - Authorization callback URL: the same address followed by `/auth/callback`.
2. **Save the app's client ID and a new client secret:**

   ```sh
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

3. **Create the key that signs sessions:**

   ```sh
   openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
   ```

4. **Allow GitHub accounts in.** `ALLOWED_GITHUB_IDS` in `wrangler.jsonc` lists numeric GitHub account IDs,
   separated by commas. It starts with yours, 52471242. You can find someone's ID with
   `curl https://api.github.com/users/<login>`. The list uses IDs, not logins: an ID never changes, while a login can
   be renamed and then claimed by someone else.

The app asks GitHub for no scopes. The session is a signed cookie that lasts seven days. The allowlist is checked
again on every request, so removing an ID locks that account out at once. GitHub's access token is used once, to
read who signed in, and is never kept.

### 2. Data

| Secret | What to create |
| --- | --- |
| `GITHUB_TOKEN` | A fine-grained personal access token (GitHub › Settings › Developer settings). Repository access: the websites repo, with **Actions: read** and **Contents: read**. Account permissions: **Plan: read**, which the billing report needs. |
| `CF_API_TOKEN` | A Cloudflare API token with **Zone › Zone › Read**, **Zone › Analytics › Read** and **Account › Account Analytics › Read**, for all zones. |
| `GOOGLE_SERVICE_ACCOUNT` | A Google Cloud service account's JSON key, from a project where the **Google Search Console API** is turned on. In Search Console, add the service account's email as a user (Restricted is enough) on each property. Save the key with `npx wrangler secret put GOOGLE_SERVICE_ACCOUNT < key.json`. |
| `BING_API_KEY` | Bing Webmaster Tools › Settings › API access › API key. |

Save each one with `npx wrangler secret put NAME`.

### 3. Publishing

```sh
npx wrangler login     # once, or set CLOUDFLARE_API_TOKEN
npm run deploy
```

`.github/workflows/websites-dashboard.yml` runs the tests on every change to this folder. It also publishes from main
once the repository has two secrets: `CLOUDFLARE_API_TOKEN`, made from the "Edit Cloudflare Workers" template, and
`CLOUDFLARE_ACCOUNT_ID`. A custom domain can be added as a route in `wrangler.jsonc`. If you add one, add its callback
URL to the OAuth app too.

### Settings (`vars` in `wrangler.jsonc`)

| Name | Meaning | Default |
| --- | --- | --- |
| `ALLOWED_GITHUB_IDS` | GitHub account IDs allowed in | `52471242` |
| `WEBSITES_REPO` | The repository whose sites, CI and minutes are shown | `richardbenstead/websites` |
| `ACTIONS_MINUTES_BUDGET` | Actions minutes included each month | `2000` |
| `TIME_ZONE` | The time zone used for times on the page | `Australia/Sydney` |
| `GITHUB_BILLING_USER` | The account whose minutes are shown | the owner of `WEBSITES_REPO` |
| `CF_ACCOUNT_ID` | The Cloudflare account for Web Analytics | the account of the first zone |
| `SEARCH_DOMAINS` | Sites to look up in Google and Bing when the repo's site list can't be read | none |
| `SUBREQUEST_LIMIT` | Most outbound requests one page load may make | `45` |
| `CI_FAILURE_DETAILS` | How many of the newest failures get their job and step looked up | `3` |

## Working on it

```sh
npm test                 # node --test
npm run preview          # http://localhost:8787/__dev-login, with made-up data and no secrets
npm run preview:live     # the same, against the real APIs, with secrets in .dev.vars (KEY=value lines)
node dev/preview.mjs --now=2026-11-18T09:00:00Z   # made-up data as at another moment
```

`/__dev-login` signs you in without GitHub. It exists only in `dev/preview.mjs`; the deployed Worker has no way round
sign-in. `npx wrangler dev` runs the real Workers runtime, but signs in through GitHub.

How it works: `src/index.js` routes requests and loads every source at once. `src/sources/` has one module per API,
and `src/page.js` and `src/charts.js` draw the page on the server, so it is complete without JavaScript.
`public/app.js` adds the crosshair and tooltips. Each source is settled on its own, so one failing leaves the rest on
the page. Error messages have every secret taken out before they are shown.

Limits:

- **Outbound requests.** The Workers free plan allows 50 outbound requests per page load. A full page uses about 27.
  `SUBREQUEST_LIMIT` stops at 45, and any source past it says so on the page.
- **Caching.** Results are cached in the Worker's memory for a few minutes, longer for search figures. `?fresh=1`
  (Refresh on the page) skips the cache.
