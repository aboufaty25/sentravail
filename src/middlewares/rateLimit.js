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
