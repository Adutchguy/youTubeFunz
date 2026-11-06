'use strict';
/**
 * Local quota tracker.
 *
 * Google does not return "quota remaining" in API responses, so this keeps a running
 * tally of what *this playground* has spent today. It is an estimate: other apps using
 * the same Cloud project aren't counted. The Quotas page in Google Cloud Console is the
 * source of truth. Daily quota resets at midnight Pacific Time.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const FILE = path.join(config.dataDir, 'quota.json');

const BUCKETS = [
  {
    id: 'general',
    label: 'General pool',
    unit: 'units',
    limit: config.limits.general,
    note: 'Shared by almost every method (reads cost 1, writes usually 50).',
  },
  {
    id: 'search',
    label: 'search.list',
    unit: 'calls',
    limit: config.limits.search,
    note: 'Its own bucket since June 2026: 100 calls per day by default.',
  },
  {
    id: 'upload',
    label: 'videos.insert',
    unit: 'calls',
    limit: config.limits.upload,
    note: 'Its own bucket since June 2026: 100 uploads per day by default.',
  },
  {
    id: 'batchStats',
    label: 'videos.batchGetStats',
    unit: 'units',
    limit: config.limits.batchStats,
    note: 'New method (June 2026) with its own 10,000-unit bucket.',
  },
  {
    id: 'analytics',
    label: 'Analytics API',
    unit: 'calls',
    limit: null,
    note: 'A separate API with its own quota; counted here for curiosity only.',
  },
];

const pacificFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function pacificParts(date = new Date()) {
  const o = {};
  for (const p of pacificFormatter.formatToParts(date)) o[p.type] = p.value;
  return o;
}

function pacificDay(date = new Date()) {
  const p = pacificParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Milliseconds until the next midnight Pacific (ignores the rare 23/25h DST days). */
function msUntilReset(date = new Date()) {
  const p = pacificParts(date);
  const elapsed = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  return Math.max(0, (86400 - elapsed) * 1000);
}

let state = { day: pacificDay(), used: {}, byMethod: {} };

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (saved && saved.day === pacificDay()) state = saved;
  } catch {
    /* first run or unreadable file: start fresh */
  }
}

function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch {
    /* quota persistence is best-effort */
  }
}

function rollover() {
  const today = pacificDay();
  if (state.day !== today) state = { day: today, used: {}, byMethod: {} };
}

function record(method) {
  rollover();
  const bucket = method.bucket || 'general';
  const cost = method.cost || 0;
  state.used[bucket] = (state.used[bucket] || 0) + cost;
  const m = (state.byMethod[method.id] = state.byMethod[method.id] || { calls: 0, cost: 0, bucket });
  m.calls += 1;
  m.cost += cost;
  save();
}

function reset() {
  state = { day: pacificDay(), used: {}, byMethod: {} };
  save();
}

function snapshot() {
  rollover();
  return {
    day: state.day,
    resetsInMs: msUntilReset(),
    note:
      'Local estimate of what this playground has spent today (Pacific day). ' +
      'Check the Quotas page in Google Cloud Console for the authoritative number.',
    buckets: BUCKETS.map((b) => {
      const used = state.used[b.id] || 0;
      return {
        ...b,
        used,
        remaining: b.limit === null ? null : Math.max(0, b.limit - used),
      };
    }),
    byMethod: state.byMethod,
  };
}

load();

module.exports = { record, reset, snapshot, pacificDay, msUntilReset, BUCKETS };
