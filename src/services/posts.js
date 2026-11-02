const { Op, fn, col } = require('sequelize');
const { Post, User, Reaction, Save, Job } = require('../models');
const { followedIds, followingAmong, isFollowing } = require('./follows');
const { personalize } = require('./feedRanking');
const env = require('../config/env');
const { REACTIONS } = require('../config/constants');
const { FEED_TYPES } = require('../config/postTypes');

const AUTHOR_ATTRS = ['id', 'username', 'firstName', 'lastName', 'role', 'avatarUrl', 'headline', 'companyName', 'isVerified', 'isBanned'];

// Always build a fresh include tree: Sequelize mutates include definitions.
function postInclude() {
  return [
    { model: User, as: 'author', attributes: AUTHOR_ATTRS },
    { model: Job, as: 'job' },
    {
      model: Post,
      as: 'sharedPost',
      include: [
        { model: User, as: 'author', attributes: AUTHOR_ATTRS },
        { model: Job, as: 'job' },
      ],
    },
  ];
}


// Who may open a post. `follows` = the viewer follows the author.
// "network" posts are for the author's followers only; public posts (including
// non-approved recruiter offers) can be opened by anyone with the link.
function canView(post, viewer, { follows = false } = {}) {
  if (!post || !post.author || post.author.isBanned) return false;
  if (viewer?.role === 'admin') return true;
  if (!FEED_TYPES.includes(post.type)) return false; // legacy free posts are hidden
  if (viewer && viewer.id === post.authorId) return true;
  if (post.status !== 'published') return false;
  if (post.visibility === 'network') return follows;
  return true;
}

async function canViewAsync(post, viewer) {
  const follows = post?.visibility === 'network' && viewer ? await isFollowing(viewer.id, post.authorId) : false;
  return canView(post, viewer, { follows });
}

function canDelete(post, viewer) {
  return !!viewer && (viewer.id === post.authorId || viewer.role === 'admin');
}

// Posts that may reach everyone's feed: public, and — for recruiter offers — approved
// by the admin or gone viral (score above VIRAL_THRESHOLD).
function broadcastWhere() {
  return {
    status: 'published',
    visibility: 'public',
    type: { [Op.in]: FEED_TYPES },
    [Op.or]: [{ type: { [Op.ne]: 'job' } }, { featureStatus: 'approved' }, { score: { [Op.gte]: env.VIRAL_THRESHOLD } }],
  };
}

// Feed distribution for a viewer (followed = Set of followed author ids).
function feedWhere(viewer, followed = new Set()) {
  if (!viewer) return broadcastWhere();
  if (viewer.role === 'admin') return { type: { [Op.in]: FEED_TYPES }, [Op.or]: [{ status: 'published' }, { authorId: viewer.id }] };
  const or = [{ authorId: viewer.id }, broadcastWhere()];
  if (followed.size) or.push({ status: 'published', authorId: { [Op.in]: [...followed] } });
  return { type: { [Op.in]: FEED_TYPES }, [Op.or]: or };
}

// Posts of one author as seen by a viewer (profile page).
function authorPostsWhere(authorId, viewer, follows) {
  if (viewer && (viewer.id === authorId || viewer.role === 'admin')) return { authorId, type: { [Op.in]: FEED_TYPES } };
  return { authorId, type: { [Op.in]: FEED_TYPES }, status: 'published', ...(follows ? {} : { visibility: 'public' }) };
}

// Kept for callers that only need the published/own rule.
function visibleWhere(viewer) {
  const or = [{ status: 'published', visibility: 'public' }];
  if (viewer) or.push({ authorId: viewer.id });
  return { type: { [Op.in]: FEED_TYPES }, [Op.or]: or };
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
  const authorIds = [...new Set(list.flatMap((p) => [p.authorId, p.sharedPost?.authorId]).filter(Boolean))];
  const follows = await followingAmong(viewer?.id, authorIds);
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
      followsAuthor: follows.has(p.authorId),
      canFollow: !!viewer && viewer.id !== p.authorId && !follows.has(p.authorId),
    };
  };
  for (const p of list) {
    decorate(p);
    if (p.sharedPost) {
      const o = p.sharedPost;
      if (!canView(o, viewer, { follows: follows.has(o.authorId) })) p.sharedPost = null;
      else decorate(o);
    }
  }
  return list;
}

// One page of the home feed. Candidates are read by stored score, then re-ranked for
// the viewer (followed author ×1.5, job matching city/sector ×1.3). `since` freezes the
// set of posts while scrolling so new posts don't shift pages.
const RERANK_WINDOW = 30;

async function feedPage({ viewer, page = 1, since = new Date() }) {
  const limit = env.FEED_PAGE_SIZE;
  const followed = await followedIds(viewer?.id);
  const window = Math.min(page * limit + RERANK_WINDOW, 600);
  const rows = await Post.findAll({
    where: {
      [Op.and]: [
        feedWhere(viewer, followed),
        { createdAt: { [Op.lte]: since } },
        // Featured jobs are pinned separately on top of the first page.
        { [Op.not]: { type: 'job', isFeatured: true, featuredUntil: { [Op.gt]: new Date() } } },
      ],
    },
    include: postInclude(),
    order: [['score', 'DESC'], ['id', 'DESC']],
    limit: window,
  });
  const ranked = rows
    .filter((p) => !p.author.isBanned)
    .map((p) => ({ p, s: personalize(p.score, p, viewer, { followedIds: followed }) }))
    .sort((a, b) => b.s - a.s || b.p.id - a.p.id)
    .map((x) => x.p);
  const pageItems = ranked.slice((page - 1) * limit, page * limit);
  const hasMore = ranked.length > page * limit || rows.length === window;
  return { posts: await hydrate(pageItems, viewer), hasMore };
}

async function findVisiblePost(id, viewer) {
  if (!/^\d+$/.test(String(id))) return null;
  const post = await Post.findByPk(id, { include: postInclude() });
  return (await canViewAsync(post, viewer)) ? post : null;
}

// Short label of a publication for notifications and emails.
function snippet(post) {
  return post?.title || post?.job?.title || post?.text || '';
}

module.exports = { snippet, REACTIONS, postInclude, AUTHOR_ATTRS, canView, canViewAsync, canDelete, visibleWhere, feedWhere, broadcastWhere, authorPostsWhere, hydrate, feedPage, findVisiblePost };
