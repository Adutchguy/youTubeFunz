'use strict';
/**
 * Configuration: reads .env (tiny parser, no dependencies) and exposes settings.
 * Real environment variables win over .env values.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv(path.join(ROOT, '.env'));

const env = process.env;
const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const trimSlash = (s) => s.replace(/\/+$/, '');

const port = int(env.PORT, 3000);

const config = {
  root: ROOT,
  publicDir: path.join(ROOT, 'public'),
  dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(ROOT, '.data'),
  port,
  apiKey: (env.YOUTUBE_API_KEY || '').trim(),
  oauth: {
    clientId: (env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
    redirectUri: (env.OAUTH_REDIRECT_URI || `http://localhost:${port}/auth/callback`).trim(),
  },
  readOnly: /^(1|true|yes|on)$/i.test(env.READ_ONLY || ''),
  bases: {
    data: trimSlash(env.YT_DATA_BASE || 'https://www.googleapis.com/youtube/v3'),
    analytics: trimSlash(env.YT_ANALYTICS_BASE || 'https://youtubeanalytics.googleapis.com/v2'),
  },
  limits: {
    general: int(env.QUOTA_GENERAL, 10000),
    search: int(env.QUOTA_SEARCH, 100),
    upload: int(env.QUOTA_UPLOAD, 100),
    batchStats: int(env.QUOTA_BATCH_STATS, 10000),
  },
};

fs.mkdirSync(config.dataDir, { recursive: true });

module.exports = config;
