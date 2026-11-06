'use strict';
/**
 * YouTube API Playground: a zero-dependency local server.
 *
 *   node server.js        ->  http://localhost:3000
 *
 * The browser never sees your API key or OAuth tokens. It sends "call videos.list with
 * these params" to /api/request; this server validates that against the catalog (so it is
 * not an open proxy), adds credentials, calls Google, and returns the result.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./src/config');
const { METHODS, byId, SCOPES, BUCKET_LABELS } = require('./src/catalog');
const { RECIPES } = require('./src/recipes');
const quota = require('./src/quota');
const oauth = require('./src/oauth');
const shared = require('./src/shared');
const { explainError } = require('./src/errors');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// --------------------------------------------------------------------------- security

/** Only answer requests addressed to loopback (blocks DNS-rebinding attacks). */
function hostAllowed(req) {
  const host = String(req.headers.host || '').toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

/** State-changing requests must come from this page itself (blocks cross-site requests). */
function guardMutation(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Cross-origin request blocked');
  if (req.headers['x-playground'] !== '1') throw new HttpError(403, 'Missing X-Playground header');
}

// --------------------------------------------------------------------------- API calls

function resolveAuth(method, query, mode, override) {
  const hasKey = Boolean(config.apiKey || override);
  const key = override || config.apiKey;
  const needsOAuth = method.auth === 'oauth' || (method.oauthWhen || []).some((k) => query[k] !== undefined);
  const status = oauth.status();

  if (mode === 'none') return { type: 'none' };
  if (mode === 'key') {
    if (!hasKey) throw new HttpError(400, 'No API key configured. Add YOUTUBE_API_KEY to .env and restart the server.');
    return { type: 'key', key };
  }
  if (mode === 'oauth') {
    if (!status.connected) throw new HttpError(400, 'Not connected. Click "Connect Google account" at the top right first.');
    return { type: 'oauth' };
  }
  // auto
  if (needsOAuth) {
    if (!status.connected) {
      throw new HttpError(
        400,
        `${method.id} needs OAuth${method.auth === 'oauth' ? '' : ' with these parameters'}. Click "Connect Google account" at the top right.`
      );
    }
    return { type: 'oauth' };
  }
  if (hasKey) return { type: 'key', key };
  if (status.connected) return { type: 'oauth' };
  throw new HttpError(400, 'No credentials yet. Add YOUTUBE_API_KEY to .env (public data) or connect your Google account (private data).');
}

async function executeRequest(payload) {
  const method = byId.get(payload.method);
  if (!method) throw new HttpError(400, `Unknown method "${payload.method}"`);
  if (!method.executable) {
    throw new HttpError(400, `${method.id} is reference-only here (it needs a media upload, which the playground doesn't do).`);
  }
  if (config.readOnly && method.http !== 'GET') {
    throw new HttpError(403, 'READ_ONLY is enabled in .env, so only GET methods are allowed.');
  }

  const { query, missing } = shared.buildQuery(method, payload.params || {});
  if (missing.length) {
    throw new HttpError(400, `Missing required parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Nothing was sent, so no quota was used.`);
  }

  let body;
  if (method.http !== 'GET' && method.http !== 'DELETE' && method.body) {
    body = payload.body;
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, `${method.id} needs a JSON object request body.`);
    }
  }

  const auth = resolveAuth(method, query, payload.auth || 'auto', typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '');

  const sendQuery = { ...query };
  if (auth.type === 'key') sendQuery.key = auth.key;
  const base = shared.baseFor(method, config.bases);
  const url = `${base}${method.path}${Object.keys(sendQuery).length ? '?' + shared.toQueryString(sendQuery) : ''}`;

  const headers = { Accept: 'application/json', 'User-Agent': 'youTubeFunz-playground/1.0' };
  if (auth.type === 'oauth') {
    let token;
    try {
      token = await oauth.getAccessToken();
    } catch (err) {
      throw new HttpError(401, `Could not refresh your Google login (${err.message}). Disconnect and connect again.`);
    }
    if (!token) throw new HttpError(401, 'Your Google login expired and cannot be refreshed. Disconnect and connect again.');
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const started = Date.now();
  let upstream;
  let text;
  try {
    upstream = await fetch(url, {
      method: method.http,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    text = await upstream.text();
  } catch (err) {
    throw new HttpError(502, `Could not reach ${new URL(base).host}: ${err.cause?.code || err.message}. No quota is counted for requests that never arrived.`);
  }
  const ms = Date.now() - started;

  // Defense in depth: never relay the API key back to the browser, even if an upstream echoes it.
  if (auth.type === 'key' && auth.key) text = text.split(auth.key).join('YOUR_API_KEY');

  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  // Google counts every request that reaches it, even invalid ones, so we do too.
  quota.record(method);

  const respHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'set-cookie') respHeaders[k] = v;
  });

  // Show the request the way you'd write it yourself, without leaking secrets.
  const shownQuery = { ...query };
  if (auth.type === 'key') shownQuery.key = 'YOUR_API_KEY';
  const shownHeaders = { ...headers, 'User-Agent': undefined };
  if (shownHeaders.Authorization) shownHeaders.Authorization = 'Bearer <token hidden>';

  return {
    ok: upstream.ok,
    status: upstream.status,
    statusText: upstream.statusText,
    ms,
    bytes: Buffer.byteLength(text || ''),
    authUsed: auth.type,
    quota: { bucket: method.bucket, bucketLabel: BUCKET_LABELS[method.bucket], cost: method.cost },
    request: {
      method: method.http,
      url: `${base}${method.path}${Object.keys(shownQuery).length ? '?' + shared.toQueryString(shownQuery) : ''}`,
      headers: JSON.parse(JSON.stringify(shownHeaders)),
      body,
    },
    response: { headers: respHeaders, json, text: json === undefined ? text : undefined },
    explain: explainError(upstream.status, json),
  };
}

