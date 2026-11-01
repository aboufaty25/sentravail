const fs = require('fs/promises');
const { Op } = require('sequelize');
const { Post } = require('../models');
const env = require('../config/env');
const posts = require('../services/posts');
const { followedIds } = require('../services/follows');
const { saveReelVideo, removeLocalMedia, MAX_REEL_SECONDS } = require('../services/video');
const { saveImage } = require('../services/storage');
const { baseScore, refreshScore } = require('../services/feedRanking');
const { adjustCounter } = require('../utils/counters');
const { toggleReaction } = require('../services/reactions');
const { postSchema } = require('../validators/post');
const { fieldErrors } = require('../validators/auth');
const { loadInteractable } = require('./postController');

const PAGE = 5;

function newForm(req, res) {
  res.render('pages/reels/new', { title: 'Publier un réel', noAds: true, maxSeconds: MAX_REEL_SECONDS });
}

async function cleanupTemp(files) {
  for (const f of Object.values(files || {}).flat()) {
    if (f.path) await fs.unlink(f.path).catch(() => {});
  }
}

async function create(req, res) {
  const video = req.files?.video?.[0];
  const thumb = req.files?.thumbnail?.[0];
  try {
    const parsed = postSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(422).json({ errors: fieldErrors(parsed.error), error: parsed.error.issues[0].message });
    if (!video) return res.status(422).json({ error: 'Choisissez une vidéo.' });

    const saved = await saveReelVideo(video.path); // validates container + duration, then moves the file
    let thumbnailUrl = null;
    if (thumb) {
      try {
        thumbnailUrl = await saveImage(await fs.readFile(thumb.path), 'reel-thumbs');
      } catch (_) {
        thumbnailUrl = null; // the video is still usable without a poster
      }
    }
    const now = new Date();
    const post = await Post.create({
      authorId: req.user.id,
      type: 'reel',
      text: parsed.data.text || null,
      videoUrl: saved.url,
      thumbnailUrl,
      visibility: parsed.data.visibility,
      score: baseScore({ createdAt: now }),
    }).catch(async (err) => {
      await removeLocalMedia([saved.url, thumbnailUrl]);
      throw err;
    });
    req.flash('success', 'Votre réel est publié.');
    return res.status(201).json({ id: post.id, redirect: `/reels?r=${post.id}` });
  } finally {
    await cleanupTemp(req.files);
  }
}

// Reels visible to the viewer, ordered by score (same distribution rules as the feed).
async function reelsPage(viewer, { page = 1, firstId = null, excludeId = null } = {}) {
  const followed = await followedIds(viewer?.id);
  const where = { [Op.and]: [posts.feedWhere(viewer, followed), { type: 'reel' }] };
  if (excludeId) where[Op.and].push({ id: { [Op.ne]: excludeId } });
  const rows = await Post.findAll({
    where,
    include: posts.postInclude(),
    order: [['score', 'DESC'], ['id', 'DESC']],
    limit: PAGE + 1,
    offset: (page - 1) * PAGE,
  });
  let list = rows.filter((p) => !p.author.isBanned);
  const hasMore = rows.length > PAGE;
  list = list.slice(0, PAGE);
  if (firstId) {
    const first = await posts.findVisiblePost(firstId, viewer);
    if (first && first.type === 'reel') list = [first, ...list.filter((p) => p.id !== first.id)];
  }
  return { reels: await posts.hydrate(list, viewer), hasMore };
}

async function index(req, res) {
  const firstId = /^\d+$/.test(String(req.query.r || '')) ? Number(req.query.r) : null;
  const { reels, hasMore } = await reelsPage(req.user, { firstId, excludeId: firstId });
  res.render('pages/reels/index', {
    title: 'Réels',
    layout: 'layouts/reels',
    noAds: true,
    reels,
    hasMore,
    page: 1,
    firstId,
  });
}

async function more(req, res) {
  const page = Math.max(2, Math.min(100, Number.parseInt(req.query.page, 10) || 2));
  const excludeId = /^\d+$/.test(String(req.query.sauf || '')) ? Number(req.query.sauf) : null;
  const { reels, hasMore } = await reelsPage(req.user, { page, excludeId });
  res.render('partials/reelSlides', { layout: false, reels, hasMore, page, firstId: excludeId });
}

// Like button on the reel side bar (simple like toggle, like the Facebook reels UI).
async function like(req, res) {
  const post = await loadInteractable(req);
  if (post.type !== 'reel') {
    const err = new Error('Réel introuvable.');
    err.status = 404;
    throw err;
  }
  const current = (await posts.hydrate([post], req.user))[0].meta.myReaction;
  await toggleReaction(post, req.user, current || 'like');
  const fresh = await Post.findByPk(post.id, { include: posts.postInclude() });
  await posts.hydrate([fresh], req.user);
  return res.render('partials/reelLike', { layout: false, reel: fresh });
}

// Counted once per browser session after 2 s of viewing (sent by the viewer script).
async function view(req, res) {
  const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : null;
  const seen = req.session.seenReels || [];
  if (id && !seen.includes(id)) {
    const post = await posts.findVisiblePost(id, req.user);
    if (post && post.type === 'reel' && post.authorId !== req.user?.id) {
      await adjustCounter(Post, id, 'viewsCount', 1);
      await refreshScore(id);
    }
    req.session.seenReels = [...seen, id].slice(-300);
  }
  return res.status(204).end();
}

module.exports = { newForm, create, index, more, like, view, reelsPage };
