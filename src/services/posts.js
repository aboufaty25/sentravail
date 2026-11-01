const { Op, fn, col } = require('sequelize');
const { Post, User, Reaction, Save } = require('../models');
const env = require('../config/env');
const { REACTIONS } = require('../config/constants');

const AUTHOR_ATTRS = ['id', 'username', 'firstName', 'lastName', 'role', 'avatarUrl', 'headline', 'companyName', 'isVerified', 'isBanned'];

const POST_INCLUDE = [
  { model: User, as: 'author', attributes: AUTHOR_ATTRS },
  { model: Post, as: 'sharedPost', include: [{ model: User, as: 'author', attributes: AUTHOR_ATTRS }] },
];


// Who may see a post. Network/follower rules are added in Phase 6.
function canView(post, viewer) {
  if (!post || !post.author || post.author.isBanned) return false;
  if (post.status === 'published') return true;
  return !!viewer && (viewer.id === post.authorId || viewer.role === 'admin');
}

function canDelete(post, viewer) {
  return !!viewer && (viewer.id === post.authorId || viewer.role === 'admin');
}

function visibleWhere(viewer) {
  const or = [{ status: 'published' }];
  if (viewer) or.push({ authorId: viewer.id });
  return { [Op.or]: or };
}

// Attaches per-viewer data used by the card: top reactions, my reaction, saved flag.
async function hydrate(posts, viewer) {
  const list = posts.filter(Boolean);
  const ids = [...new Set(list.flatMap((p) => [p.id, p.sharedPost?.id]).filter(Boolean))];
  if (!ids.length) return list;

  const grouped = await Reaction.findAll({
    attributes: ['postId', 'type', [fn('COUNT', col('id')), 'n']],
    where: { postId: ids },
    group: ['postId', 'type'],
    raw: true,
  });
  const top = {};
  for (const r of grouped) (top[r.postId] ||= []).push({ type: r.type, n: Number(r.n) });

  let mine = {};
  let saved = new Set();
  if (viewer) {
    const [reactions, saves] = await Promise.all([
      Reaction.findAll({ where: { userId: viewer.id, postId: ids }, attributes: ['postId', 'type'], raw: true }),
      Save.findAll({ where: { userId: viewer.id, postId: ids }, attributes: ['postId'], raw: true }),
    ]);
    mine = Object.fromEntries(reactions.map((r) => [r.postId, r.type]));
    saved = new Set(saves.map((s) => s.postId));
  }

  const decorate = (p) => {
    p.meta = {
      topReactions: (top[p.id] || []).sort((a, b) => b.n - a.n).slice(0, 3).map((r) => r.type),
      myReaction: mine[p.id] || null,
      saved: saved.has(p.id),
      canDelete: canDelete(p, viewer),
    };
  };
  for (const p of list) {
    decorate(p);
    if (p.sharedPost) {
      if (p.sharedPost.author?.isBanned || p.sharedPost.status !== 'published') p.sharedPost = null;
      else decorate(p.sharedPost);
    }
  }
  return list;
}

// One page of the home feed, ordered by score. `since` freezes the set of posts
// while scrolling so new posts don't shift pages.
async function feedPage({ viewer, page = 1, since = new Date() }) {
  const limit = env.FEED_PAGE_SIZE;
  const rows = await Post.findAll({
    where: { ...visibleWhere(viewer), createdAt: { [Op.lte]: since } },
    include: POST_INCLUDE,
    order: [['score', 'DESC'], ['id', 'DESC']],
    limit: limit + 1,
    offset: (page - 1) * limit,
  });
  const visible = rows.filter((p) => !p.author.isBanned);
  const hasMore = rows.length > limit;
  return { posts: await hydrate(visible.slice(0, limit), viewer), hasMore };
}

async function findVisiblePost(id, viewer) {
  if (!/^\d+$/.test(String(id))) return null;
  const post = await Post.findByPk(id, { include: POST_INCLUDE });
  return canView(post, viewer) ? post : null;
}

module.exports = { REACTIONS, POST_INCLUDE, AUTHOR_ATTRS, canView, canDelete, visibleWhere, hydrate, feedPage, findVisiblePost };
