const crypto = require('crypto');
const { Op, literal } = require('sequelize');
const { Post, Job, User } = require('../models');
const env = require('../config/env');
const { slugify } = require('../utils/text');
const posts = require('./posts');
const { todayUtc } = require('../validators/job');

const SEARCH_PAGE_SIZE = 10;

// "/offres/comptable-dakar-k3x9q2"
function buildSlug(title, location) {
  const base = slugify(`${title} ${location}`).slice(0, 100) || 'offre';
  return `${base}-${crypto.randomBytes(4).toString('hex').slice(0, 6)}`;
}

function featuredUntilDate(from = new Date()) {
  return new Date(from.getTime() + env.FEATURED_DAYS * 86_400_000);
}

const activeJobWhere = () => ({ [Op.or]: [{ deadline: null }, { deadline: { [Op.gte]: todayUtc() } }] });

const featuredPostWhere = () => ({
  type: 'job',
  status: 'published',
  isFeatured: true,
  featuredUntil: { [Op.gt]: new Date() },
});

// Featured job posts pinned on top of the feed (visible to everyone).
async function featuredJobs(viewer, limit = 5) {
  const list = await Post.findAll({
    where: featuredPostWhere(),
    include: [
      ...posts.postInclude(),
      // Featured jobs whose deadline passed are no longer pinned.
    ],
    order: [['featuredUntil', 'DESC'], ['id', 'DESC']],
    limit: limit * 2,
  });
  const visible = list.filter((p) => !p.author.isBanned && p.job && !p.job.isExpired).slice(0, limit);
  return posts.hydrate(visible, viewer);
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function search({ q, ville, secteur, contrat, page }, viewer) {
  const jobWhere = { ...activeJobWhere() };
  if (ville) jobWhere.location = ville;
  if (secteur) jobWhere.sector = secteur;
  if (contrat) jobWhere.contractType = contrat;
  if (q) {
    const like = `%${escapeLike(q)}%`;
    jobWhere[Op.and] = [{ [Op.or]: [{ title: { [Op.like]: like } }, { companyName: { [Op.like]: like } }, { description: { [Op.like]: like } }] }];
  }
  const { rows, count } = await Post.findAndCountAll({
    where: { type: 'job', status: 'published' },
    include: [
      { model: Job, as: 'job', where: jobWhere, required: true },
      { model: User, as: 'author', attributes: posts.AUTHOR_ATTRS, where: { isBanned: false }, required: true },
    ],
    // Pinned offers first — admin offers and offers "À la une" together, newest first — then the others.
    order: [[literal("CASE WHEN `author`.`role` = 'admin' OR (`Post`.`isFeatured` = 1 AND `Post`.`featuredUntil` > NOW()) THEN 0 ELSE 1 END"), 'ASC'], ['createdAt', 'DESC'], ['id', 'DESC']],
    limit: SEARCH_PAGE_SIZE,
    offset: (page - 1) * SEARCH_PAGE_SIZE,
    distinct: true,
  });
  return { posts: await posts.hydrate(rows, viewer), total: count, hasMore: page * SEARCH_PAGE_SIZE < count };
}

// Offers close to this one (same sector or city), most relevant first.
async function similar(post, limit = 6) {
  const j = post.job;
  const rows = await Post.findAll({
    where: { type: 'job', status: 'published', id: { [Op.ne]: post.id } },
    include: [
      { model: Job, as: 'job', where: { ...activeJobWhere(), [Op.or]: [{ sector: j.sector }, { location: j.location }] }, required: true },
      { model: User, as: 'author', attributes: posts.AUTHOR_ATTRS, where: { isBanned: false }, required: true },
    ],
    order: [['isFeatured', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']],
    limit: 30,
  });
  const rank = (p) => (p.job.sector === j.sector ? 2 : 0) + (p.job.location === j.location ? 1 : 0);
  return rows.sort((a, b) => rank(b) - rank(a)).slice(0, limit);
}

async function findBySlug(slug) {
  if (!/^[a-z0-9-]{3,120}$/.test(slug)) return null;
  const job = await Job.findOne({ where: { slug } });
  if (!job) return null;
  return Post.findByPk(job.postId, { include: posts.postInclude() });
}

function canManage(post, viewer) {
  return !!viewer && (viewer.id === post.authorId || viewer.role === 'admin');
}

module.exports = { similar, buildSlug, featuredUntilDate, featuredJobs, featuredPostWhere, search, findBySlug, canManage, activeJobWhere, SEARCH_PAGE_SIZE };
