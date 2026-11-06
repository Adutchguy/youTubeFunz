'use strict';
/**
 * Run with:  npm test      (or: node --test)
 * Uses a mock "YouTube" server, so it needs no API key, no network and spends no quota.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate the test run from the developer's real .env, quota and tokens.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytpg-test-'));
process.env.DATA_DIR = dataDir;
process.env.YOUTUBE_API_KEY = 'test-key-123';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
process.env.READ_ONLY = '';

const mockCalls = [];
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://mock');
  mockCalls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization });
  res.setHeader('Content-Type', 'application/json');
  if (url.searchParams.get('q') === 'quota') {
    res.statusCode = 403;
    return res.end(JSON.stringify({ error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }));
  }
  res.end(JSON.stringify({ kind: 'mock', items: [{ id: 'abc', snippet: { title: 'Hello' } }], echo: Object.fromEntries(url.searchParams) }));
});

let app;
let base;

test.before(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockBase = `http://127.0.0.1:${mock.address().port}`;
  process.env.YT_DATA_BASE = `${mockBase}/youtube/v3`;
  process.env.YT_ANALYTICS_BASE = `${mockBase}/analytics/v2`;
  const { createServer } = require('../server');
  app = createServer();
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
});

test.after(() => {
  app.close();
  mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': '1', ...headers }, body: JSON.stringify(body) });

// ------------------------------------------------------------------ static data

test('catalog is internally consistent', () => {
  const { METHODS, SCOPES } = require('../src/catalog');
  const validScopes = new Set(SCOPES.map((s) => s.scope));
  const ids = new Set();
  for (const m of METHODS) {
    assert.ok(!ids.has(m.id), `duplicate method id ${m.id}`);
    ids.add(m.id);
    assert.ok(['GET', 'POST', 'PUT', 'DELETE'].includes(m.http), m.id);
    assert.ok(m.path.startsWith('/'), m.id);
    assert.ok(['general', 'search', 'upload', 'batchStats', 'analytics'].includes(m.bucket), m.id);
    assert.ok(Number.isFinite(m.cost) && m.cost >= 0, m.id);
    const names = new Set();
    for (const p of m.params) {
      assert.ok(!names.has(p.name), `${m.id}: duplicate param ${p.name}`);
      names.add(p.name);
      if (p.type === 'enum' || p.type === 'multi') assert.ok(Array.isArray(p.options) && p.options.length, `${m.id}.${p.name} needs options`);
    }
    for (const s of m.scopes) assert.ok(validScopes.has(s), `${m.id}: scope ${s} is not offered in SCOPES`);
    if (m.body) assert.equal(typeof m.body.template, 'object', m.id);
    if (['PUT', 'POST'].includes(m.http) && m.executable && m.params.some((p) => p.name === 'part')) assert.ok(m.body, `${m.id} needs a body`);
  }
});

test('every recipe step refers to real methods and params, and its variables resolve', () => {
  const { byId } = require('../src/catalog');
  const { RECIPES } = require('../src/recipes');
  const shared = require('../src/shared');
  for (const r of RECIPES) {
    const known = new Set(r.vars.map((v) => v.name));
    for (const step of r.steps) {
      const m = byId.get(step.method);
      assert.ok(m, `${r.id}: unknown method ${step.method}`);
      assert.ok(m.executable, `${r.id}: ${step.method} is reference-only`);
      for (const [k, v] of Object.entries(step.params)) {
        assert.ok(m.params.some((p) => p.name === k), `${r.id}: ${step.method} has no param ${k}`);
        const { unresolved } = shared.fillTemplate(v, Object.fromEntries([...known].map((n) => [n, 'x'])));
        assert.deepEqual(unresolved, [], `${r.id}: ${step.method}.${k} uses undefined variable(s)`);
      }
      const { missing } = shared.buildQuery(m, Object.fromEntries(Object.entries(step.params).map(([k, v]) => [k, v.includes('{{') ? 'x' : v])));
      assert.deepEqual(missing, [], `${r.id}: ${step.method} is missing required params`);
      for (const name of Object.keys(step.extract || {})) known.add(name);
    }
  }
});

test('shared helpers', () => {
  const shared = require('../src/shared');
  const { byId } = require('../src/catalog');
  const m = byId.get('videos.list');
  const { query, missing } = shared.buildQuery(m, { part: ['snippet', 'statistics'], id: ' a,b ', maxResults: '', myRating: '', bogus: 'x' });
  assert.deepEqual(query, { part: 'snippet,statistics', id: 'a,b' });
  assert.deepEqual(missing, []);
  assert.deepEqual(shared.buildQuery(m, {}).missing, ['part']);
  assert.equal(shared.buildQuery(byId.get('channels.list'), { part: ['id'], mine: true }).query.mine, 'true');
  assert.equal(shared.buildQuery(byId.get('channels.list'), { part: ['id'], mine: false }).query.mine, undefined);

  const doc = { items: [{ id: 'A', c: { u: 'UU1' } }, { id: 'B' }], rows: [['v1', 5], ['v2', 9]] };
  assert.equal(shared.getPath(doc, 'items.0.c.u'), 'UU1');
  assert.equal(shared.getPath(doc, 'items.*.id'), 'A,B');
  assert.equal(shared.getPath(doc, 'rows.*.0'), 'v1,v2');
  assert.equal(shared.getPath(doc, 'items.5.id'), undefined);
  assert.equal(shared.resolveMacro('@daysAgo:1', Date.UTC(2026, 0, 2)), '2026-01-01');
  assert.equal(shared.fillTemplate('{{a}}-{{b}}', { a: '1' }).unresolved[0], 'b');
});

test('quota day math handles Pacific time', () => {
  const quota = require('../src/quota');
  // 2026-11-06 20:00 UTC = 12:00 PST -> 12h to midnight
  assert.equal(quota.msUntilReset(new Date('2026-11-06T20:00:00Z')), 12 * 3600 * 1000);
  assert.equal(quota.pacificDay(new Date('2026-11-06T07:59:00Z')), '2026-11-05');
  assert.equal(quota.pacificDay(new Date('2026-11-06T08:01:00Z')), '2026-11-06');
});

// ------------------------------------------------------------------- the server

test('serves the UI and the data it needs', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /YouTube API Playground/);
  assert.equal((await fetch(base + '/shared.js')).status, 200);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  const cat = await (await fetch(base + '/api/catalog')).json();
  assert.ok(cat.methods.length > 40);
  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(cfg.hasApiKey, true);
  assert.equal(JSON.stringify(cfg).includes('test-key-123'), false, 'config must never expose the key');
  assert.equal(cfg.oauth.connected, false);
});

test('request goes upstream with the key, and the key is hidden in the reply', async () => {
  const before = mockCalls.length;
  const res = await post('/api/request', { method: 'channels.list', params: { part: ['snippet'], forHandle: '@x' } });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.equal(out.authUsed, 'key');
  const call = mockCalls[before];
  assert.equal(call.path, '/youtube/v3/channels');
  assert.deepEqual({ part: call.query.part, forHandle: call.query.forHandle, key: call.query.key }, { part: 'snippet', forHandle: '@x', key: 'test-key-123' });
  assert.equal(JSON.stringify(out).includes('test-key-123'), false, 'reply must not contain the key');
  assert.match(out.request.url, /key=YOUR_API_KEY/);
  assert.equal(out.quota.cost, 1);
});

test('quota is counted per bucket', async () => {
  await post('/api/request', { method: 'search.list', params: { part: ['snippet'], q: 'salmon' } });
  const q = await (await fetch(base + '/api/quota')).json();
  const search = q.buckets.find((b) => b.id === 'search');
  const general = q.buckets.find((b) => b.id === 'general');
  assert.equal(search.used, 1);
  assert.ok(general.used >= 1);
  assert.equal(q.byMethod['search.list'].calls, 1);
  const reset = await (await post('/api/quota/reset', {})).json();
  assert.equal(reset.buckets.find((b) => b.id === 'general').used, 0);
});

test('Google errors are passed through with a plain-English hint', async () => {
  const out = await (await post('/api/request', { method: 'search.list', params: { part: ['snippet'], q: 'quota' } })).json();
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.explain.reason, 'quotaExceeded');
  assert.match(out.explain.hint, /midnight Pacific/);
});

test('bad requests are rejected locally, before spending quota', async () => {
  const before = mockCalls.length;
  const missing = await post('/api/request', { method: 'videos.list', params: {} });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /Missing required parameter: part/);

  const unknown = await post('/api/request', { method: 'nope.list', params: {} });
  assert.equal(unknown.status, 400);

  const refOnly = await post('/api/request', { method: 'videos.insert', params: {} });
  assert.equal(refOnly.status, 400);
  assert.match((await refOnly.json()).error, /reference-only/);

  const needsOAuth = await post('/api/request', { method: 'channels.list', params: { part: ['id'], mine: true } });
  assert.equal(needsOAuth.status, 400);
  assert.match((await needsOAuth.json()).error, /OAuth/);

  const noBody = await post('/api/request', { method: 'playlists.insert', params: { part: ['snippet'] }, auth: 'key' });
  assert.equal(noBody.status, 400);

  assert.equal(mockCalls.length, before, 'nothing should have reached the upstream');
});

test('only catalog methods are reachable (no open proxy)', async () => {
  const before = mockCalls.length;
  const res = await post('/api/request', { method: '../../etc/passwd', params: {} });
  assert.equal(res.status, 400);
  assert.equal(mockCalls.length, before);
});

// -------------------------------------------------------------------- security

function rawRequest(pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, path: pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

test('rejects non-loopback Host headers (DNS rebinding)', async () => {
  const r = await rawRequest('/api/config', { headers: { Host: 'evil.example.com' } });
  assert.equal(r.status, 403);
});

test('POSTs need the custom header and a same-origin Origin (CSRF)', async () => {
  const noHeader = await fetch(base + '/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const badOrigin = await post('/api/request', { method: 'channels.list', params: { part: ['id'], id: 'x' } }, { Origin: 'http://evil.example.com' });
  assert.equal(badOrigin.status, 403);
});

test('static serving cannot escape the public folder', async () => {
  for (const p of ['/../server.js', '/..%2fserver.js', '/%2e%2e/server.js', '/..%5cserver.js']) {
    const r = await rawRequest(p);
    assert.ok(r.status === 404 || r.status === 403, `${p} -> ${r.status}`);
    assert.equal(r.body.includes('createServer'), false, p);
  }
});

test('READ_ONLY blocks writes even when everything else is fine', async () => {
  // Re-load config + server with READ_ONLY on, in a fresh module registry.
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.resolve(__dirname, '..') + path.sep) && !k.includes('node_modules')) delete require.cache[k];
  process.env.READ_ONLY = 'true';
  const { executeRequest } = require('../server');
  await assert.rejects(
    () => executeRequest({ method: 'videos.rate', params: { id: 'x', rating: 'like' }, auth: 'key' }),
    (err) => err.status === 403 && /READ_ONLY/.test(err.message)
  );
  process.env.READ_ONLY = '';
});
