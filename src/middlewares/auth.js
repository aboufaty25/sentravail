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

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.get('HX-Request')) {
    res.set('HX-Redirect', '/connexion');
    return res.status(401).end();
  }
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.flash('info', 'Connectez-vous pour continuer.');
  return res.redirect('/connexion');
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/');
  return next();
}

module.exports = { loadUser, requireAuth, requireGuest };
