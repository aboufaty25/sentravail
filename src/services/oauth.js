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
    enabled: () => !!(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY),
    scope: 'name email',
    extra: { response_mode: 'form_post' }, // Apple POSTs the code back
    clientSecret: () => appleClientSecret(),
  },
};

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Apple's client secret is a short-lived JWT signed (ES256) with the .p8 key.
function appleClientSecret(now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: env.APPLE_KEY_ID }));
  const payload = b64url(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: env.APPLE_CLIENT_ID }));
  const key = env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
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
  if (!res.ok || !json.id_token) throw new Error(`token endpoint refused (${res.status})`);
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

module.exports = { PROVIDERS, enabledProviders, authorizationUrl, exchange, appleClientSecret, decodeJwtPayload, setStateCookie, readStateCookie, redirectUri };
