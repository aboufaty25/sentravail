// "Continuer avec Google / Apple" (OpenID Connect, authorization code flow).
// The ID token is received directly from the provider's token endpoint over TLS (OIDC Core
// 3.1.3.7), then its issuer, audience, expiry and nonce are checked.
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
    token: 'https://appleid.apple.com/auth/token',
    issuers: ['https://appleid.apple.com'],
    clientId: () => env.APPLE_CLIENT_ID,
    enabled: () => diagnose('apple') === null,
    scope: 'name email',
    extra: { response_mode: 'form_post' }, // Apple POSTs the code back
    clientSecret: () => appleClientSecret(),
  },
};

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// The .p8 key may come with real newlines or "\n", quotes, Windows line endings, or squashed on
// one line with spaces (some hosting panels), even without the BEGIN/END lines: rebuilt as PEM.
function applePrivateKey() {
  const raw = env.APPLE_PRIVATE_KEY.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');
  const body = raw.replace(/-----(BEGIN|END)[A-Z ]*-----/g, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) return raw;
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

// Why a provider is not available (shown in the startup log; never the values themselves).
function diagnose(name) {
  const vars = name === 'google'
    ? { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET }
    : { APPLE_CLIENT_ID: env.APPLE_CLIENT_ID, APPLE_TEAM_ID: env.APPLE_TEAM_ID, APPLE_KEY_ID: env.APPLE_KEY_ID, APPLE_PRIVATE_KEY: env.APPLE_PRIVATE_KEY };
  const missing = Object.keys(vars).filter((k) => !String(vars[k] || '').trim());
  if (missing.length === Object.keys(vars).length) return 'not configured';
  if (missing.length) return `missing ${missing.join(', ')}`;
  if (name === 'apple') {
    try {
      const key = crypto.createPrivateKey(applePrivateKey());
      if (key.asymmetricKeyType !== 'ec') return 'APPLE_PRIVATE_KEY is not an EC key (.p8 file expected)';
    } catch (_) {
      return 'APPLE_PRIVATE_KEY cannot be read: paste the whole .p8 file, including the BEGIN/END lines';
    }
  }
  return null;
}

// Apple's client secret is a short-lived JWT signed (ES256) with the .p8 key.
function appleClientSecret(now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: env.APPLE_KEY_ID }));
  const payload = b64url(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: env.APPLE_CLIENT_ID }));
  const key = applePrivateKey();
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(signature)}`;
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
  const c = decodeJwtPayload(json.id_token);
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
    ? 'Apple refuse les identifiants : vérifiez APPLE_TEAM_ID (Team ID), APPLE_KEY_ID (Key ID de la clé .p8), APPLE_CLIENT_ID (le Services ID, pas l\'App ID) et que la clé .p8 a « Sign in with Apple » activé pour ce même App ID.'
    : 'Google refuse les identifiants : vérifiez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET.'),
  invalid_grant: () => 'Code refusé : la Return URL / URI de redirection déclarée doit être exactement celle indiquée ci-dessous, et l\'heure du serveur doit être juste.',
  state: () => 'Le cookie de connexion a été perdu au retour : ouvrez le site à l\'adresse exacte de APP_URL (avec ou sans www, en https).',
  token: () => 'Le jeton reçu ne correspond pas à la configuration (audience ou émetteur) : vérifiez l\'identifiant client.',
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

module.exports = { recordFailure, clearFailure, status, applePrivateKey, diagnose, PROVIDERS, enabledProviders, authorizationUrl, exchange, appleClientSecret, decodeJwtPayload, setStateCookie, readStateCookie, redirectUri };
