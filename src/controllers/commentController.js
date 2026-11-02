const { UniqueConstraintError } = require('sequelize');
const { hxTrigger } = require('../utils/hx');
const { Post, Comment, CommentLike, User } = require('../models');
const { commentSchema } = require('../validators/post');
const posts = require('../services/posts');
const { refreshScore } = require('../services/feedRanking');
const { adjustCounter } = require('../utils/counters');
const { notFound } = require('./postController');
const { notify } = require('../services/notifications');
const moderation = require('../services/moderation');
const { Op } = require('sequelize');

// Fresh object each time: Sequelize mutates include definitions.
const author = () => ({ model: User, as: 'author', attributes: posts.AUTHOR_ATTRS });

// Published comments, plus the viewer's own pending ones (admins see everything).
function visibleCommentWhere(viewer) {
  if (viewer?.role === 'admin') return {};
  return { [Op.or]: [{ status: 'published' }, ...(viewer ? [{ authorId: viewer.id }] : [])] };
}

async function loadThread(postId, viewer) {
  const comments = await Comment.findAll({
    where: { postId, parentCommentId: null, ...visibleCommentWhere(viewer) },
    include: [author(), { model: Comment, as: 'replies', include: [author()] }],
    order: [['createdAt', 'ASC'], ['id', 'ASC'], [{ model: Comment, as: 'replies' }, 'createdAt', 'ASC'], [{ model: Comment, as: 'replies' }, 'id', 'ASC']],
    limit: 100,
  });
  const visible = comments.filter((c) => !c.author.isBanned);
  const allIds = visible.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]);
  let liked = new Set();
  if (viewer && allIds.length) {
    const likes = await CommentLike.findAll({ where: { userId: viewer.id, commentId: allIds }, attributes: ['commentId'], raw: true });
    liked = new Set(likes.map((l) => l.commentId));
  }
  const showReply = (r) => !r.author.isBanned && (r.status === 'published' || viewer?.role === 'admin' || r.authorId === viewer?.id);
  for (const c of visible) {
    c.replies = c.replies.filter(showReply);
  }
  return { comments: visible, liked };
}

function canDeleteComment(comment, post, viewer) {
  return !!viewer && (viewer.id === comment.authorId || viewer.id === post.authorId || viewer.role === 'admin');
}

async function list(req, res, next) {
  const post = await posts.findVisiblePost(req.params.id, req.user);
  if (!post) return next(notFound());
  const { comments, liked } = await loadThread(post.id, req.user);
  return res.render('partials/commentList', { layout: false, post, comments, liked, canDeleteComment });
}

async function socialOob(req, postId) {
  const post = await Post.findByPk(postId, { include: posts.postInclude() });
  await posts.hydrate([post], req.user);
  return post;
}

async function create(req, res, next) {
  const post = await posts.findVisiblePost(req.params.id, req.user);
  if (!post || post.status !== 'published') return next(notFound());
  const parsed = commentSchema.safeParse(req.body || {});
  if (!parsed.success) {
    hxTrigger(res, { toast: { message: parsed.error.issues[0].message, type: 'error' } });
    return res.status(422).send('');
  }

  // Replies are one level deep (like Facebook): replying to a reply attaches to its parent.
  let parentId = null;
  if (parsed.data.parentCommentId) {
    const parent = await Comment.findOne({ where: { id: parsed.data.parentCommentId, postId: post.id } });
    if (!parent) return next(notFound());
    parentId = parent.parentCommentId || parent.id;
  }

  if (!moderation.canPostLinks(req.user) && moderation.hasExternalLink(parsed.data.text)) {
    hxTrigger(res, { toast: { message: moderation.MESSAGES.link, type: 'error' } });
    return res.status(422).send('');
  }
  const decision = await moderation.decideComment(req.user, parsed.data.text);
  const comment = await Comment.create({ postId: post.id, authorId: req.user.id, text: parsed.data.text, parentCommentId: parentId, ...decision });
  comment.author = req.user;
  comment.replies = [];
  if (decision.status !== 'published') {
    // Visible to its author only until an admin approves it: no count, no notification.
    hxTrigger(res, { toast: { message: moderation.MESSAGES.commentFilter } });
    return res.render('partials/commentCreated', { layout: false, post: await socialOob(req, post.id), comment, parentId, liked: new Set(), canDeleteComment });
  }
  await notify({ userId: post.authorId, actorId: req.user.id, type: 'comment', postId: post.id, data: { snippet: require('../services/posts').snippet(post) } });
  if (parentId) {
    const parent = await Comment.findByPk(parentId, { attributes: ['authorId'] });
    if (parent && parent.authorId !== post.authorId) {
      await notify({ userId: parent.authorId, actorId: req.user.id, type: 'reply', postId: post.id, data: { snippet: parsed.data.text } });
    }
  }
  await adjustCounter(Post, post.id, 'commentsCount', 1);
  await refreshScore(post.id);

  return res.render('partials/commentCreated', {
    layout: false,
    post: await socialOob(req, post.id),
    comment,
    parentId,
    liked: new Set(),
    canDeleteComment,
  });
}

async function destroy(req, res, next) {
  const comment = await Comment.findByPk(req.params.commentId);
  if (!comment) return next(notFound());
  const post = await Post.findByPk(comment.postId);
  if (!canDeleteComment(comment, post, req.user)) {
    const err = new Error('Vous ne pouvez pas supprimer ce commentaire.');
    err.status = 403;
    return next(err);
  }
  const repliesCount = await Comment.count({ where: { parentCommentId: comment.id, status: 'published' } });
  await comment.destroy(); // replies cascade
  await adjustCounter(Post, post.id, 'commentsCount', -((comment.status === 'published' ? 1 : 0) + repliesCount));
  await refreshScore(post.id);
  return res.render('partials/postSocial', { layout: false, post: await socialOob(req, post.id), oob: true });
}

async function toggleLike(req, res, next) {
  const comment = await Comment.findByPk(req.params.commentId);
  if (!comment) return next(notFound());
  const post = await posts.findVisiblePost(comment.postId, req.user);
  if (!post) return next(notFound());

  const existing = await CommentLike.findOne({ where: { userId: req.user.id, commentId: comment.id } });
  let liked;
  if (existing) {
    await existing.destroy();
    await adjustCounter(Comment, comment.id, 'likesCount', -1);
    liked = false;
  } else {
    try {
      await CommentLike.create({ userId: req.user.id, commentId: comment.id });
      await adjustCounter(Comment, comment.id, 'likesCount', 1);
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
    }
    liked = true;
  }
  await comment.reload();
  return res.render('partials/commentLike', { layout: false, comment, liked });
}

module.exports = { list, create, destroy, toggleLike, canDeleteComment };
