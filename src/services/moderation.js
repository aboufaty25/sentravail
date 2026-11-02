const { Op } = require('sequelize');
const { BannedTerm, Post } = require('../models');

// ---------- Anti-scam filter ----------

// "Dépôt  d'ARGENT!" -> "depot d argent"
function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Active terms, cached in memory and refreshed when the admin edits the list.
let cache = null;
async function terms() {
  if (!cache) {
    const rows = await BannedTerm.findAll({ where: { active: true }, attributes: ['term'], raw: true });
    cache = rows.map((r) => ({ term: r.term, norm: normalize(r.term) })).filter((t) => t.norm);
  }
  return cache;
}
function invalidateTerms() {
  cache = null;
}

// Returns the banned terms found in any of the texts (whole words / phrases only).
async function findBannedTerms(...texts) {
  const haystack = ` ${normalize(texts.flat().filter(Boolean).join(' \n '))} `;
  const found = [];
  for (const t of await terms()) if (haystack.includes(` ${t.norm} `)) found.push(t.term);
  return found;
}

// ---------- External links ----------

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/i;
const DOMAIN_RE = /\b[a-z0-9][a-z0-9-]{0,62}\.(?:com|net|org|sn|fr|io|co|info|biz|me|ly|gl|app|site|online|xyz|link|tk|ml|ga|cf|top|click|shop|store|africa)\b(?:\/\S*)?/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

// Links (not email addresses) in any of the texts.
function hasExternalLink(...texts) {
  const text = texts.flat().filter(Boolean).join(' ').replace(EMAIL_RE, ' ');
  return URL_RE.test(text) || DOMAIN_RE.test(text);
}

function canPostLinks(user) {
  return !!user && (user.isVerified || user.role === 'admin');
}

/**
 * Publication status decided server-side. Every account publishes directly, new ones
 * included; only banned terms send a publication to moderation (admins excepted).
 */
async function decidePublication(user, texts) {
  const found = user.role === 'admin' ? [] : await findBannedTerms(texts);
  if (found.length) return { status: 'pending_approval', moderationReason: 'filter', moderationNote: `Termes détectés : ${found.join(', ')}`.slice(0, 300) };
  return { status: 'published', moderationReason: null, moderationNote: null };
}

async function decideComment(user, text) {
  const found = user.role === 'admin' ? [] : await findBannedTerms(text);
  if (found.length) return { status: 'pending_approval', moderationReason: 'filter', moderationNote: `Termes détectés : ${found.join(', ')}`.slice(0, 300) };
  return { status: 'published', moderationReason: null, moderationNote: null };
}

// ---------- Limits ----------

// "Je cherche un emploi": one per calendar day (UTC, Senegal time) and per user.
async function jobSearchPostedToday(userId) {
  const start = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return (await Post.count({ where: { authorId: userId, type: 'job_search', createdAt: { [Op.gte]: start } } })) > 0;
}

const MESSAGES = {
  link: 'Les liens externes sont réservés aux comptes vérifiés. Retirez le lien de votre texte.',
  pendingFilter: 'Votre publication contient des termes souvent utilisés dans les arnaques. Elle sera vérifiée par notre équipe avant d’être visible.',
  commentFilter: 'Votre commentaire contient des termes souvent utilisés dans les arnaques. Il sera vérifié avant d’être visible.',
  jobSearchDaily: 'Vous avez déjà publié une recherche d’emploi aujourd’hui. Vous pourrez en publier une autre demain.',
};

module.exports = {
  normalize, findBannedTerms, invalidateTerms, hasExternalLink, canPostLinks,
  decidePublication, decideComment, jobSearchPostedToday, MESSAGES,
};
