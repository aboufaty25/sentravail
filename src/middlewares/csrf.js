const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Synchronizer-token CSRF protection. The token lives in the session and must be
// sent back either as the `_csrf` form field or the `X-CSRF-Token` header (htmx).
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  // Multipart bodies are parsed later (multer), so file-upload forms send the token in
  // their action URL (?_csrf=…). Only accepted for multipart requests.
  const multipartToken = req.is('multipart/form-data') ? req.query._csrf : undefined;
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || multipartToken;
  const expected = req.session.csrfToken;
  if (
    typeof sent === 'string' &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))
  ) {
    return next();
  }
  const err = new Error('Jeton de sécurité invalide. Rechargez la page et réessayez.');
  err.status = 403;
  return next(err);
}

module.exports = { csrfProtection };
