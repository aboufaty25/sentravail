// "Continuer avec Google / Apple" (OpenID Connect).
// - Google: authorization code flow; the ID token comes from Google's token endpoint over TLS
//   (OIDC Core 3.1.3.7).
// - Apple: hybrid flow ("code id_token", form_post): Apple posts a signed ID token, verified with
//   Apple's public keys (RS256, https://appleid.apple.com/auth/keys). Only APPLE_CLIENT_ID (the
//   Services ID) is needed: no .p8 key, no client secret.
// In both cases issuer, audience, expiry and nonce are checked.
const crypto = require('crypto');
const env = require('../config/env');

const PROVIDERS = {
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    clientId: () => env.GOOGLE_CLIENT_ID,
    enabled: () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    scope: 'openid email profile',
    extra: { prompt: 'select_account' },
    clientSecret: () => env.GOOGLE_CLIENT_SECRET,
  },
  apple: {
    label: 'Apple',
    authorize: 'https://appleid.apple.com/auth/authorize',
    jwks: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    clientId: () => env.APPLE_CLIENT_ID,
    enabled: () => !!env.APPLE_CLIENT_ID,
    scope: 'name email',
    extra: { response_type: 'code id_token', response_mode: 'form_post' }, // Apple POSTs the ID token back
  },
};

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Why a provider is not available (shown in the startup log and the admin; never the values).
function diagnose(name) {
  if (name === 'apple') return env.APPLE_CLIENT_ID ? null : 'not configured';
  const vars = { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET };
  const missing = Object.keys(vars).filter((k) => !String(vars[k] || '').trim());
  if (missing.length === Object.keys(vars).length) return 'not configured';
  if (missing.length) return `missing ${missing.join(', ')}`;
  return null;
}

function redirectUri(name) {
  return `${env.APP_URL}/auth/${name}/callback`;
}

function enabledProviders() {
  return Object.keys(PROVIDERS).filter((n) => PROVIDERS[n].enabled());
}

