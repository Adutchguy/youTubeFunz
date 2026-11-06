/* YouTube API Playground: browser UI. No framework, no build step. */
(() => {
  'use strict';

  const S = window.YTShared;

  // ------------------------------------------------------------------ helpers
  const $ = (sel, el = document) => el.querySelector(sel);

  /** Tiny element builder: h('div', {class:'x', onclick:fn}, child, 'text', [more]) */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === undefined || kid === null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage may be unavailable; the app still works without it */
    }
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Playground': '1' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
    return data;
  }

  function toast(text, kind = 'info') {
    const t = h('div', { class: `toast ${kind}`, text });
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
  }

  async function copy(text, label = 'Copied') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(label, 'ok');
  }

  const fmt = (n) => Number(n).toLocaleString();
  const plural = (n, s) => `${fmt(n)} ${s}${n === 1 ? '' : 's'}`;

  // -------------------------------------------------------------------- state
  const state = {
    catalog: null, // { methods, bases, bucketLabels }
    byId: new Map(),
    recipes: [],
    config: null,
    quota: null,
    methodId: load('ytpg.method', 'channels.list'),
    values: load('ytpg.values', {}),
    bodies: load('ytpg.bodies', {}),
    authMode: load('ytpg.authMode', 'auto'),
    results: {}, // methodId -> last result (this page load only)
    rtab: 'body',
    history: load('ytpg.history', []),
    recipeVars: load('ytpg.recipeVars', {}),
    running: false,
  };

  const currentMethod = () => state.byId.get(state.methodId);

  /** Values for a method, creating defaults on first use. */
  function getValues(m) {
    if (!state.values[m.id]) {
      const v = {};
      for (const p of m.params) {
        if (p.default !== undefined) v[p.name] = Array.isArray(p.default) ? [...p.default] : S.resolveMacro(p.default);
      }
      state.values[m.id] = v;
      save('ytpg.values', state.values);
    }
    return state.values[m.id];
  }
  const persistValues = () => save('ytpg.values', state.values);

  function getBodyText(m) {
    if (state.bodies[m.id] === undefined) state.bodies[m.id] = JSON.stringify(m.body.template, null, 2);
    return state.bodies[m.id];
  }

  // -------------------------------------------------------------- auth logic
  function needsOAuth(m, query) {
    return m.auth === 'oauth' || (m.oauthWhen || []).some((k) => query[k] !== undefined);
  }

  function previewAuth(m, query) {
    if (state.authMode !== 'auto') return state.authMode;
    if (needsOAuth(m, query)) return 'oauth';
    if (state.config.hasApiKey) return 'key';
    return state.config.oauth.connected ? 'oauth' : 'key';
  }

  function authWarnings(m, query) {
    const out = [];
    const c = state.config;
    const o = c.oauth;
    if (!m.executable) {
      out.push(h('div', { class: 'alert info' }, h('b', { text: 'Reference only. ' }), 'This method needs a media upload, which the playground does not do. The quota cost and notes are still accurate.'));
      return out;
    }
    if (c.readOnly && m.http !== 'GET') {
      out.push(h('div', { class: 'alert err' }, h('b', { text: 'READ_ONLY is on. ' }), 'The server will refuse this request.'));
    }
    const wantOAuth = state.authMode === 'oauth' || (state.authMode === 'auto' && needsOAuth(m, query));
    if (wantOAuth && !o.connected) {
      out.push(h('div', { class: 'alert warn' }, h('b', { text: 'Needs your Google account. ' }), 'This request depends on who you are. ', h('a', { href: '#', text: 'Connect', onclick: (e) => { e.preventDefault(); openAuthDialog(); } }), ' first.'));
    } else if (wantOAuth && o.connected && o.scopes.length && !m.scopes.some((s) => o.scopes.includes(s))) {
      out.push(h('div', { class: 'alert warn' }, h('b', { text: 'Missing scope. ' }), 'Needs one of: ', h('span', { class: 'mono', text: m.scopes.map((s) => s.split('/').pop()).join(', ') }), '. Reconnect and tick it.'));
    } else if (!wantOAuth && state.authMode === 'auto' && !c.hasApiKey && !o.connected) {
      out.push(h('div', { class: 'alert warn' }, h('b', { text: 'No credentials yet. ' }), 'Add YOUTUBE_API_KEY to .env (see the README) or ', h('a', { href: '#', text: 'connect a Google account', onclick: (e) => { e.preventDefault(); openAuthDialog(); } }), '.'));
    }
    return out;
  }

  // ---------------------------------------------------------------------- nav
  function renderNav() {
    const q = $('#navSearch').value.trim().toLowerCase();
    const list = $('#navList');
    list.replaceChildren();
    const groups = new Map();
    for (const m of state.catalog.methods) {
      if (q && !(m.id.toLowerCase().includes(q) || (m.summary || '').toLowerCase().includes(q))) continue;
      const g = m.api === 'analytics' ? 'YouTube Analytics API' : m.resource;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    }
    for (const [g, methods] of groups) {
      list.append(h('div', { class: 'nav-group', text: g }));
      for (const m of methods) {
        list.append(
          h('button', { class: `nav-item${m.id === state.methodId ? ' active' : ''}${m.executable ? '' : ' ref'}`, title: m.summary, onclick: () => selectMethod(m.id) },
            h('span', { class: `verb ${m.http}`, text: m.http }),
            h('span', { class: 'name', text: m.name }),
            h('span', { class: `cost${m.cost >= 50 ? ' hi' : ''}`, text: costShort(m) })
          )
        );
      }
    }
    if (!groups.size) list.append(h('p', { class: 'hint', style: 'padding:8px 10px', text: 'No methods match.' }));
  }

  function costShort(m) {
    if (m.bucket === 'search' || m.bucket === 'upload') return '1 call';
    if (m.bucket === 'analytics') return 'free*';
    return `${m.cost}u`;
  }

  function selectMethod(id) {
    state.methodId = id;
    save('ytpg.method', id);
    renderNav();
    renderMethod();
    renderResult();
  }

  // ------------------------------------------------------------ method panel
  function badges(m) {
    const b = [];
    b.push(h('span', { class: `badge ${m.http === 'DELETE' ? 'err' : m.http === 'GET' ? '' : 'warn'}`, text: m.http }));
    b.push(h('span', { class: 'badge cost', text: costLong(m) }));
    b.push(h('span', { class: `badge ${m.auth === 'oauth' ? 'warn' : 'ok'}`, text: m.auth === 'oauth' ? 'OAuth required' : 'API key or OAuth' }));
    if (m.api === 'analytics') b.push(h('span', { class: 'badge', text: 'Analytics API' }));
    return h('div', { class: 'badges' }, b);
  }

  function costLong(m) {
    const label = state.catalog.bucketLabels[m.bucket];
    if (m.bucket === 'search') return '1 call · search bucket (100/day)';
    if (m.bucket === 'upload') return '1 call · upload bucket (100/day)';
    if (m.bucket === 'analytics') return 'Analytics quota (separate)';
    return `${plural(m.cost, 'unit')} · ${label}`;
  }

  function fieldEl(m, p, vals) {
    const id = `f-${m.id}-${p.name}`;
    const set = (v) => {
      vals[p.name] = v;
      persistValues();
      updatePreview();
    };
    let input;
    if (p.type === 'multi') {
      input = h('div', { class: 'multi' },
        p.options.map((o) => {
          const cb = h('input', {
            type: 'checkbox',
            checked: (vals[p.name] || []).includes(o),
            onchange: () => {
              const cur = new Set(vals[p.name] || []);
              if (cb.checked) cur.add(o); else cur.delete(o);
              set(p.options.filter((x) => cur.has(x)));
            },
          });
          return h('label', {}, cb, o);
        })
      );
    } else if (p.type === 'bool') {
      input = h('input', { type: 'checkbox', id, checked: vals[p.name] === true, onchange: (e) => set(e.target.checked) });
    } else if (p.type === 'enum') {
      input = h('select', { id, onchange: (e) => set(e.target.value) },
        h('option', { value: '', text: '(not set)' }),
        p.options.map((o) => h('option', { value: o, text: o, selected: vals[p.name] === o }))
      );
    } else if (p.type === 'int') {
      input = h('input', { type: 'number', id, min: p.min, max: p.max, value: vals[p.name] ?? '', oninput: (e) => set(e.target.value) });
    } else {
      input = h('input', { type: 'text', id, value: vals[p.name] ?? '', placeholder: p.placeholder || '', spellcheck: false, autocomplete: 'off', oninput: (e) => set(e.target.value) });
    }
    return h('div', { class: 'field' },
      h('label', { class: 'lbl', for: id }, p.name, p.required && h('span', { class: 'req', text: '*' })),
      input,
      p.description && h('div', { class: 'desc', text: p.description })
    );
  }

  function renderMethod() {
    const m = currentMethod();
    const vals = getValues(m);
    const panel = $('#methodPanel');
    panel.replaceChildren();

    const { query } = S.buildQuery(m, vals);
    panel.append(
      h('div', { class: 'm-title' }, h('h2', { text: m.id }), h('a', { href: m.docs, target: '_blank', rel: 'noopener', text: 'official docs ↗' })),
      badges(m),
      h('p', { class: 'summary', text: m.summary }),
      m.notes.length ? h('ul', { class: 'notes' }, m.notes.map((n) => h('li', { text: n }))) : null,
      h('div', { id: 'warnings' }, authWarnings(m, query))
    );

    const required = m.params.filter((p) => p.required);
    const filters = m.params.filter((p) => !p.required && p.filter);
    const optional = m.params.filter((p) => !p.required && !p.filter);

    if (required.length) panel.append(h('fieldset', {}, h('legend', { text: 'Required' }), required.map((p) => fieldEl(m, p, vals))));
    if (filters.length) panel.append(h('fieldset', {}, h('legend', {}, 'Filter ', h('em', { text: '— use exactly one' })), filters.map((p) => fieldEl(m, p, vals))));
    if (optional.length) {
      const body = optional.map((p) => fieldEl(m, p, vals));
      panel.append(
        optional.length <= 8
          ? h('fieldset', {}, h('legend', { text: 'Optional' }), body)
          : h('details', { class: 'adv', open: false }, h('summary', { text: `More parameters (${optional.length})` }), h('fieldset', {}, body))
      );
    }

    if (m.body) {
      const ta = h('textarea', {
        id: 'bodyText',
        spellcheck: false,
        value: getBodyText(m),
        oninput: () => {
          state.bodies[m.id] = ta.value;
          save('ytpg.bodies', state.bodies);
          updatePreview();
        },
      });
      panel.append(h('fieldset', {}, h('legend', { text: 'Request body (JSON)' }), ta, h('div', { class: 'desc', id: 'bodyStatus' }), m.body.note && h('div', { class: 'desc', text: m.body.note })));
    }

    if (m.executable) {
      panel.append(
        h('details', { class: 'adv' },
          h('summary', { text: 'Advanced' }),
          h('fieldset', {},
            m.api === 'data' ? fieldEl(m, { name: 'fields', type: 'string', placeholder: 'items(id,snippet/title,statistics/viewCount)', description: 'Trim the response to just these fields. Same quota cost, much smaller payload.' }, vals) : null,
            h('div', { class: 'field' },
              h('label', { class: 'lbl', for: 'authMode', text: 'credentials' }),
              h('select', { id: 'authMode', onchange: (e) => { state.authMode = e.target.value; save('ytpg.authMode', state.authMode); renderMethod(); } },
                [['auto', 'Auto (OAuth if the request needs it, otherwise API key)'], ['key', 'API key only'], ['oauth', 'OAuth only'], ['none', 'None (watch it fail)']].map(([v, t]) => h('option', { value: v, text: t, selected: state.authMode === v }))
              ),
              h('div', { class: 'desc', text: 'Try forcing the wrong credentials to see the errors Google returns.' })
            )
          )
        )
      );
    }

    panel.append(
      h('div', { class: 'preview mono', id: 'preview' }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', id: 'runBtn', onclick: () => run(m), text: m.executable ? 'Send request' : 'Reference only', disabled: !m.executable }),
        h('button', { class: 'btn', onclick: () => copyCurl(m), text: 'Copy as curl', disabled: !m.executable }),
        h('button', { class: 'btn subtle', onclick: () => resetMethod(m), text: 'Reset form' }),
        h('span', { class: 'hint', text: 'Ctrl+Enter to send' })
      )
    );
    updatePreview();
  }

  function parseBody(m) {
    if (!m.body) return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(getBodyText(m)) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function updatePreview() {
    const m = currentMethod();
    const el = $('#preview');
    if (!el) return;
    const vals = getValues(m);
    const { query, missing } = S.buildQuery(m, vals);
    const auth = previewAuth(m, query);
    const shown = { ...query };
    if (auth === 'key') shown.key = 'YOUR_API_KEY';
    const qs = S.toQueryString(shown);
    el.replaceChildren(
      h('span', { class: `verb ${m.http}`, text: m.http }),
      `${S.baseFor(m, state.catalog.bases)}${m.path}${qs ? '?' + qs : ''}`,
      auth === 'oauth' ? h('div', { class: 'hint', text: 'Authorization: Bearer <your access token>' }) : null,
      missing.length ? h('div', { class: 'hint', style: 'color:var(--warn)', text: `Missing required: ${missing.join(', ')}` }) : null
    );
    const bodyStatus = $('#bodyStatus');
    if (bodyStatus) {
      const b = parseBody(m);
      bodyStatus.textContent = b.ok ? 'Valid JSON.' : `Invalid JSON: ${b.error}`;
      bodyStatus.style.color = b.ok ? '' : 'var(--err)';
    }
    const warn = $('#warnings');
    if (warn) warn.replaceChildren(...authWarnings(m, query));
  }

  function resetMethod(m) {
    delete state.values[m.id];
    delete state.bodies[m.id];
    save('ytpg.values', state.values);
    save('ytpg.bodies', state.bodies);
    renderMethod();
  }

  function copyCurl(m) {
    const { query } = S.buildQuery(m, getValues(m));
    const b = parseBody(m);
    copy(S.toCurl(m, query, b.ok ? b.value : undefined, previewAuth(m, query), state.catalog.bases), 'curl command copied (secrets are shell variables)');
  }

  // --------------------------------------------------------------------- run
  function confirmWrite(m) {
    if (m.http === 'DELETE') {
      const typed = window.prompt(`${m.id} permanently deletes data on your real YouTube account (${m.cost} units).\n\nType DELETE to confirm.`);
      return typed === 'DELETE';
    }
    return window.confirm(`${m.id} will change your real YouTube channel and costs ${m.cost} units.\n\nSend it?`);
  }

  async function run(m) {
    if (state.running || !m.executable) return;
    const vals = getValues(m);
    const { missing } = S.buildQuery(m, vals);
    if (missing.length) return toast(`Missing required: ${missing.join(', ')}`, 'err');
    const b = parseBody(m);
    if (!b.ok) return toast(`Request body is not valid JSON: ${b.error}`, 'err');
    if (m.http !== 'GET' && !confirmWrite(m)) return;

    state.running = true;
    const btn = $('#runBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      const result = await api('/api/request', { method: 'POST', body: { method: m.id, params: vals, body: b.value, auth: state.authMode } });
      state.results[m.id] = result;
      pushHistory(m, vals, b.value, result);
    } catch (err) {
      state.results[m.id] = { localError: err.message };
    } finally {
      state.running = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Send request'; }
    }
    if (state.methodId === m.id) renderResult();
    refreshQuota();
  }

  function pushHistory(m, vals, body, result) {
    state.history.unshift({ id: m.id, values: JSON.parse(JSON.stringify(vals)), body, status: result.status, ms: result.ms, at: Date.now() });
    state.history = state.history.slice(0, 30);
    save('ytpg.history', state.history);
  }

  // ------------------------------------------------------------------ result
  function tree(value, key, depth) {
    const label = key === undefined ? [] : [h('span', { class: 'k', text: typeof key === 'number' ? String(key) : JSON.stringify(key) }), ': '];
    if (value === null || typeof value !== 'object') {
      const cls = value === null ? 'z' : typeof value === 'string' ? 's' : typeof value === 'number' ? 'n' : 'b';
      return h('div', { class: 'leaf' }, ...label, h('span', { class: cls, text: JSON.stringify(value) }));
    }
    const isArr = Array.isArray(value);
    const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
    if (!entries.length) return h('div', { class: 'leaf' }, ...label, isArr ? '[]' : '{}');
    return h('details', { open: depth < 2 },
      h('summary', {}, ...label, h('span', { class: 'meta', text: isArr ? `[${entries.length}]` : `{${entries.length}}` })),
      entries.map(([k, v]) => tree(v, k, depth + 1))
    );
  }

  function flatten(obj, prefix = '', out = {}, depth = 0) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && depth < 3) flatten(v, key, out, depth + 1);
      else if (Array.isArray(v)) out[key] = v.length && typeof v[0] !== 'object' ? v.join(', ') : `[${v.length}]`;
      else out[key] = v;
    }
    return out;
  }

  function tableFrom(json) {
    if (json && Array.isArray(json.columnHeaders) && Array.isArray(json.rows)) {
      return { cols: json.columnHeaders.map((c) => c.name), rows: json.rows };
    }
    const items = json && json.items;
    if (!Array.isArray(items) || !items.length || typeof items[0] !== 'object') return null;
    const flat = items.map((it) => flatten(it));
    const seen = new Set();
    for (const f of flat) for (const k of Object.keys(f)) seen.add(k);
    const skip = /(^|\.)(etag|kind)$|thumbnails|localized|description$|liveBroadcastContent|defaultAudioLanguage/;
    const prio = [/^id(\.|$)/, /title$/, /channelTitle$/, /publishedAt$|publishTime$/, /^statistics\./, /^contentDetails\.(duration|videoId)/];
    const score = (k) => { const i = prio.findIndex((r) => r.test(k)); return i === -1 ? 99 : i; };
    const cols = [...seen].filter((k) => !skip.test(k)).sort((a, b) => score(a) - score(b)).slice(0, 10);
    return { cols, rows: flat.map((f) => cols.map((c) => f[c])) };
  }

  function tableEl(t) {
    const cell = (v) => {
      if (v === undefined || v === null) return h('td', { text: '' });
      const isNum = typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v) && v.length < 16);
      const s = String(v);
      return h('td', { class: isNum ? 'num' : '', text: isNum ? fmt(v) : s.length > 90 ? s.slice(0, 87) + '…' : s, title: s });
    };
    return h('div', { style: 'overflow:auto;max-height:62vh' },
      h('table', { class: 'data' }, h('thead', {}, h('tr', {}, t.cols.map((c) => h('th', { text: c })))), h('tbody', {}, t.rows.map((r) => h('tr', {}, r.map(cell)))))
    );
  }

  function renderResult() {
    const m = currentMethod();
    const r = state.results[m.id];
    const panel = $('#resultPanel');
    panel.replaceChildren();

    if (!r) {
      panel.append(
        h('div', { class: 'empty' }, h('b', { text: 'No response yet' }), m.executable ? 'Fill in the form and press Send request. The response, headers, and quota cost show up here.' : 'This method is reference-only.')
      );
    } else if (r.localError) {
      panel.append(h('div', { class: 'alert err' }, h('b', { text: 'Not sent. ' }), r.localError));
    } else {
      panel.append(resultView(m, r));
    }
    panel.append(historyView());
  }

  function resultView(m, r) {
    const json = r.response.json;
    const wrap = h('div');
    const cls = `s${String(r.status)[0]}`;
    wrap.append(
      h('div', { class: 'status-row' },
        h('span', { class: `pill ${cls}`, text: `${r.status} ${r.statusText}`.trim() }),
        h('span', { class: 'stat', text: `${r.ms} ms · ${r.bytes.toLocaleString()} bytes · ${r.authUsed === 'none' ? 'no credentials' : r.authUsed === 'key' ? 'API key' : 'OAuth'}` }),
        h('span', { class: 'badge', text: r.quota.bucket === 'analytics' ? 'Analytics call' : `−${r.quota.cost} ${r.quota.bucket === 'search' || r.quota.bucket === 'upload' ? 'call' : r.quota.cost === 1 ? 'unit' : 'units'} · ${r.quota.bucketLabel}` })
      )
    );
    if (r.explain && r.explain.hint) {
      wrap.append(h('div', { class: 'alert err' }, h('b', { text: r.explain.reason ? `${r.explain.reason}: ` : 'What this means: ' }), r.explain.hint));
    }
    if (json && json.error && json.error.message) {
      wrap.append(h('div', { class: 'alert' }, h('b', { text: 'Google says: ' }), json.error.message));
    }

    // Paging
    if (json && (json.nextPageToken || json.prevPageToken)) {
      const go = (token) => {
        const vals = getValues(m);
        vals.pageToken = token;
        persistValues();
        renderMethod();
        run(m);
      };
      const total = json.pageInfo && json.pageInfo.totalResults;
      wrap.append(
        h('div', { class: 'pager' },
          json.prevPageToken ? h('button', { class: 'btn', text: '← Prev page', onclick: () => go(json.prevPageToken) }) : null,
          json.nextPageToken ? h('button', { class: 'btn', text: `Next page → (${m.cost >= 1 ? 'costs again' : ''})`, onclick: () => go(json.nextPageToken) }) : null,
          h('span', { class: 'hint', text: `${Array.isArray(json.items) ? plural(json.items.length, 'item') + ' on this page' : ''}${total !== undefined ? ` · ${fmt(total)} total` : ''}` })
        )
      );
    } else if (json && Array.isArray(json.items)) {
      const total = json.pageInfo && json.pageInfo.totalResults;
      wrap.append(h('div', { class: 'hint', text: `${plural(json.items.length, 'item')}${total !== undefined ? ` of ${fmt(total)}` : ''} · no more pages` }));
    }

    const table = json ? tableFrom(json) : null;
    const tabs = [['body', 'Body'], table ? ['table', 'Table'] : null, ['raw', 'Raw'], ['headers', 'Headers'], ['request', 'Request']].filter(Boolean);
    if (!tabs.some(([k]) => k === state.rtab)) state.rtab = 'body';
    wrap.append(
      h('div', { class: 'rtabs' }, tabs.map(([k, t]) => h('button', { class: state.rtab === k ? 'active' : '', text: t, onclick: () => { state.rtab = k; renderResult(); } })))
    );

    const rawText = json !== undefined ? JSON.stringify(json, null, 2) : r.response.text || '';
    if (state.rtab === 'body') {
      if (json !== undefined) {
        wrap.append(h('div', { class: 'tree' }, tree(json, undefined, 0)));
        wrap.append(h('p', {}, h('button', { class: 'btn subtle', text: 'Copy JSON', onclick: () => copy(rawText, 'JSON copied') })));
      } else if (r.response.text) {
        wrap.append(h('pre', { class: 'raw', text: r.response.text }));
      } else {
        wrap.append(h('div', { class: 'alert info' }, 'Empty body. That is normal for methods that return ', h('code', { text: '204 No Content' }), ' on success.'));
      }
    } else if (state.rtab === 'table') {
      wrap.append(tableEl(table));
    } else if (state.rtab === 'raw') {
      wrap.append(h('pre', { class: 'raw', text: rawText || '(empty)' }));
    } else if (state.rtab === 'headers') {
      wrap.append(h('table', { class: 'plain' }, h('tbody', {}, Object.entries(r.response.headers).map(([k, v]) => h('tr', {}, h('td', { class: 'mono', text: k }), h('td', { class: 'mono', text: v }))))));
    } else if (state.rtab === 'request') {
      const reqLines = [`${r.request.method} ${r.request.url}`, ...Object.entries(r.request.headers).map(([k, v]) => `${k}: ${v}`)];
      wrap.append(h('pre', { class: 'raw', text: reqLines.join('\n') + (r.request.body ? '\n\n' + JSON.stringify(r.request.body, null, 2) : '') }));
      wrap.append(h('p', {}, h('button', { class: 'btn', text: 'Copy as curl', onclick: () => copyCurl(m) })));
    }
    return wrap;
  }

  function historyView() {
    const items = state.history;
    return h('details', { class: 'adv', style: 'margin-top:18px' },
      h('summary', { text: `Recent requests (${items.length})` }),
      items.length
        ? h('table', { class: 'plain' }, h('tbody', {}, items.slice(0, 15).map((it) =>
            h('tr', { style: 'cursor:pointer', title: 'Load these parameters', onclick: () => {
              if (!state.byId.has(it.id)) return;
              state.values[it.id] = JSON.parse(JSON.stringify(it.values));
              if (it.body !== undefined) state.bodies[it.id] = JSON.stringify(it.body, null, 2);
              persistValues();
              switchTab('explorer');
              selectMethod(it.id);
            } },
              h('td', { class: 'mono', text: new Date(it.at).toLocaleTimeString() }),
              h('td', { class: 'mono', text: it.id }),
              h('td', { class: 'mono', text: String(it.status) }),
              h('td', { class: 'mono', text: `${it.ms} ms` })
            ))))
        : h('p', { class: 'hint', text: 'Nothing yet.' })
    );
  }

  // ----------------------------------------------------------------- recipes
  function costText(steps) {
    const totals = {};
    for (const s of steps) {
      const m = state.byId.get(s.method);
      totals[m.bucket] = (totals[m.bucket] || 0) + m.cost;
    }
    const labels = {
      general: (n) => plural(n, 'unit'),
      search: (n) => plural(n, 'search call'),
      upload: (n) => plural(n, 'upload call'),
      batchStats: (n) => plural(n, 'batchStats unit'),
      analytics: (n) => plural(n, 'Analytics call'),
    };
    return Object.entries(totals).map(([b, n]) => labels[b](n)).join(' + ');
  }

  function renderRecipes() {
    const list = $('#recipeList');
    list.replaceChildren();
    for (const r of state.recipes) {
      const vars = { ...Object.fromEntries(r.vars.map((v) => [v.name, v.default])), ...(state.recipeVars[r.id] || {}) };
      const trace = h('div', { class: 'trace' });
      const btn = h('button', { class: 'btn primary', text: 'Run recipe', onclick: () => runRecipe(r, vars, trace, btn) });
      const authBadge = r.auth === 'oauth' ? h('span', { class: 'badge warn', text: 'needs Google account' }) : h('span', { class: 'badge ok', text: 'API key' });
      list.append(
        h('details', { class: 'recipe' },
          h('summary', {}, h('b', { text: r.title }), h('span', { class: 'badge', text: r.level }), authBadge, h('span', { class: 'badge cost', text: `≈ ${costText(r.steps)}` })),
          h('div', { class: 'recipe-body' },
            h('p', { text: r.blurb }),
            r.vars.length
              ? h('div', { class: 'vars' }, r.vars.map((v) => h('div', { class: 'field' },
                  h('label', { class: 'lbl', text: v.label }),
                  h('input', { type: 'text', value: vars[v.name], spellcheck: false, oninput: (e) => { vars[v.name] = e.target.value; state.recipeVars[r.id] = { ...vars }; save('ytpg.recipeVars', state.recipeVars); } })
                )))
              : null,
            h('ol', { class: 'steps' }, r.steps.map((s) => h('li', {}, h('code', { text: s.method }), ` ${s.title}`))),
            h('div', { class: 'actions' }, btn),
            trace
          )
        )
      );
    }
  }

  function coerceParam(m, name, text) {
    const p = m.params.find((x) => x.name === name);
    if (!p) return text;
    if (p.type === 'multi') return text.split(',').map((s) => s.trim()).filter(Boolean);
    if (p.type === 'bool') return text === 'true';
    return text;
  }

  async function runRecipe(r, vars, traceEl, btn) {
    const ctx = { ...vars };
    btn.disabled = true;
    traceEl.replaceChildren();
    const fail = (text) => traceEl.append(h('div', { class: 'alert err' }, text));

    for (const [i, step] of r.steps.entries()) {
      const m = state.byId.get(step.method);
      const params = {};
      const unresolved = [];
      for (const [k, v] of Object.entries(step.params)) {
        const f = S.fillTemplate(v, ctx);
        unresolved.push(...f.unresolved);
        params[k] = coerceParam(m, k, f.text);
      }
      if (unresolved.length) {
        fail(`Step ${i + 1} needs ${unresolved.join(', ')}, which an earlier step did not produce.`);
        break;
      }

      const card = h('div', { class: 'trace-step' }, h('h4', { text: `Step ${i + 1} of ${r.steps.length} · ${step.title}` }), h('div', { class: 'hint', text: 'Running…' }));
      traceEl.append(card);

      let result;
      try {
        result = await api('/api/request', { method: 'POST', body: { method: m.id, params, auth: 'auto' } });
      } catch (err) {
        card.replaceChildren(h('h4', { text: `Step ${i + 1} · ${step.title}` }), h('div', { class: 'alert err' }, h('b', { text: 'Not sent. ' }), err.message));
        break;
      }
      refreshQuota();

      const extracted = {};
      let stop = !result.ok;
      if (result.ok) {
        for (const [name, path] of Object.entries(step.extract || {})) {
          const val = S.getPath(result.response.json, path);
          if (val === undefined) {
            extracted[name] = null;
            stop = true;
          } else {
            ctx[name] = val;
            extracted[name] = val;
          }
        }
      }

      card.replaceChildren(
        h('h4', { text: `Step ${i + 1} of ${r.steps.length} · ${step.title}` }),
        step.explain ? h('div', { class: 'explain', text: step.explain }) : null,
        h('div', { class: 'mono', style: 'word-break:break-all', text: `${result.request.method} ${result.request.url}` }),
        h('div', { class: 'status-row', style: 'margin-top:6px' },
          h('span', { class: `pill s${String(result.status)[0]}`, text: String(result.status) }),
          h('span', { class: 'stat', text: `${result.ms} ms · −${result.quota.cost} ${result.quota.bucketLabel}` })
        ),
        result.explain && result.explain.hint ? h('div', { class: 'alert err' }, result.explain.hint) : null,
        Object.keys(extracted).length
          ? h('div', { class: 'vchips' }, Object.entries(extracted).map(([k, v]) => h('span', { class: 'vchip', title: String(v), text: v === null ? `${k} = (nothing found)` : `${k} = ${String(v).length > 70 ? String(v).slice(0, 67) + '…' : v}` })))
          : null,
        h('details', {}, h('summary', { text: 'Response' }), result.response.json !== undefined ? h('div', { class: 'tree' }, tree(result.response.json, undefined, 1)) : h('pre', { class: 'raw', text: result.response.text || '(empty)' })),
        h('p', {}, h('button', { class: 'btn subtle', text: 'Open this step in the Explorer', onclick: () => {
          state.values[m.id] = { ...(state.values[m.id] || {}), ...Object.fromEntries(Object.entries(params)) };
          persistValues();
          switchTab('explorer');
          selectMethod(m.id);
        } }))
      );

      if (stop) {
        if (!result.ok) fail('Stopped: this step failed, so later steps can not run.');
        else fail('Stopped: the response did not contain what the next step needs (for example, the handle or ID does not exist, or the channel has no videos).');
        break;
      }
    }
    btn.disabled = false;
  }

  // ------------------------------------------------------------------- quota
  const pct = (b) => (b.limit ? Math.min(100, (b.used / b.limit) * 100) : 0);
  const barClass = (p) => (p >= 90 ? 'danger' : p >= 70 ? 'warn' : '');

  async function refreshQuota() {
    try {
      state.quota = await api('/api/quota');
    } catch {
      return;
    }
    renderQuotaMini();
    if ($('#tab-quota').classList.contains('active')) renderQuotaPage();
  }

  function renderQuotaMini() {
    const el = $('#quotaMini');
    el.replaceChildren();
    for (const id of ['general', 'search']) {
      const b = state.quota.buckets.find((x) => x.id === id);
      const p = pct(b);
      el.append(h('span', { class: 'qm' }, h('span', { text: `${b.label}` }), h('b', { class: 'mono', text: `${fmt(b.used)} / ${fmt(b.limit)}` }), h('span', { class: `bar ${barClass(p)}` }, h('i', { style: `width:${p}%` }))));
    }
  }

  function renderQuotaPage() {
    const q = state.quota;
    const hrs = Math.floor(q.resetsInMs / 3600000);
    const mins = Math.floor((q.resetsInMs % 3600000) / 60000);
    $('#quotaNote').textContent = `${q.note} Counting day: ${q.day} (Pacific). Resets in ${hrs}h ${mins}m.`;
    const box = $('#quotaBuckets');
    box.replaceChildren(...q.buckets.map((b) => {
      const p = pct(b);
      return h('div', { class: 'bucket' },
        h('div', { class: 'hint', text: b.label }),
        h('div', { class: 'big', text: b.limit === null ? fmt(b.used) : `${fmt(b.used)} / ${fmt(b.limit)}` }),
        b.limit !== null ? h('div', { class: `bar ${barClass(p)}` }, h('i', { style: `width:${p}%` })) : null,
        h('div', { class: 'hint', text: `${b.unit}${b.remaining !== null ? ` · ${fmt(b.remaining)} left` : ''}` }),
        h('div', { class: 'desc', text: b.note })
      );
    }));
    const rows = Object.entries(q.byMethod).sort((a, b) => b[1].cost - a[1].cost);
    $('#quotaMethods').replaceChildren(
      rows.length
        ? h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Method', 'Calls', 'Spent', 'Bucket'].map((t) => h('th', { text: t })))),
            h('tbody', {}, rows.map(([id, v]) => h('tr', {}, h('td', { class: 'mono', text: id }), h('td', { class: 'num', text: fmt(v.calls) }), h('td', { class: 'num', text: fmt(v.cost) }), h('td', { text: state.catalog.bucketLabels[v.bucket] || v.bucket })))))
        : h('p', { class: 'hint', text: 'Nothing spent yet today.' })
    );
  }

  // ------------------------------------------------------------------- learn
  function renderCostTable() {
    const order = ['general', 'batchStats', 'search', 'upload', 'analytics'];
    const rows = [...state.catalog.methods].sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket) || a.cost - b.cost || a.id.localeCompare(b.id));
    $('#costTable').replaceChildren(
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['Method', 'HTTP', 'Credentials', 'Cost', 'Bucket'].map((t) => h('th', { text: t })))),
        h('tbody', {}, rows.map((m) => h('tr', { style: 'cursor:pointer', onclick: () => { switchTab('explorer'); selectMethod(m.id); } },
          h('td', { class: 'mono', text: m.id }),
          h('td', { class: 'mono', text: m.http }),
          h('td', { text: m.auth === 'oauth' ? 'OAuth' : 'Key or OAuth' }),
          h('td', { class: 'num', text: m.bucket === 'search' || m.bucket === 'upload' ? '1 call' : m.bucket === 'analytics' ? '—' : String(m.cost) }),
          h('td', { text: state.catalog.bucketLabels[m.bucket] })
        )))
      )
    );
  }

  // -------------------------------------------------------------------- auth
  function renderAuthChip() {
    const c = state.config;
    const on = c.oauth.connected || c.hasApiKey;
    const chip = $('#authChip');
    chip.className = `chip${on ? ' on' : ''}`;
    chip.replaceChildren(h('span', { class: 'dot' }), c.oauth.connected ? 'Google connected' : 'Connect Google', c.hasApiKey ? ' · key ✓' : '');
    chip.title = 'Credentials';
  }

  function openAuthDialog() {
    const c = state.config;
    const o = c.oauth;
    const granted = new Set(o.scopes);
    const boxes = c.scopes.map((s) => {
      const cb = h('input', { type: 'checkbox', value: s.scope, checked: o.connected ? granted.has(s.scope) : s.default });
      return h('label', { class: 'scope-row' }, cb, h('div', {}, h('span', { class: 'mono', text: s.label }), h('small', { text: s.description })));
    });
    const body = $('#authBody');
    body.replaceChildren(
      h('h3', { text: 'Credentials' }),
      h('p', {}, h('b', { text: 'API key: ' }), c.hasApiKey ? 'loaded from .env ✓ (public data only)' : h('span', {}, 'not set. Add ', h('code', { text: 'YOUTUBE_API_KEY' }), ' to .env and restart the server.')),
      h('p', {}, h('b', { text: 'Google account (OAuth): ' }), o.connected ? `connected${o.canRefresh ? ' (auto-refreshing)' : ' (no refresh token; will expire in about an hour)'}` : o.configured ? 'not connected' : 'OAuth client not configured'),
      o.configured
        ? h('div', {}, h('p', { class: 'hint', text: 'Pick the scopes to request. Ask for the least you need; you can reconnect any time to change them.' }), ...boxes)
        : h('div', { class: 'alert info' },
            h('b', { text: 'One-time setup for private data & Analytics' }),
            h('ol', { class: 'setup' },
              h('li', {}, 'In ', h('a', { href: 'https://console.cloud.google.com/apis/library', target: '_blank', rel: 'noopener', text: 'Google Cloud Console' }), ' enable the YouTube Data API v3 (and YouTube Analytics API).'),
              h('li', { text: 'Set up the OAuth consent screen and add your Google account as a test user.' }),
              h('li', {}, 'Credentials → Create OAuth client ID → Web application. Add this exact redirect URI: ', h('code', { text: o.redirectUri })),
              h('li', {}, 'Copy the client ID and secret into ', h('code', { text: 'GOOGLE_CLIENT_ID' }), ' and ', h('code', { text: 'GOOGLE_CLIENT_SECRET' }), ' in .env, then restart.')
            )
          ),
      h('div', { class: 'actions' },
        o.configured ? h('button', { type: 'button', class: 'btn primary', text: o.connected ? 'Reconnect with these scopes' : 'Connect Google account', onclick: () => {
          const scopes = [...body.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);
          window.location.href = `/auth/login?scopes=${encodeURIComponent(scopes.join(' '))}`;
        } }) : null,
        o.connected ? h('button', { type: 'button', class: 'btn', text: 'Disconnect', onclick: async () => {
          try {
            state.config = await api('/auth/logout', { method: 'POST', body: {} });
            renderAuthChip();
            renderMethod();
            toast('Disconnected and token revoked', 'ok');
            $('#authDialog').close();
          } catch (err) { toast(err.message, 'err'); }
        } }) : null,
        h('button', { class: 'btn subtle', value: 'close', text: 'Close' })
      )
    );
    $('#authDialog').showModal();
  }

  // -------------------------------------------------------------------- tabs
  function switchTab(name) {
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === name);
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.id === `tab-${name}`);
    if (name === 'quota') refreshQuota().then(renderQuotaPage);
  }

  // -------------------------------------------------------------------- init
  async function init() {
    try {
      const [catalog, recipes, config, quota] = await Promise.all([api('/api/catalog'), api('/api/recipes'), api('/api/config'), api('/api/quota')]);
      state.catalog = catalog;
      state.byId = new Map(catalog.methods.map((m) => [m.id, m]));
      state.recipes = recipes.recipes;
      state.config = config;
      state.quota = quota;
    } catch (err) {
      document.body.prepend(h('div', { class: 'alert err', style: 'margin:16px' }, `Could not load the playground: ${err.message}`));
      return;
    }
    if (!state.byId.has(state.methodId)) state.methodId = 'channels.list';

    $('#tabs').addEventListener('click', (e) => { const t = e.target.closest('button'); if (t) switchTab(t.dataset.tab); });
    $('#navSearch').addEventListener('input', renderNav);
    $('#authChip').addEventListener('click', openAuthDialog);
    $('#quotaMini').addEventListener('click', () => switchTab('quota'));
    $('#quotaReset').addEventListener('click', async () => { state.quota = await api('/api/quota/reset', { method: 'POST', body: {} }); renderQuotaMini(); renderQuotaPage(); toast('Local counter reset', 'ok'); });
    $('#authDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && $('#tab-explorer').classList.contains('active')) { e.preventDefault(); run(currentMethod()); }
    });

    renderAuthChip();
    renderQuotaMini();
    renderNav();
    renderMethod();
    renderResult();
    renderRecipes();
    renderCostTable();

    // Returning from Google's consent screen
    const qs = new URLSearchParams(window.location.search);
    if (qs.has('auth')) {
      if (qs.get('auth') === 'ok') toast('Google account connected', 'ok');
      else toast(`Connect failed: ${qs.get('msg') || 'unknown error'}`, 'err');
      history.replaceState(null, '', '/');
    }
  }

  init();
})();
