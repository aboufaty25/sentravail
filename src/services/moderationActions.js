const { sequelize, Post, Comment, User, Job } = require('../models');
const notifications = require('./notifications');
const { refreshScore } = require('./feedRanking');
const { adjustCounter } = require('../utils/counters');
const { snippet } = require('./posts');
const indexing = require('./googleIndexing');

// Admin decision on a held publication.
async function approvePost(post, admin) {
  await post.update({ status: 'published', moderationReason: null, moderationNote: null });
  // Appears as fresh in the feed from the moment it is approved.
  await sequelize.query('UPDATE posts SET createdAt = UTC_TIMESTAMP() WHERE id = ?', { replacements: [post.id] });
  await refreshScore(post.id);
  await notifications.notify({ userId: post.authorId, actorId: admin.id, type: 'post_approved', postId: post.id, data: { snippet: snippet(post) } });
  if (post.type === 'job') {
    const [author, job] = await Promise.all([User.findByPk(post.authorId), Job.findOne({ where: { postId: post.id } })]);
    if (author && job) await notifications.notifyFollowersOfJob(author, post, job);
    if (job) indexing.notifyJob(job);
  }
}

async function rejectPost(post, admin, reason) {
  await post.update({ status: 'rejected', moderationNote: reason ? reason.slice(0, 300) : null });
  if (post.type === 'job') indexing.notifyPost(post.id, 'URL_DELETED');
  await notifications.notify({ userId: post.authorId, actorId: admin.id, type: 'post_rejected', postId: post.id, data: { snippet: snippet(post), reason } });
}

async function approveComment(comment) {
  await comment.update({ status: 'published', moderationReason: null, moderationNote: null });
  await adjustCounter(Post, comment.postId, 'commentsCount', 1);
  await refreshScore(comment.postId);
}

async function rejectComment(comment) {
  await comment.destroy();
}

module.exports = { approvePost, rejectPost, approveComment, rejectComment };