function authorizationUrl(name, { state, nonce }) {
  const p = PROVIDERS[name];
  const params = new URLSearchParams({
    client_id: p.clientId(), redirect_uri: redirectUri(name), response_type: 'code', scope: p.scope, state, nonce, ...p.extra,
  });
  return `${p.authorize}?${params}`;
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || '').split('.')[1];
  if (!part) throw new Error('missing id_token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// Exchanges the code and returns the verified identity { sub, email, emailVerified, firstName, lastName }.
async function exchange(name, code, nonce) {
  const p = PROVIDERS[name];
  const res = await fetch(p.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(name), client_id: p.clientId(), client_secret: p.clientSecret() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id_token) {
    const err = new Error(`token endpoint refused (${res.status}${json.error ? ` ${json.error}` : ''})`);
    err.code = json.error || `http_${res.status}`;
    throw err;
  }
  return checkClaims(p, decodeJwtPayload(json.id_token), nonce);
}

// Apple's public keys, cached for an hour (fetched again when Apple rotates them).
let appleKeys = { at: 0, keys: [] };
async function appleKey(kid) {
  const find = () => appleKeys.keys.find((k) => k.kid === kid);
  if (!find() || Date.now() - appleKeys.at > 3600_000) {
    const res = await fetch(PROVIDERS.apple.jwks, { headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(json.keys)) {
      const err = new Error(`Apple keys unavailable (${res.status})`);
      err.code = 'apple_keys';
      throw err;
    }
    appleKeys = { at: Date.now(), keys: json.keys };
  }
  return find();
}

// Verifies the ID token Apple posted (signature with Apple's public key, then the claims).
async function verifyAppleIdToken(idToken, nonce) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw Object.assign(new Error('missing id_token'), { code: 'token' });
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (header.alg !== 'RS256') throw Object.assign(new Error('unexpected algorithm'), { code: 'token' });
  const jwk = await appleKey(header.kid);
  if (!jwk) throw Object.assign(new Error('unknown Apple key'), { code: 'token' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw Object.assign(new Error('bad signature'), { code: 'token' });
  return checkClaims(PROVIDERS.apple, decodeJwtPayload(idToken), nonce);
}

// Identity from the provider's callback parameters.
function identify(name, params, nonce) {
  return name === 'apple' ? verifyAppleIdToken(params.id_token, nonce) : exchange(name, params.code, nonce);
}

function checkClaims(p, c, nonce) {
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!p.issuers.includes(c.iss)) throw new Error('bad issuer');
  if (!aud.includes(p.clientId())) throw new Error('bad audience');
  if (!c.exp || c.exp * 1000 < Date.now() - 60_000) throw new Error('expired token');
  if (!nonce || c.nonce !== nonce) throw new Error('bad nonce');
  if (!c.sub) throw new Error('missing subject');
  return {
    sub: String(c.sub),
    email: c.email ? String(c.email).toLowerCase() : null,
    emailVerified: c.email_verified === true || c.email_verified === 'true',
    firstName: c.given_name || '',
    lastName: c.family_name || '',
  };
}

// ---- Last sign-in failure per provider, shown to the admin (/admin/google) to find a wrong
// setting. Never contains secret values. Kept in site_settings (several processes, restarts).
const HINTS = {
  invalid_client: (p) => (p === 'apple'
    ? 'Apple refuse l\'identifiant : APPLE_CLIENT_ID doit être le Services ID (ex. com.sentravail.web), pas l\'App ID.'
    : 'Google refuse les identifiants : vérifiez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET.'),
  invalid_grant: () => 'Code refusé : la Return URL / URI de redirection déclarée doit être exactement celle indiquée ci-dessous, et l\'heure du serveur doit être juste.',
  state: () => 'Le cookie de connexion a été perdu au retour : ouvrez le site à l\'adresse exacte de APP_URL (avec ou sans www, en https).',
  token: (p) => (p === 'apple'
    ? 'Le jeton d\'Apple ne correspond pas : APPLE_CLIENT_ID doit être exactement le Services ID déclaré chez Apple.'
    : 'Le jeton reçu ne correspond pas à la configuration (audience ou émetteur) : vérifiez l\'identifiant client.'),
};

async function recordFailure(name, code, detail) {
  const hint = (HINTS[code] || (() => ''))(name);
  const value = JSON.stringify({ at: new Date().toISOString(), code: String(code).slice(0, 40), detail: String(detail || '').slice(0, 200), hint });
  console.warn(`[oauth:${name}] ${code}${detail ? ` ${detail}` : ''}`);
  const { SiteSetting } = require('../models');
  await SiteSetting.upsert({ key: `oauth.lastError.${name}`, value }).catch(() => {});
}

async function lastFailures() {
  const { SiteSetting } = require('../models');
  const rows = await SiteSetting.findAll({ where: { key: Object.keys(PROVIDERS).map((n) => `oauth.lastError.${n}`) }, raw: true }).catch(() => []);
  const out = {};
  for (const r of rows) {
    try { out[r.key.split('.').pop()] = JSON.parse(r.value); } catch (_) { /* ignore */ }
  }
  return out;
}

async function clearFailure(name) {
  const { SiteSetting } = require('../models');
  await SiteSetting.destroy({ where: { key: `oauth.lastError.${name}` } }).catch(() => {});
}

// Status of each provider for the admin page (no secret values).
async function status() {
  const failures = await lastFailures();
  return Object.keys(PROVIDERS).map((name) => ({
    name, label: PROVIDERS[name].label, problem: diagnose(name), redirectUri: redirectUri(name),
    domain: new URL(env.APP_URL).hostname, failure: failures[name] || null,
  }));
}

// ---- Short-lived signed cookie holding state, nonce and where to go back (cross-site safe for Apple's POST).
const COOKIE = 'st_oauth';
const sign = (data) => crypto.createHmac('sha256', env.SESSION_SECRET).update(data).digest('base64url');

function setStateCookie(res, value) {
  const data = b64url(JSON.stringify({ ...value, exp: Date.now() + 10 * 60_000 }));
  const secure = env.APP_URL.startsWith('https://');
  res.cookie(COOKIE, `${data}.${sign(data)}`, { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', maxAge: 10 * 60_000, path: '/auth' });
}

function readStateCookie(req, res) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)st_oauth=([^;]+)/);
  res.clearCookie(COOKIE, { path: '/auth' });
  if (!m) return null;
  const [data, mac] = decodeURIComponent(m[1]).split('.');
  if (!data || !mac || mac.length !== sign(data).length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(data)))) return null;
  const value = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  return value.exp > Date.now() ? value : null;
}

module.exports = { recordFailure, clearFailure, status, diagnose, PROVIDERS, enabledProviders, authorizationUrl, exchange, identify, verifyAppleIdToken, decodeJwtPayload, setStateCookie, readStateCookie, redirectUri };
