const rateLimit = require('express-rate-limit');
const { hxTrigger } = require('../utils/hx');
const env = require('../config/env');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Trop de tentatives. Réessayez dans quelques minutes.',
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.isTest ? 10000 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

module.exports = { authLimiter, globalLimiter };

// Per-user limits for content creation (keyed by account, not IP: many users share mobile carrier IPs).
function userLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit: env.isTest ? 10000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `u${req.user.id}`,
    handler: (req, res) => {
      if (req.get('HX-Request')) {
        hxTrigger(res, { toast: { message, type: 'error' } });
        return res.status(429).send('');
      }
      return res.status(429).json({ error: message });
    },
  });
}

const postLimiter = userLimiter({ windowMs: 60 * 60 * 1000, limit: 30, message: 'Vous publiez trop vite. Réessayez dans un moment.' });
const commentLimiter = userLimiter({ windowMs: 10 * 60 * 1000, limit: 60, message: 'Vous commentez trop vite. Réessayez dans un moment.' });
const actionLimiter = userLimiter({ windowMs: 60 * 1000, limit: 120, message: 'Trop d’actions. Patientez quelques secondes.' });

module.exports.postLimiter = postLimiter;
module.exports.commentLimiter = commentLimiter;
module.exports.actionLimiter = actionLimiter;

// Applications are open to guests: per IP for visitors (stricter), per account for members.
const { ipKeyGenerator } = rateLimit;
const applyKey = (req) => (req.user ? `u${req.user.id}` : `ip${ipKeyGenerator(req.ip)}`);
const applyMessage = { error: 'Trop de candidatures envoyées depuis cette connexion. Réessayez plus tard.' };
const applyHourly = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: (req) => (env.isTest ? 10000 : req.user ? 15 : 6),
  keyGenerator: applyKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: applyMessage,
});
const applyDaily = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: (req) => (env.isTest ? 10000 : req.user ? 60 : 20),
  keyGenerator: applyKey,
  standardHeaders: false,
  legacyHeaders: false,
  message: applyMessage,
});
const applyLimiter = [applyHourly, applyDaily];
const serverMailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.isTest ? 10000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: "Trop d'envois par SenTravail. Utilisez votre messagerie ou réessayez plus tard." },
});

module.exports.applyLimiter = applyLimiter;
module.exports.serverMailLimiter = serverMailLimiter;

// CV builder is open to guests: limit PDF generation and photo uploads per IP.
module.exports.cvBuildLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.isTest ? 10000 : 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans une heure.' },
});

// Live CV preview: one PDF per pause while typing (debounced in the browser).
module.exports.cvPreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.isTest ? 10000 : 90,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.session?.userId ? `u${req.session.userId}` : ipKeyGenerator(req.ip)),
  message: { error: "Trop d'aperçus en peu de temps. Patientez quelques secondes." },
});
