const { Op, UniqueConstraintError } = require('sequelize');
const { User, Follow } = require('../models');
const { adjustCounter } = require('../utils/counters');

const CARD_ATTRS = ['id', 'username', 'firstName', 'lastName', 'role', 'avatarUrl', 'headline', 'companyName', 'city', 'sector', 'isVerified', 'followersCount'];

// IDs of the accounts `userId` follows.
async function followedIds(userId) {
  if (!userId) return new Set();
  const rows = await Follow.findAll({ where: { followerId: userId }, attributes: ['followingId'], raw: true });
  return new Set(rows.map((r) => r.followingId));
}

async function isFollowing(followerId, followingId) {
  if (!followerId || !followingId) return false;
  return !!(await Follow.findOne({ where: { followerId, followingId }, attributes: ['id'] }));
}

// Subset of `ids` followed by `userId` (one query).
async function followingAmong(userId, ids) {
  if (!userId || !ids.length) return new Set();
  const rows = await Follow.findAll({ where: { followerId: userId, followingId: ids }, attributes: ['followingId'], raw: true });
  return new Set(rows.map((r) => r.followingId));
}

async function follow(follower, targetId) {
  if (follower.id === targetId) {
    const err = new Error('Vous ne pouvez pas vous abonner à vous-même.');
    err.status = 422;
    throw err;
  }
  const target = await User.findByPk(targetId, { attributes: ['id', 'isBanned'] });
  if (!target || target.isBanned) {
    const err = new Error('Ce compte est introuvable.');
    err.status = 404;
    throw err;
  }
  try {
    await Follow.create({ followerId: follower.id, followingId: targetId });
  } catch (err) {
    if (err instanceof UniqueConstraintError) return false; // already following (double tap)
    throw err;
  }
  await adjustCounter(User, follower.id, 'followingCount', 1);
  await adjustCounter(User, targetId, 'followersCount', 1);
  await require('./notifications').notify({ userId: targetId, actorId: follower.id, type: 'follow' });
  return true;
}

async function unfollow(follower, targetId) {
  const removed = await Follow.destroy({ where: { followerId: follower.id, followingId: targetId } });
  if (removed) {
    await adjustCounter(User, follower.id, 'followingCount', -1);
    await adjustCounter(User, targetId, 'followersCount', -1);
  }
  return removed > 0;
}

// Suggestions: same city, same sector, then popular accounts. Each comes with a reason.
async function suggestions(viewer, limit = 12) {
  const exclude = [...(await followedIds(viewer.id)), viewer.id];
  const base = { id: { [Op.notIn]: exclude }, isBanned: false };
  const pick = (where, n) => User.findAll({ where: { ...base, ...where }, attributes: CARD_ATTRS, order: [['followersCount', 'DESC'], ['id', 'DESC']], limit: n });

  const [byCity, bySector, popular] = await Promise.all([
    viewer.city ? pick({ city: viewer.city }, limit) : [],
    viewer.sector ? pick({ sector: viewer.sector }, limit) : [],
    pick({}, limit),
  ]);
  const seen = new Set();
  const out = [];
  const add = (list, reason) => {
    for (const u of list) {
      if (out.length >= limit || seen.has(u.id)) continue;
      seen.add(u.id);
      u.reason = reason(u);
      out.push(u);
    }
  };
  // Interleave so the list mixes reasons.
  add(byCity.slice(0, Math.ceil(limit / 3)), (u) => `Habite aussi à ${u.city}`);
  add(bySector.slice(0, Math.ceil(limit / 3)), (u) => `Secteur : ${u.sector}`);
  add(byCity, (u) => `Habite aussi à ${u.city}`);
  add(bySector, (u) => `Secteur : ${u.sector}`);
  add(popular, (u) => (u.followersCount ? `${u.followersCount} abonné${u.followersCount > 1 ? 's' : ''}` : u.role === 'recruiter' ? 'Recruteur sur SenTravail' : 'Nouveau sur SenTravail'));
  return out;
}

async function listFollowers(userId, viewer, limit = 100) {
  const rows = await Follow.findAll({
    where: { followingId: userId },
    include: [{ model: User, as: 'follower', attributes: CARD_ATTRS, where: { isBanned: false } }],
    order: [['createdAt', 'DESC']],
    limit,
  });
  return withFollowState(rows.map((r) => r.follower), viewer);
}

async function listFollowing(userId, viewer, limit = 100) {
  const rows = await Follow.findAll({
    where: { followerId: userId },
    include: [{ model: User, as: 'following', attributes: CARD_ATTRS, where: { isBanned: false } }],
    order: [['createdAt', 'DESC']],
    limit,
  });
  return withFollowState(rows.map((r) => r.following), viewer);
}

// Marks which users the viewer already follows (for the button state).
async function withFollowState(users, viewer) {
  const followed = await followingAmong(viewer?.id, users.map((u) => u.id));
  for (const u of users) u.followedByViewer = followed.has(u.id);
  return users;
}

module.exports = { CARD_ATTRS, followedIds, isFollowing, followingAmong, follow, unfollow, suggestions, listFollowers, listFollowing, withFollowState };
