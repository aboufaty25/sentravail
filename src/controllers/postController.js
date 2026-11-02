const { UniqueConstraintError } = require('sequelize');
const { Post, Reaction, Save, User } = require('../models');
const { postSchema, shareSchema } = require('../validators/post');
const { fieldErrors } = require('../validators/auth');
const { saveImage } = require('../services/storage');
const { refreshScore, baseScore } = require('../services/feedRanking');
const posts = require('../services/posts');
const env = require('../config/env');
const { isFollowing, followingAmong } = require('../services/follows');
const { adjustCounter } = require('../utils/counters');
const { toggleReaction } = require('../services/reactions');
const { notify } = require('../services/notifications');
const { absoluteUrl, imageUrl } = require('../utils/viewHelpers');
const { removeLocalMedia } = require('../services/storage');

function notFound() {
  const err = new Error("Cette publication n'existe pas ou n'est plus disponible.");
  err.status = 404;
  return err;
}

function wantsJson(req) {
  return req.xhr || req.get('accept')?.includes('application/json');
}

// ---------- Feed ----------

function parseSince(value) {
  const t = Number(value);
  return Number.isFinite(t) && t > 0 && t <= Date.now() + 60_000 ? new Date(t) : new Date();
}

async function feed(req, res) {
  const page = Math.max(1, Math.min(200, Number.parseInt(req.query.page, 10) || 1));
  const since = parseSince(req.query.since);
  const { posts: list, hasMore } = await posts.feedPage({ viewer: req.user, page, since });
  res.render('partials/feedItems', { layout: false, posts: list, hasMore, page, since: since.getTime(), startIndex: (page - 1) * env.FEED_PAGE_SIZE });
}

// ---------- Create / show / delete ----------

function newForm(req, res) {
  res.render('pages/posts/new', { title: 'Créer une publication', noAds: true, type: req.query.type || 'text', errors: {}, values: {} });
}

async function create(req, res) {
  const parsed = postSchema.safeParse(req.body || {});
  const files = req.files || [];
  const errors = parsed.success ? {} : fieldErrors(parsed.error);
  if (parsed.success && !parsed.data.text && !files.length) errors.text = 'Écrivez quelque chose ou ajoutez une photo.';
  if (Object.keys(errors).length) {
    if (wantsJson(req)) return res.status(422).json({ errors });
    return res.status(422).render('pages/posts/new', { title: 'Créer une publication', noAds: true, type: 'text', errors, values: req.body || {} });
  }

  const mediaUrls = [];
  for (const file of files) mediaUrls.push(await saveImage(file.buffer, 'posts'));

  const now = new Date();
  const post = await Post.create({
    authorId: req.user.id,
    type: mediaUrls.length ? 'photo' : 'text',
    text: parsed.data.text || null,
    mediaUrls,
    visibility: parsed.data.visibility,
    status: 'published',
    score: baseScore({ createdAt: now }),
  });

  req.flash('success', 'Publication partagée.');
  // The author sees their fresh post pinned on top of the feed (like Facebook).
  const redirect = `/?nouveau=${post.id}`;
  if (wantsJson(req)) return res.status(201).json({ id: post.id, redirect });
  return res.redirect(redirect);
}

async function show(req, res, next) {
  const post = await posts.findVisiblePost(req.params.id, req.user);
  if (!post) return next(notFound());
  if (!req.user || req.user.id !== post.authorId) {
    await adjustCounter(Post, post.id, 'viewsCount', 1);
    await refreshScore(post.id);
  }
  await posts.hydrate([post], req.user);
  const excerpt = (post.text || post.sharedPost?.text || '').replace(/\s+/g, ' ').slice(0, 160);
  return res.render('pages/posts/show', {
    title: `${post.author.firstName} ${post.author.lastName}${excerpt ? ` : « ${excerpt.slice(0, 60)}… »` : ''}`,
    metaDescription: excerpt || `Publication de ${post.author.firstName} ${post.author.lastName} sur SenTravail.`,
    post,
    ogType: 'article',
    canonical: `${env.APP_URL}/publications/${post.id}`,
    ...(() => {
      const img = post.mediaUrls?.[0] || post.sharedPost?.mediaUrls?.[0];
      return img ? { ogImage: absoluteUrl(imageUrl(img, 1200)) } : {};
    })(),
  });
}

