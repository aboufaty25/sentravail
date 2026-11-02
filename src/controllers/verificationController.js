const crypto = require('crypto');
const { z } = require('zod');
const { User } = require('../models');
const env = require('../config/env');
const { isFreeEmailDomain, normalizeNinea, normalizeRccm } = require('../services/verification');
const { sendEmail } = require('../services/notifications');

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const view = (res, locals) => res.render('pages/verification', { title: 'Badge vérifié', noAds: true, ...locals });

function show(req, res) {
  view(res, { values: { method: req.user.verificationMethod || 'ninea' }, errors: {} });
}

async function request(req, res) {
  const u = req.user;
  if (u.role !== 'recruiter') {
    const err = new Error('Le badge vérifié se demande depuis un compte recruteur.');
    err.status = 403;
    throw err;
  }
  if (u.isVerified) return res.redirect('/parametres/verification');
  const method = z.enum(['ninea', 'rccm', 'email']).catch('ninea').parse(req.body?.method);
  const raw = String(req.body?.value || '').trim();
  let value = null;
  let error = null;
  if (method === 'ninea') {
    value = normalizeNinea(raw);
    if (!value) error = 'NINEA invalide : 7 à 9 chiffres, éventuellement suivis du code COFI (ex. 004562312 2V2).';
  } else if (method === 'rccm') {
    value = normalizeRccm(raw);
    if (!value) error = 'RCCM invalide (ex. SN-DKR-2020-B-12345).';
  } else {
    const email = z.string().email().safeParse(raw.toLowerCase());
    if (!email.success) error = 'Adresse email invalide.';
    else if (isFreeEmailDomain(email.data)) error = 'Utilisez l’adresse email de votre entreprise (Gmail, Yahoo, Hotmail… ne sont pas acceptés).';
    else value = email.data;
  }
  if (error) return res.status(422).render('pages/verification', { title: 'Badge vérifié', noAds: true, values: { method, value: raw }, errors: { value: error } });

  const changes = {
    verificationStatus: 'pending', verificationMethod: method, verificationValue: value, verificationNote: null,
    verificationEmailConfirmed: false, verificationTokenHash: null, verificationRequestedAt: new Date(),
  };
  if (method === 'email') {
    // Proof that the recruiter owns the address: a confirmation link sent to it.
    const token = crypto.randomBytes(32).toString('hex');
    changes.verificationTokenHash = hashToken(token);
    await u.update(changes);
    await sendEmail({
      to: value,
      subject: 'Confirmez votre adresse professionnelle — SenTravail',
      title: 'Confirmez votre adresse professionnelle',
      lines: [`Bonjour ${u.firstName},`, `Vous avez demandé le badge vérifié SenTravail pour ${u.companyName || 'votre entreprise'}. Confirmez que cette adresse vous appartient :`],
      cta: { label: 'Confirmer mon adresse', url: `${env.APP_URL}/verification/confirmer/${token}` },
    });
    req.flash('success', `Un lien de confirmation a été envoyé à ${value}. Cliquez dessus, puis notre équipe validera votre badge.`);
  } else {
    await u.update(changes);
    req.flash('success', 'Demande envoyée. Notre équipe vérifie votre numéro et vous répond rapidement.');
  }
  return res.redirect('/parametres/verification');
}

async function confirmEmail(req, res) {
  const token = String(req.params.token || '');
  const user = /^[a-f0-9]{64}$/.test(token) ? await User.findOne({ where: { verificationTokenHash: hashToken(token), verificationStatus: 'pending' } }) : null;
  if (!user) {
    req.flash('error', 'Ce lien de confirmation est invalide ou a déjà été utilisé.');
    return res.redirect('/');
  }
  await user.update({ verificationEmailConfirmed: true, verificationTokenHash: null });
  req.flash('success', 'Adresse professionnelle confirmée. Notre équipe va valider votre badge.');
  return res.redirect(req.user ? '/parametres/verification' : '/connexion');
}

module.exports = { show, request, confirmEmail };