// --------------------------------------------------------------------------- routing

function serveStatic(req, res, pathname) {
  let file;
  if (pathname === '/shared.js') {
    file = path.join(config.root, 'src', 'shared.js');
  } else {
    let rel;
    try {
      rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    } catch {
      throw new HttpError(400, 'Bad path');
    }
    if (rel.includes('\0')) throw new HttpError(400, 'Bad path');
    file = path.normalize(path.join(config.publicDir, rel));
    if (!file.startsWith(config.publicDir + path.sep)) throw new HttpError(403, 'Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

function configSummary() {
  return {
    hasApiKey: Boolean(config.apiKey),
    readOnly: config.readOnly,
    bases: config.bases,
    oauth: oauth.status(),
    scopes: SCOPES,
  };
}

async function handle(req, res) {
  if (!hostAllowed(req)) throw new HttpError(403, 'Only loopback hosts are allowed');
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'GET') {
    if (p === '/api/config') return sendJson(res, 200, configSummary());
    if (p === '/api/catalog') return sendJson(res, 200, { methods: METHODS, bases: config.bases, bucketLabels: BUCKET_LABELS });
    if (p === '/api/recipes') return sendJson(res, 200, { recipes: RECIPES });
    if (p === '/api/quota') return sendJson(res, 200, quota.snapshot());

    if (p === '/auth/login') {
      if (!oauth.configured()) {
        return redirect(res, `/?auth=error&msg=${encodeURIComponent('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env and restart first.')}`);
      }
      const allowed = new Set(SCOPES.map((s) => s.scope));
      const requested = (url.searchParams.get('scopes') || '').split(/[ ,]+/).filter((s) => allowed.has(s));
      const scopes = requested.length ? requested : SCOPES.filter((s) => s.default).map((s) => s.scope);
      return redirect(res, oauth.buildAuthUrl(scopes));
    }
    if (p === '/auth/callback') {
      try {
        await oauth.handleCallback(Object.fromEntries(url.searchParams));
        return redirect(res, '/?auth=ok');
      } catch (err) {
        return redirect(res, `/?auth=error&msg=${encodeURIComponent(err.message)}`);
      }
    }
    return serveStatic(req, res, p);
  }

  if (req.method === 'POST') {
    guardMutation(req);
    if (p === '/api/request') {
      const payload = await readJson(req);
      return sendJson(res, 200, await executeRequest(payload));
    }
    if (p === '/api/quota/reset') {
      quota.reset();
      return sendJson(res, 200, quota.snapshot());
    }
    if (p === '/auth/logout') {
      await oauth.logout();
      return sendJson(res, 200, configSummary());
    }
  }

  throw new HttpError(404, 'Not found');
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.end();
      const status = err instanceof HttpError ? err.status : 500;
      if (!(err instanceof HttpError)) console.error(err);
      sendJson(res, status, { error: err instanceof HttpError ? err.message : 'Internal server error', ...(err.extra || {}) });
    });
  });
}

function main() {
  const port = config.port;
  const v4 = createServer();
  v4.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${port} is already in use. Stop the other process or set PORT in .env.\n`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
  v4.listen(port, '127.0.0.1', () => {
    // Also listen on IPv6 loopback so "localhost" works however your OS resolves it.
    const v6 = createServer();
    v6.on('error', () => {});
    v6.listen(port, '::1');

    const o = oauth.status();
    const line = (ok, text) => console.log(`  ${ok ? '[x]' : '[ ]'} ${text}`);
    console.log('\nYouTube API Playground');
    console.log(`  http://localhost:${port}\n`);
    line(Boolean(config.apiKey), config.apiKey ? 'API key loaded (public data)' : 'No API key: add YOUTUBE_API_KEY to .env for public data');
    line(o.configured, o.configured ? 'OAuth client configured (private data, writes, Analytics)' : 'No OAuth client: add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to .env');
    if (o.configured) console.log(`      redirect URI to authorize: ${o.redirectUri}`);
    if (config.readOnly) console.log('  READ_ONLY is on: write methods are blocked.');
    console.log('');
  });
}

if (require.main === module) main();

module.exports = { createServer, executeRequest, HttpError };
