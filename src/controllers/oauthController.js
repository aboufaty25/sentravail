// Sign up / log in with Google or Apple.
// - Known provider account → logged in.
// - Verified email of an existing account → the provider is linked to it, logged in.
// - Otherwise → "Finaliser l'inscription": the person chooses candidat or recruteur (never
//   admin) and, for recruiters, the company, then the account is created.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const oauth = require('../services/oauth');
const { oauthSignupSchema, fieldErrors } = require('../validators/auth');
const { generateUsername } = require('../services/username');
const { safeReturn } = require('../utils/returnTo');

const view = { layout: 'layouts/auth', noAds: true };
const ID_FIELD = { google: 'googleId', apple: 'appleId' };

function notFound() {
  const err = new Error('Page introuvable.');
  err.status = 404;
  return err;
}

function loginWithError(req, res, message) {
  req.flash('error', message);
  return res.redirect('/connexion');
}

// Same as a password login: new session id, then back where the person was.
function startSession(req, user, target) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      return resolve(target || '/');
    });
  });
}

function start(req, res, next) {
  const name = req.params.provider;
  if (!oauth.PROVIDERS[name] || !oauth.PROVIDERS[name].enabled()) return next(notFound());
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const role = ['candidate', 'recruiter'].includes(req.query.role) ? req.query.role : '';
  oauth.setStateCookie(res, { p: name, state, nonce, retour: safeReturn(req.query.retour) || '', role });
  return res.redirect(oauth.authorizationUrl(name, { state, nonce }));
}

async function callback(req, res, next) {
  const name = req.params.provider;
  if (!oauth.PROVIDERS[name] || !oauth.PROVIDERS[name].enabled()) return next(notFound());
  const params = req.method === 'POST' ? req.body || {} : req.query;
  const saved = oauth.readStateCookie(req, res);
  if (params.error) return loginWithError(req, res, 'Connexion annulée.');
  if (!saved || saved.p !== name || typeof params.state !== 'string' || params.state !== saved.state || typeof params.code !== 'string') {
    return loginWithError(req, res, 'La connexion a expiré. Réessayez.');
  }
  let identity;
  try {
    identity = await oauth.exchange(name, params.code, saved.nonce);
  } catch (err) {
    console.warn(`[oauth:${name}] ${err.message}`);
    return loginWithError(req, res, `Connexion avec ${oauth.PROVIDERS[name].label} impossible. Réessayez.`);
  }
  // Apple sends the name only the first time, outside the token.
  if (name === 'apple' && typeof params.user === 'string') {
    try {
      const u = JSON.parse(params.user);
      identity.firstName = identity.firstName || u?.name?.firstName || '';
      identity.lastName = identity.lastName || u?.name?.lastName || '';
    } catch (_) { /* ignore */ }
  }

  const field = ID_FIELD[name];
  let user = await User.findOne({ where: { [field]: identity.sub } });
  if (!user && identity.email && identity.emailVerified) {
    user = await User.findOne({ where: { email: identity.email } });
    if (user) await user.update({ [field]: identity.sub }); // link to the existing account
  }
  if (user) {
    if (user.isBanned) return loginWithError(req, res, 'Ce compte a été suspendu. Contactez le support.');
    await user.update({ lastLoginAt: new Date() });
    const target = await startSession(req, user, saved.retour);
    return res.redirect(target);
  }
  if (!identity.email || !identity.emailVerified) {
    return loginWithError(req, res, `Votre compte ${oauth.PROVIDERS[name].label} n'a pas d'adresse email vérifiée. Inscrivez-vous avec le formulaire.`);
  }
  // New member: finish the sign-up (profile choice).
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.oauthSignup = { provider: name, sub: identity.sub, email: identity.email, firstName: identity.firstName.slice(0, 60), lastName: identity.lastName.slice(0, 60), role: saved.role, retour: saved.retour, at: Date.now() };
  return res.redirect('/inscription/finaliser');
}

function pending(req) {
  const p = req.session?.oauthSignup;
  return p && Date.now() - p.at < 30 * 60_000 ? p : null;
}

function finishForm(req, res) {
  const p = pending(req);
  if (!p) return res.redirect('/inscription');
  return res.render('pages/auth/finish', {
    ...view, title: "Finaliser l'inscription", provider: oauth.PROVIDERS[p.provider].label, email: p.email, errors: {},
    values: { firstName: p.firstName, lastName: p.lastName, role: p.role || '', companyName: '', phone: '' },
  });
}

async function finish(req, res) {
  const p = pending(req);
  if (!p) return res.redirect('/inscription');
  const render = (status, errors) => res.status(status).render('pages/auth/finish', {
    ...view, title: "Finaliser l'inscription", provider: oauth.PROVIDERS[p.provider].label, email: p.email, values: req.body || {}, errors,
  });
  const parsed = oauthSignupSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (req.body?.role === 'recruiter' && String(req.body.companyName || '').trim().length < 2) errors.companyName = errors.companyName || 'Indiquez le nom de votre entreprise.';
    return render(422, errors);
  }
  const d = parsed.data;
  if (d.phone && (await User.findOne({ where: { phone: d.phone }, attributes: ['id'] }))) return render(422, { phone: 'Un compte existe déjà avec ce numéro.' });
  // The email may have been used to sign up in the meantime: link instead of failing.
  const existing = await User.findOne({ where: { email: p.email } });
  if (existing) {
    await existing.update({ [ID_FIELD[p.provider]]: p.sub, lastLoginAt: new Date() });
    const target = await startSession(req, existing, p.retour);
    return res.redirect(target);
  }
  const user = await User.create({
    username: await generateUsername(d.firstName, d.lastName),
    firstName: d.firstName,
    lastName: d.lastName,
    email: p.email,
    phone: d.phone,
    // No password: login with Google/Apple ("Mot de passe oublié" can set one later).
    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
    role: d.role,
    companyName: d.role === 'recruiter' ? d.companyName : null,
    [ID_FIELD[p.provider]]: p.sub,
    lastLoginAt: new Date(),
  });
  const target = await startSession(req, user, p.retour);
  req.flash('success', `Bienvenue sur SenTravail, ${user.firstName} !`);
  return res.redirect(target);
}

module.exports = { start, callback, finishForm, finish };
