const rateLimit = require('express-rate-limit');
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
        res.set('HX-Trigger', JSON.stringify({ toast: { message, type: 'error' } }));
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