async function destroy(req, res, next) {
  const post = await Post.findByPk(req.params.id);
  if (!post) return next(notFound());
  // Server-side ownership check: author or admin only.
  if (!posts.canDelete(post, req.user)) {
    const err = new Error("Vous ne pouvez pas supprimer cette publication.");
    err.status = 403;
    return next(err);
  }
  if (post.sharedPostId) {
    await adjustCounter(Post, post.sharedPostId, 'sharesCount', -1);
    await refreshScore(post.sharedPostId);
  }
  await post.destroy();
  // Images stored on our disk are removed too.
  await removeLocalMedia(post.mediaUrls || []);
  if (req.get('HX-Request')) {
    res.set('HX-Trigger', JSON.stringify({ toast: { message: 'Publication supprimée.' } }));
    if (req.get('HX-Current-URL')?.includes(`/publications/${post.id}`)) res.set('HX-Redirect', '/');
    return res.send('');
  }
  req.flash('success', 'Publication supprimée.');
  return res.redirect('/');
}

// ---------- Social actions (htmx: each returns the refreshed social block) ----------

async function renderSocial(req, res, postId) {
  const post = await Post.findByPk(postId, { include: posts.postInclude() });
  await posts.hydrate([post], req.user);
  return res.render('partials/postSocial', { layout: false, post, oob: false });
}

async function loadInteractable(req) {
  const post = await posts.findVisiblePost(req.params.id, req.user);
  if (!post || post.status !== 'published') throw notFound();
  return post;
}

async function react(req, res) {
  const post = await loadInteractable(req);
  const type = Reaction.TYPES.includes(req.body?.type) ? req.body.type : 'like';
  await toggleReaction(post, req.user, type);
  return renderSocial(req, res, post.id);
}

async function toggleSave(req, res) {
  const post = await loadInteractable(req);
  const existing = await Save.findOne({ where: { userId: req.user.id, postId: post.id } });
  let message;
  if (existing) {
    await existing.destroy();
    await adjustCounter(Post, post.id, 'savesCount', -1);
    message = 'Retiré de vos enregistrements.';
  } else {
    try {
      await Save.create({ userId: req.user.id, postId: post.id });
      await adjustCounter(Post, post.id, 'savesCount', 1);
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
    }
    message = 'Enregistré. Retrouvez-le dans « Enregistrements ».';
  }
  await refreshScore(post.id);
  res.set('HX-Trigger', JSON.stringify({ toast: { message } }));
  return renderSocial(req, res, post.id);
}

async function share(req, res) {
  let original = await loadInteractable(req);
  // Sharing a share re-shares the original post.
  if (original.sharedPostId) {
    original = await posts.findVisiblePost(original.sharedPostId, req.user);
    if (!original) throw notFound();
  }
  // "Mon réseau" posts stay within the author's network.
  if (original.visibility === 'network') {
    const err = new Error("Cette publication est réservée au réseau de son auteur et ne peut pas être partagée.");
    err.status = 403;
    throw err;
  }
  const parsed = shareSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({ errors: fieldErrors(parsed.error) });

  const post = await Post.create({
    authorId: req.user.id,
    type: 'text',
    text: parsed.data.text || null,
    visibility: parsed.data.visibility,
    sharedPostId: original.id,
    score: baseScore({ createdAt: new Date() }),
  });
  await adjustCounter(Post, original.id, 'sharesCount', 1);
  await refreshScore(original.id);
  await notify({ userId: original.authorId, actorId: req.user.id, type: 'share', postId: original.id, data: { snippet: original.text || original.job?.title || '' } });
  return res.status(201).json({ id: post.id, message: 'Publication partagée dans votre fil.' });
}

// ---------- Lists ----------

async function savedList(req, res) {
  const saves = await Save.findAll({
    where: { userId: req.user.id },
    include: [{ model: Post, as: 'post', include: posts.postInclude() }],
    order: [['createdAt', 'DESC']],
    limit: 50,
  });
  const saved = saves.map((s) => s.post).filter(Boolean);
  const follows = await followingAmong(req.user.id, saved.map((p) => p.authorId));
  const list = await posts.hydrate(saved.filter((p) => posts.canView(p, req.user, { follows: follows.has(p.authorId) })), req.user);
  res.render('pages/posts/saved', { title: 'Enregistrements', posts: list });
}

async function byAuthor(user, viewer, limit = 20, type = null) {
  const follows = await isFollowing(viewer?.id, user.id);
  const list = await Post.findAll({
    where: { ...posts.authorPostsWhere(user.id, viewer, follows), ...(type ? { type } : {}) },
    include: posts.postInclude(),
    order: [['createdAt', 'DESC']],
    limit,
  });
  return posts.hydrate(list, viewer);
}

module.exports = { loadInteractable, feed, newForm, create, show, destroy, react, toggleSave, share, savedList, byAuthor, notFound };
