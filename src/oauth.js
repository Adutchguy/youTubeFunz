'use strict';
/**
 * Minimal OAuth 2.0 (authorization code + PKCE) for a local web app.
 * Tokens live in .data/tokens.json (git-ignored) and never reach the browser.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const TOKEN_FILE = path.join(config.dataDir, 'tokens.json');

const pending = new Map(); // state -> { verifier, createdAt }
const PENDING_TTL_MS = 10 * 60 * 1000;

let tokens = null;
try {
  tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
} catch {
  tokens = null;
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function persist() {
  try {
    if (tokens) fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    else if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch {
    /* best-effort */
  }
}

function configured() {
  return Boolean(config.oauth.clientId && config.oauth.clientSecret);
}

function buildAuthUrl(scopes) {
  for (const [k, v] of pending) if (Date.now() - v.createdAt > PENDING_TTL_MS) pending.delete(k);
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  pending.set(state, { verifier, createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: config.oauth.clientId,
    redirect_uri: config.oauth.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      ...body,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token endpoint returned ${res.status}`);
  }
  return data;
}

async function handleCallback(query) {
  if (query.error) throw new Error(`Google returned: ${query.error}`);
  const entry = pending.get(query.state);
  if (!entry) throw new Error('Unknown or expired login attempt (state mismatch). Try connecting again.');
  pending.delete(query.state);
  if (!query.code) throw new Error('No authorization code in the callback.');
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code: query.code,
    redirect_uri: config.oauth.redirectUri,
    code_verifier: entry.verifier,
  });
  tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || (tokens && tokens.refresh_token) || null,
    scope: data.scope || '',
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    obtained_at: Date.now(),
  };
  persist();
}

async function getAccessToken() {
  if (!tokens) return null;
  if (tokens.expires_at - Date.now() > 60 * 1000) return tokens.access_token;
  if (!tokens.refresh_token) return null;
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  tokens.access_token = data.access_token;
  tokens.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
  if (data.scope) tokens.scope = data.scope;
  persist();
  return tokens.access_token;
}

async function logout() {
  const t = tokens && (tokens.refresh_token || tokens.access_token);
  tokens = null;
  persist();
  if (t) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(t)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      /* revoking is best-effort; the local tokens are already gone */
    }
  }
}

function status() {
  return {
    configured: configured(),
    redirectUri: config.oauth.redirectUri,
    connected: Boolean(tokens),
    scopes: tokens && tokens.scope ? tokens.scope.split(' ').filter(Boolean) : [],
    expiresAt: tokens ? tokens.expires_at : null,
    canRefresh: Boolean(tokens && tokens.refresh_token),
  };
}

module.exports = { configured, buildAuthUrl, handleCallback, getAccessToken, logout, status };
