const { UniqueConstraintError } = require('sequelize');
const { Post, Reaction } = require('../models');
const { adjustCounter } = require('../utils/counters');
const { refreshScore } = require('./feedRanking');
const { notify } = require('./notifications');

// Same type again = remove; other type = change; none = add. One reaction per user and post.
async function toggleReaction(post, user, type) {
  const existing = await Reaction.findOne({ where: { userId: user.id, postId: post.id } });
  if (existing && existing.type === type) {
    await existing.destroy();
    await adjustCounter(Post, post.id, 'likesCount', -1);
  } else if (existing) {
    await existing.update({ type });
  } else {
    try {
      await Reaction.create({ userId: user.id, postId: post.id, type });
      await adjustCounter(Post, post.id, 'likesCount', 1);
      await notify({ userId: post.authorId, actorId: user.id, type: 'like', postId: post.id, data: { snippet: require('./posts').snippet(post) } });
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err; // double tap: already counted
    }
  }
  await refreshScore(post.id);
}

module.exports = { toggleReaction };
