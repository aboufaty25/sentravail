const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User } = require('../models');
const env = require('../config/env');
const { registerSchema, loginSchema, forgotSchema, resetSchema, fieldErrors, accountNames } = require('../validators/auth');
const { generateUsername } = require('../services/username');
const { sendPasswordReset } = require('../services/mail');
const { isEmailLike, normalizePhone } = require('../utils/text');
const { safeReturn } = require('../utils/returnTo');
const { queueEvent } = require('../utils/analytics');

const BCRYPT_ROUNDS = env.isTest ? 4 : 12;
const RESET_TTL_MS = 60 * 60 * 1000;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
// Compared against when the account does not exist, so both paths take the same time.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', BCRYPT_ROUNDS);

// Prevents session fixation: new session id on every login.
// Where to go after login/registration: the validated ?retour= target, else home.
function startSession(req, user) {
  const target = safeReturn(req.body?.retour) || safeReturn(req.session.returnTo) || '/';
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      return resolve(target);
    });
  });
}

const view = { layout: 'layouts/auth', noAds: true };

function showRegister(req, res) {
  res.render('pages/auth/register', {
    ...view, title: 'Créer un compte', errors: {},
    values: { role: req.query.role || 'candidate', email: typeof req.query.email === 'string' ? req.query.email.slice(0, 190) : '', retour: safeReturn(req.query.retour) || '' },
  });
}

async function register(req, res) {
  const values = { ...req.body, password: '', passwordConfirm: '' };
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    // Object-level refinements are skipped when a field fails: report this one anyway.
    if (req.body.role === 'recruiter' && String(req.body.companyName || '').trim().length < 2) {
      errors.companyName = errors.companyName || "Indiquez le nom de votre entreprise.";
    }
    if (req.body.role !== 'recruiter') {
      if (String(req.body.firstName || '').trim().length < 2) errors.firstName = errors.firstName || 'Prénom : 2 caractères minimum.';
      if (String(req.body.lastName || '').trim().length < 2) errors.lastName = errors.lastName || 'Nom : 2 caractères minimum.';
    }
    return res.status(422).render('pages/auth/register', { ...view, title: 'Créer un compte', values, errors });
  }
  const data = parsed.data;

  const errors = {};
  if (await User.findOne({ where: { email: data.email }, attributes: ['id'] })) {
    errors.email = 'Un compte existe déjà avec cet email.';
  }
  if (data.phone && (await User.findOne({ where: { phone: data.phone }, attributes: ['id'] }))) {
    errors.phone = 'Un compte existe déjà avec ce numéro.';
  }
  if (Object.keys(errors).length) {
    return res.status(422).render('pages/auth/register', { ...view, title: 'Créer un compte', values, errors });
  }

  const names = accountNames(data);
  const user = await User.create({
    username: await generateUsername(names.firstName, names.lastName),
    ...names,
    email: data.email,
    phone: data.phone,
    passwordHash: await bcrypt.hash(data.password, BCRYPT_ROUNDS),
    role: data.role,
    companyName: data.role === 'recruiter' ? data.companyName : null,
    lastLoginAt: new Date(),
  });

  const target = await startSession(req, user);
  queueEvent(req, 'sign_up', { method: 'email', role: user.role });
  req.flash('success', `Bienvenue sur SenTravail, ${user.firstName} !`);
  return res.redirect(target);
}

function showLogin(req, res) {
  res.render('pages/auth/login', { ...view, title: 'Connexion', values: { retour: safeReturn(req.query.retour) || '' }, errors: {} });
}

async function login(req, res) {
  const values = { identifier: req.body.identifier || '', retour: safeReturn(req.body.retour) || '' };
  const parsed = loginSchema.safeParse(req.body);
  const render = (status, errors) => res.status(status).render('pages/auth/login', { ...view, title: 'Connexion', values, errors });
  if (!parsed.success) return render(422, fieldErrors(parsed.error));

  const { identifier, password } = parsed.data;
  let where;
  if (isEmailLike(identifier)) where = { email: identifier.toLowerCase() };
  else {
    const phone = normalizePhone(identifier);
    where = phone ? { phone } : null;
  }

  const user = where ? await User.findOne({ where }) : null;
  // Same message and same work whether the account exists or not.
  const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !valid) {
    return render(401, { _form: 'Identifiants incorrects.' });
  }
  if (user.isBanned) return render(403, { _form: 'Ce compte a été suspendu. Contactez le support.' });

  await user.update({ lastLoginAt: new Date() });
  const target = await startSession(req, user);
  queueEvent(req, 'login', { method: 'email' });
  return res.redirect(target);
}

function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('st.sid');
    return res.redirect('/connexion');
  });
}

function showForgot(req, res) {
  res.render('pages/auth/forgot', { ...view, title: 'Mot de passe oublié', values: {}, errors: {}, sent: false });
}

async function forgot(req, res) {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).render('pages/auth/forgot', { ...view, title: 'Mot de passe oublié', values: req.body, errors: fieldErrors(parsed.error), sent: false });
  }
  const user = await User.findOne({ where: { email: parsed.data.email } });
  if (user && !user.isBanned) {
    const token = crypto.randomBytes(32).toString('hex');
    await user.update({ resetTokenHash: hashToken(token), resetTokenExpires: new Date(Date.now() + RESET_TTL_MS) });
    await sendPasswordReset(user, `${env.APP_URL}/reinitialiser/${token}`);
  }
  // Never reveal whether the email is registered.
  return res.render('pages/auth/forgot', { ...view, title: 'Mot de passe oublié', values: {}, errors: {}, sent: true });
}

async function findByResetToken(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return User.findOne({ where: { resetTokenHash: hashToken(token), resetTokenExpires: { [Op.gt]: new Date() } } });
}

async function showReset(req, res) {
  const user = await findByResetToken(req.params.token);
  res.status(user ? 200 : 400).render('pages/auth/reset', { ...view, title: 'Nouveau mot de passe', token: req.params.token, valid: !!user, errors: {} });
}

async function reset(req, res) {
  const user = await findByResetToken(req.params.token);
  const render = (status, errors) =>
    res.status(status).render('pages/auth/reset', { ...view, title: 'Nouveau mot de passe', token: req.params.token, valid: !!user, errors });
  if (!user) return render(400, {});
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return render(422, fieldErrors(parsed.error));

  await user.update({
    passwordHash: await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS),
    resetTokenHash: null,
    resetTokenExpires: null,
  });
  req.flash('success', 'Mot de passe modifié. Vous pouvez vous connecter.');
  return res.redirect('/connexion');
}

module.exports = { showRegister, register, showLogin, login, logout, showForgot, forgot, showReset, reset, BCRYPT_ROUNDS };
