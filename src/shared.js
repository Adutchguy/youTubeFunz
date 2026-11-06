'use strict';
/**
 * Helpers shared by the server (require) and the browser (<script src="/shared.js">).
 * Keeping them in one place guarantees the URL preview you see in the UI is built
 * exactly the way the server builds the real request.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YTShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Turn a form value into the string that goes on the wire (or undefined to omit it). */
  function normalize(v) {
    if (v === undefined || v === null) return undefined;
    if (Array.isArray(v)) return v.length ? v.join(',') : undefined;
    if (typeof v === 'boolean') return v ? 'true' : undefined;
    const s = String(v).trim();
    return s === '' ? undefined : s;
  }

  /**
   * Build the query-string object for a method from raw form values.
   * Only parameters the catalog knows about (plus `fields` on Data API calls) are kept.
   */
  function buildQuery(method, values) {
    const query = {};
    const params = method.params || [];
    const names = params.map((p) => p.name);
    if (method.api === 'data') names.push('fields');
    for (const name of names) {
      const s = normalize((values || {})[name]);
      if (s !== undefined) query[name] = s;
    }
    const missing = params.filter((p) => p.required && query[p.name] === undefined).map((p) => p.name);
    return { query, missing };
  }

  function baseFor(method, bases) {
    return method.api === 'analytics' ? bases.analytics : bases.data;
  }

  function toQueryString(query) {
    return Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  /** Date macros used for defaults: @today, @daysAgo:28 -> YYYY-MM-DD (UTC). */
  function resolveMacro(v, now) {
    if (typeof v !== 'string' || v[0] !== '@') return v;
    const d = new Date(now || Date.now());
    if (v === '@today') return d.toISOString().slice(0, 10);
    const m = /^@daysAgo:(\d+)$/.exec(v);
    if (m) {
      d.setUTCDate(d.getUTCDate() - Number(m[1]));
      return d.toISOString().slice(0, 10);
    }
    return v;
  }

  /** {{var}} substitution for recipes. Also supports {{today}} and {{daysAgo:N}}. */
  function fillTemplate(str, vars) {
    const unresolved = [];
    const text = String(str).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (all, name) => {
      if (name === 'today') return resolveMacro('@today');
      const m = /^daysAgo:(\d+)$/.exec(name);
      if (m) return resolveMacro(`@daysAgo:${m[1]}`);
      if (vars && vars[name] !== undefined && vars[name] !== '') return String(vars[name]);
      unresolved.push(name);
      return all;
    });
    return { text, unresolved };
  }

  /**
   * Tiny path getter for recipes: "items.0.contentDetails.relatedPlaylists.uploads",
   * "items.*.id" (maps over arrays and joins with commas), "rows.*.0".
   */
  function getPath(obj, path) {
    const parts = String(path).split('.');
    function walk(cur, i) {
      if (cur === undefined || cur === null) return undefined;
      if (i === parts.length) return cur;
      const key = parts[i];
      if (key === '*') {
        if (!Array.isArray(cur)) return undefined;
        return cur.map((x) => walk(x, i + 1)).filter((x) => x !== undefined);
      }
      return walk(cur[key], i + 1);
    }
    const out = walk(obj, 0);
    if (Array.isArray(out)) {
      const flat = out.flat(Infinity);
      return flat.length ? flat.join(',') : undefined;
    }
    return out === undefined || out === null ? undefined : String(out);
  }

  /** A copy-pasteable curl command. Secrets are shown as shell variables, never real values. */
  function toCurl(method, query, body, authType, bases) {
    const q = { ...query };
    if (authType === 'key') q.key = '__KEY__';
    const qs = toQueryString(q).replace('__KEY__', '$YT_API_KEY');
    const url = `${baseFor(method, bases)}${method.path}${qs ? '?' + qs : ''}`;
    const lines = [`curl${method.http === 'GET' ? '' : ' -X ' + method.http} "${url}"`];
    if (authType === 'oauth') lines.push('  -H "Authorization: Bearer $YT_ACCESS_TOKEN"');
    lines.push('  -H "Accept: application/json"');
    if (body !== undefined && body !== null && method.http !== 'GET') {
      lines.push('  -H "Content-Type: application/json"');
      lines.push(`  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`);
    }
    return lines.join(' \\\n');
  }

  return { normalize, buildQuery, baseFor, toQueryString, resolveMacro, fillTemplate, getPath, toCurl };
});
