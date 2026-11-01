const env = require('../config/env');

function notFound(req, res, next) {
  const err = new Error("Cette page n'existe pas ou a été supprimée.");
  err.status = 404;
  next(err);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 && env.isProd ? 'Une erreur est survenue. Réessayez plus tard.' : err.message;

  res.status(status);
  if (req.get('HX-Request') || req.accepts(['html', 'json']) === 'json') {
    return res.json({ error: message });
  }
  return res.render('pages/error', { title: `Erreur ${status}`, status, message, layout: 'layouts/auth', noAds: true });
}

module.exports = { notFound, errorHandler };
