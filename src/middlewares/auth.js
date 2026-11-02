const { User } = require('../models');

// Loads the logged-in user (if any) into req.user / res.locals.currentUser.
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  const userId = req.session.userId;
  if (!userId) return next();

  const user = await User.findByPk(userId);
  if (!user || user.isBanned) {
    delete req.session.userId;
    return next();
  }
  req.user = user;
  res.locals.currentUser = user;
  return next();
}

// Guests: htmx/fetch actions open the "Connectez-vous pour continuer" window; pages redirect
// to the login form, which brings the visitor back afterwards (?retour=…).
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.get('HX-Request')) {
    res.set('HX-Trigger', JSON.stringify({ 'require-login': {} }));
    return res.status(401).end();
  }
  if (req.accepts(['html', 'json']) === 'json') return res.status(401).json({ error: 'Connectez-vous pour continuer.', requireLogin: true });
  const back = req.method === 'GET' ? req.originalUrl : (req.get('Referer') || '').replace(/^https?:\/\/[^/]+/, '');
  return res.redirect(`/connexion?retour=${encodeURIComponent(back || '/')}`);
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/');
  return next();
}

module.exports = { loadUser, requireAuth, requireGuest };
