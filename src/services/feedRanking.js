const { QueryTypes } = require('sequelize');
const { sequelize, Post } = require('../models');

const WEIGHTS = { likes: 1, comments: 3, shares: 5, saves: 2, views: 0.05 };
const GRAVITY = 1.5;
const FOLLOW_BONUS = 1.5;
const MATCH_BONUS = 1.3;

function engagement(post) {
  return (
    (post.likesCount || 0) * WEIGHTS.likes +
    (post.commentsCount || 0) * WEIGHTS.comments +
    (post.sharesCount || 0) * WEIGHTS.shares +
    (post.savesCount || 0) * WEIGHTS.saves +
    (post.viewsCount || 0) * WEIGHTS.views
  );
}

// score = (engagement + 1) / (hours since publication + 2)^1.5
function baseScore(post, now = new Date()) {
  const hours = Math.max(0, (now.getTime() - new Date(post.createdAt).getTime()) / 3_600_000);
  return (engagement(post) + 1) / (hours + 2) ** GRAVITY;
}

// Reader-specific multipliers applied on top of the stored score.
function personalize(score, post, viewer, { followedIds = new Set() } = {}) {
  let s = score;
  if (viewer && followedIds.has(post.authorId)) s *= FOLLOW_BONUS;
  const job = post.job;
  if (viewer && job && ((viewer.city && job.location === viewer.city) || (viewer.sector && job.sector === viewer.sector))) {
    s *= MATCH_BONUS;
  } else if (viewer && viewer.city && post.city && ['job_search', 'event'].includes(post.type) && post.city === viewer.city) {
    s *= MATCH_BONUS;
  }
  return s;
}

// Recomputes one post's stored score (called after every interaction).
async function refreshScore(postId) {
  const post = await Post.findByPk(postId, {
    attributes: ['id', 'likesCount', 'commentsCount', 'sharesCount', 'savesCount', 'viewsCount', 'createdAt'],
  });
  if (!post) return null;
  const score = baseScore(post);
  await Post.update({ score }, { where: { id: postId }, silent: true });
  return score;
}

// Bulk recompute for recent posts (scheduled every 15 minutes). Same formula, in SQL.
async function refreshRecentScores(days = 30) {
  const [, meta] = await sequelize.query(
    `UPDATE posts SET score =
       (likesCount * :likes + commentsCount * :comments + sharesCount * :shares + savesCount * :saves + viewsCount * :views + 1)
       / POW(GREATEST(TIMESTAMPDIFF(SECOND, createdAt, UTC_TIMESTAMP()), 0) / 3600 + 2, :gravity)
     WHERE createdAt > UTC_TIMESTAMP() - INTERVAL :days DAY`,
    { replacements: { ...WEIGHTS, gravity: GRAVITY, days }, type: QueryTypes.UPDATE }
  );
  return meta;
}

module.exports = { WEIGHTS, engagement, baseScore, personalize, refreshScore, refreshRecentScores, FOLLOW_BONUS, MATCH_BONUS };
