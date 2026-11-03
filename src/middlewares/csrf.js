const crypto = require('crypto');
const env = require('../config/env');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const COOKIE = 'st_csrf';
const TOKEN_RE = /^[a-f0-9]{48}$/;

const newToken = () => crypto.randomBytes(24).toString('hex');

function readCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * CSRF protection.
 * - Visitors with a session (logged in, applying…): synchronizer token stored in the session.
 * - Anonymous visitors: "double submit" token in a dedicated cookie, so that browsing the
 *   site (and search-engine crawling) never creates a database session.
 * The token comes back as the `_csrf` field, the `X-CSRF-Token` header (htmx/fetch) or,
 * for multipart forms only, the `_csrf` query parameter.
 */
function csrfProtection(req, res, next) {
  let expected = req.session?.csrfToken;
  if (!expected && req.session?.userId) {
    expected = newToken();
    req.session.csrfToken = expected;
  }
  if (!expected) {
    expected = readCookie(req, COOKIE);
    if (!expected || !TOKEN_RE.test(expected)) {
      expected = newToken();
      res.cookie(COOKIE, expected, { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/' });
    }
  }
  res.locals.csrfToken = expected;

  if (SAFE_METHODS.has(req.method)) return next();
  // Apple posts the sign-in result from appleid.apple.com: protected by the signed state instead.
  if (req.path === '/auth/apple/callback') return next();

  const multipartToken = req.is('multipart/form-data') ? req.query._csrf : undefined;
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || multipartToken;
  if (typeof sent === 'string' && sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return next();
  }
  const err = new Error('Jeton de sécurité invalide. Rechargez la page et réessayez.');
  err.status = 403;
  return next(err);
}

module.exports = { csrfProtection };
