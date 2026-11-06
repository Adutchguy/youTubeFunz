# youTubeFunz — YouTube API Playground

A local, point-and-click playground for learning what the **YouTube Data API v3** and the **YouTube Analytics API** can do, what each call costs, and how the pieces fit together.

No dependencies, no build step: just Node.

```
node server.js      →   http://localhost:3000
```

## What you get

| Tab | What it's for |
|---|---|
| **Explorer** | 47 methods (42 callable, 5 reference-only), generated from a catalog. Pick one, fill in the form, see the exact URL as you type, send it, and read the response as a tree, a table, raw JSON, headers, or a `curl` command. Next/Prev page buttons, error explanations, recent-request history. |
| **Recipes** | Guided multi-step workflows (list a channel's uploads for 3 units, research a topic, read comment threads, Analytics top videos…). Each step shows what it sent, what it cost, and which values it passed to the next step. |
| **Quota** | A running tally of what you've spent today, per quota bucket and per method, with the reset countdown. |
| **Learn** | One-page primer: credentials, quota, `part`/`fields`, pagination, errors, recent API changes, and a cost cheat sheet. |

Write methods (`videos.update`, `playlists.insert`, `comments.delete`…) are included. They ask for confirmation first (deletes make you type `DELETE`), and `READ_ONLY=true` in `.env` blocks them entirely.

## Quick start

You need **Node 18.17 or newer** (`node -v`).

```bash
git clone https://github.com/Adutchguy/youTubeFunz.git
cd youTubeFunz
copy .env.example .env      # Windows   (macOS/Linux: cp .env.example .env)
node server.js
```

Open <http://localhost:3000>. The server prints which credentials it found.

### 1. Public data: API key (2 minutes)

1. [Google Cloud Console](https://console.cloud.google.com/) → create or pick a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. Put it in `.env` as `YOUTUBE_API_KEY=...` and restart.

That's enough for videos, channels, playlists, public comments, and search.

### 2. Private data, writes, Analytics: OAuth (10 minutes, once)

1. Also enable **YouTube Analytics API** in the library.
2. **OAuth consent screen**: choose External, and add your own Google account as a **test user**.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   Add this *exact* authorized redirect URI: `http://localhost:3000/auth/callback`
4. Put the client ID and secret in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and restart.
5. In the app, click **Connect Google** (top right), choose scopes, and approve.

Notes:
- Start with the pre-ticked read-only scopes. Tick `youtube.force-ssl` only when you want to try writes or comments.
- While the consent screen is in "Testing" status, Google typically expires refresh tokens after about 7 days. Just reconnect.
- You'll see an "unverified app" warning for your own app. That's expected for a personal project.

## Understanding quota

Quota is what you'll actually run into, so the playground makes it visible.

- Most methods share a **10,000 units/day** pool. Reads cost **1**, writes usually **50**.
- Since **June 2026**, `search.list` and `videos.insert` each have **their own bucket** (100 calls/day by default); the new `videos.batchGetStats` has its own 10,000-unit bucket.
- Quota resets at **midnight Pacific Time**.
- Failed and invalid requests still count. Every extra page costs again.

Google doesn't return "quota remaining", so the Quota tab is a **local estimate** of what *this playground* spent. The **Quotas page in Cloud Console** is the source of truth. Costs in `src/catalog.js` were checked against Google's [quota cost table](https://developers.google.com/youtube/v3/determine_quota_cost) and [revision history](https://developers.google.com/youtube/v3/revision_history) on 2026-11-06. If Google changes them, edit the catalog (or the limits in `.env`).

## Safety

- The server only listens on loopback (`localhost`) and rejects other `Host` headers and cross-site POSTs.
- Your API key and OAuth tokens stay on the server. The browser never receives them, and responses are scrubbed of the key.
- `/api/request` only accepts methods that exist in the catalog; it is not a general proxy.
- `.env` and `.data/` (tokens, quota tally) are git-ignored. Never commit them.

## Project layout

```
server.js            HTTP server, request proxy, OAuth routes
src/catalog.js       Every method: params, auth, scopes, quota cost  ← add endpoints here
src/recipes.js       The guided multi-step workflows
src/shared.js        Query building / curl / templating, used by server AND browser
src/quota.js         Local quota tally (Pacific-day aware)
src/oauth.js         OAuth 2.0 + PKCE, token refresh
src/errors.js        Plain-English hints for common API errors
public/              The UI (plain HTML/CSS/JS)
test/                Tests with a mock YouTube server (no key, no quota)
```

### Adding an endpoint

Add one `method(...)` entry to `src/catalog.js`: its parameters, whether it needs OAuth, and its quota cost. The form, URL preview, curl output, quota accounting and cheat sheet all pick it up automatically. Methods that need a media upload (`videos.insert`, `thumbnails.set`…) are listed as *reference only* because the playground doesn't upload files.

### Tests

```bash
npm test
```

Runs against a built-in mock of the YouTube API. It checks catalog consistency, every recipe's wiring, quota accounting, error mapping, and the security guards.

## Config reference (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `YOUTUBE_API_KEY` | – | Public-data requests |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | – | OAuth (private data, writes, Analytics) |
| `PORT` | `3000` | Server port. Update the OAuth redirect URI if you change it |
| `OAUTH_REDIRECT_URI` | `http://localhost:<PORT>/auth/callback` | Must match the Cloud Console exactly |
| `READ_ONLY` | off | `true` blocks every non-GET request |
| `QUOTA_GENERAL` / `_SEARCH` / `_UPLOAD` / `_BATCH_STATS` | 10000 / 100 / 100 / 10000 | Limits the local meter compares against |
| `YT_DATA_BASE` / `YT_ANALYTICS_BASE` | Google's hosts | Point at a mock server |

## License

MIT, see [LICENSE](LICENSE).
