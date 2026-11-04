const { Op, fn, col, literal } = require('sequelize');
const { z } = require('zod');
const { sequelize, User, Post, Job, Application, Report, Comment, RefItem } = require('../models');
const indexing = require('../services/googleIndexing');
const env = require('../config/env');
const posts = require('../services/posts');
const refs = require('../services/refs');
const jobsService = require('../services/jobs');
const { removeLocalMedia } = require('../services/storage');
const { adjustCounter } = require('../utils/counters');
const { refreshScore } = require('../services/feedRanking');
const { ROLE_LABELS } = require('../config/constants');
const notifications = require('../services/notifications');
const { formatDate } = require('../utils/viewHelpers');

const view = (res, tpl, locals) => res.render(`pages/admin/${tpl}`, { noAds: true, wide: true, ...locals });

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const days = (n) => new Date(Date.now() - n * 86_400_000);

// ---------- Dashboard ----------
async function dashboard(req, res) {
  const since7 = days(7);
  const [
    users, usersByRole, newUsers, bannedUsers, postsCount, jobsActive, applications, applications7,
    openReports, pendingFeature, featuredNow, signups,
  ] = await Promise.all([
    User.count(),
    User.count({ group: ['role'] }),
    User.count({ where: { createdAt: { [Op.gte]: since7 } } }),
    User.count({ where: { isBanned: true } }),
    Post.count({ where: { type: { [Op.ne]: 'job' } } }),
    Post.count({ where: { type: 'job', status: 'published' }, include: [{ model: Job, as: 'job', where: jobsService.activeJobWhere(), required: true }] }),
    Application.count({ where: { status: { [Op.ne]: 'opened_mail' } } }),
    Application.count({ where: { status: { [Op.ne]: 'opened_mail' }, createdAt: { [Op.gte]: since7 } } }),
    Report.count({ where: { status: 'open' }, distinct: true, col: 'targetId' }),
    Post.count({ where: { type: 'job', featureStatus: 'pending' } }),
    Post.count({ where: jobsService.featuredPostWhere() }),
    User.findAll({
      attributes: [[fn('DATE', col('createdAt')), 'day'], [fn('COUNT', col('id')), 'n']],
      where: { createdAt: { [Op.gte]: days(13).toISOString().slice(0, 10) } },
      group: [fn('DATE', col('createdAt'))],
      raw: true,
    }),
  ]);
  const ats = await require('../services/atsStats').platformStats();
  const byDay = Object.fromEntries(signups.map((r) => [String(r.day).slice(0, 10), Number(r.n)]));
  const chart = Array.from({ length: 14 }, (_, i) => {
    const d = days(13 - i).toISOString().slice(0, 10);
    return { day: d, n: byDay[d] || 0 };
  });
  view(res, 'dashboard', {
    title: 'Administration',
    section: 'dashboard',
    stats: {
      users, newUsers, bannedUsers, postsCount, jobsActive, applications, applications7, openReports, pendingFeature, featuredNow,
      roles: Object.fromEntries(usersByRole.map((r) => [r.role, Number(r.count)])),
    },
    chart,
    ats,
    LABELS: Application.STATUS_LABELS,
  });
}

// ---------- Featured offers ----------
const jobInclude = () => [
  { model: Job, as: 'job', required: true },
  { model: User, as: 'author', attributes: posts.AUTHOR_ATTRS },
];

async function featureQueue(req, res) {
  const [pending, featured] = await Promise.all([
    Post.findAll({ where: { type: 'job', featureStatus: 'pending', status: 'published' }, include: jobInclude(), order: [['createdAt', 'ASC']] }),
    Post.findAll({ where: jobsService.featuredPostWhere(), include: jobInclude(), order: [['featuredUntil', 'ASC']] }),
  ]);
  view(res, 'features', { title: 'Offres à la une', section: 'features', pending, featured, defaultDays: env.FEATURED_DAYS });
}

async function loadJobPost(id) {
  const post = await Post.findOne({ where: { id, type: 'job' }, include: jobInclude() });
  if (!post) throw fail(404, 'Offre introuvable.');
  return post;
}

async function approveFeature(req, res) {
  const post = await loadJobPost(req.params.id);
  const n = z.coerce.number().int().min(1).max(90).catch(env.FEATURED_DAYS).parse(req.body?.days);
  const from = post.isFeatured && post.featuredUntil > new Date() ? new Date(post.featuredUntil) : new Date();
  await post.update({ isFeatured: true, featuredUntil: new Date(from.getTime() + n * 86_400_000), featureStatus: 'approved', featureRejectReason: null });
  if (post.authorId !== req.user.id) {
    const until = formatDate(post.featuredUntil);
    await notifications.notify({
      userId: post.authorId, actorId: req.user.id, type: 'job_approved', postId: post.id,
      data: { jobTitle: post.job.title, until, url: post.job.url },
      email: (r) => ({
        subject: `Votre offre « ${post.job.title} » est à la une`,
        title: 'Votre offre est à la une 🎉',
        lines: [`Bonjour ${r.firstName},`, `Votre offre « ${post.job.title} » est épinglée en haut du fil de tous les utilisateurs de SenTravail jusqu'au ${until}.`],
        cta: { label: "Voir l'offre", url: `${env.APP_URL}${post.job.url}` },
      }),
    });
  }
  req.flash('success', `« ${post.job.title} » est à la une pour ${n} jour${n > 1 ? 's' : ''}.`);
  return res.redirect('/admin/offres');
}

async function rejectFeature(req, res) {
  const post = await loadJobPost(req.params.id);
  const reason = z.string().trim().min(3, 'Indiquez le motif du refus.').max(300).safeParse(req.body?.reason || '');
  if (!reason.success) {
    req.flash('error', reason.error.issues[0].message);
    return res.redirect('/admin/offres');
  }
  await post.update({ featureStatus: 'rejected', featureRejectReason: reason.data, isFeatured: false, featuredUntil: null });
  await notifications.notify({
    userId: post.authorId, actorId: req.user.id, type: 'job_rejected', postId: post.id,
    data: { jobTitle: post.job.title, reason: reason.data, url: post.job.url },
    email: (r) => ({
      subject: `Mise à la une de « ${post.job.title} »`,
      title: 'Mise à la une non retenue',
      lines: [`Bonjour ${r.firstName},`, `Votre demande de mise à la une pour « ${post.job.title} » n'a pas été retenue.`, `Motif : ${reason.data}`, 'Votre offre reste visible par vos abonnés et dans la recherche.'],
      cta: { label: "Voir l'offre", url: `${env.APP_URL}${post.job.url}` },
    }),
  });
  req.flash('success', `Mise à la une refusée pour « ${post.job.title} ».`);
  return res.redirect('/admin/offres');
}

async function unfeature(req, res) {
  const post = await loadJobPost(req.params.id);
  await post.update({ isFeatured: false, featuredUntil: null });
  req.flash('success', `« ${post.job.title} » n'est plus à la une.`);
  return res.redirect('/admin/offres');
}

// ---------- Reports ----------
async function reportsIndex(req, res) {
  const status = ['open', 'resolved', 'dismissed'].includes(req.query.statut) ? req.query.statut : 'open';
  const rows = await Report.findAll({
    where: { status },
    include: [
      { model: User, as: 'reporter', attributes: ['id', 'username', 'firstName', 'lastName'] },
      { model: User, as: 'targetOwner', attributes: ['id', 'username', 'firstName', 'lastName', 'isBanned', 'role'] },
    ],
    order: [['createdAt', 'DESC']],
    limit: 500,
  });
  // One entry per reported target, with all its reports.
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.targetType}:${r.targetId}`;
    if (!groups.has(key)) groups.set(key, { type: r.targetType, id: r.targetId, owner: r.targetOwner, reports: [] });
    groups.get(key).reports.push(r);
  }
  const list = [...groups.values()].sort((a, b) => b.reports.length - a.reports.length);
  // Load a preview of each target.
  const postIds = list.filter((g) => g.type === 'post').map((g) => g.id);
  const commentIds = list.filter((g) => g.type === 'comment').map((g) => g.id);
  const [postRows, commentRows] = await Promise.all([
    postIds.length ? Post.findAll({ where: { id: postIds }, include: posts.postInclude() }) : [],
    commentIds.length ? Comment.findAll({ where: { id: commentIds } }) : [],
  ]);
  const postMap = new Map(postRows.map((p) => [p.id, p]));
  const commentMap = new Map(commentRows.map((c) => [c.id, c]));
  for (const g of list) g.target = g.type === 'post' ? postMap.get(g.id) : g.type === 'comment' ? commentMap.get(g.id) : g.owner;
  view(res, 'reports', { title: 'Signalements', section: 'reports', groups: list, status, REASONS: Report.REASONS });
}

async function closeReports(type, id, admin, status, resolution) {
  await Report.update(
    { status, resolution, resolvedById: admin.id, resolvedAt: new Date() },
    { where: { targetType: type, targetId: id, status: 'open' } }
  );
}

async function banUser(user, admin) {
  if (!user) return;
  if (user.id === admin.id || user.role === 'admin') throw fail(422, 'Impossible de bannir un administrateur.');
  await user.update({ isBanned: true });
}

async function reportAction(req, res) {
  const { type, id } = req.params;
  const targetId = Number(id);
  if (!['post', 'comment', 'user'].includes(type) || !Number.isInteger(targetId)) throw fail(404, 'Signalement introuvable.');
  const action = req.body?.action;
  const ownerId = (await Report.findOne({ where: { targetType: type, targetId }, attributes: ['targetOwnerId'] }))?.targetOwnerId;
  const owner = ownerId ? await User.findByPk(ownerId) : null;

  if (action === 'dismiss') {
    // False alarm: close the reports and put a held post back online.
    if (type === 'post') {
      const [restored] = await Post.update({ status: 'published', moderationReason: null }, { where: { id: targetId, status: 'pending_approval' } });
      if (restored) await indexing.notifyPost(targetId, 'URL_UPDATED');
    }
    if (type === 'comment') {
      const [restored] = await Comment.update({ status: 'published', moderationReason: null }, { where: { id: targetId, status: 'pending_approval' } });
      if (restored) {
        const c = await Comment.findByPk(targetId, { attributes: ['postId'] });
        await adjustCounter(Post, c.postId, 'commentsCount', 1);
      }
    }
    await closeReports(type, targetId, req.user, 'dismissed', 'dismissed');
    req.flash('success', 'Signalement classé sans suite.');
  } else if (action === 'remove') {
    if (type === 'post') {
      const post = await Post.findByPk(targetId);
      if (post) {
        if (post.sharedPostId) await adjustCounter(Post, post.sharedPostId, 'sharesCount', -1);
        if (post.type === 'job') await indexing.notifyPost(post.id, 'URL_DELETED');
        await post.destroy();
        await removeLocalMedia(post.mediaUrls || []);
      }
    } else if (type === 'comment') {
      const comment = await Comment.findByPk(targetId);
      if (comment) {
        const replies = await Comment.count({ where: { parentCommentId: comment.id } });
        await comment.destroy();
        await adjustCounter(Post, comment.postId, 'commentsCount', -(1 + replies));
        await refreshScore(comment.postId);
      }
    } else {
      await banUser(owner, req.user);
    }
    await closeReports(type, targetId, req.user, 'resolved', type === 'user' ? 'banned' : 'removed');
    req.flash('success', type === 'user' ? 'Compte suspendu.' : 'Contenu supprimé.');
  } else if (action === 'ban') {
    await banUser(owner, req.user);
    await closeReports(type, targetId, req.user, 'resolved', 'banned');
    req.flash('success', "Compte de l'auteur suspendu. Ses contenus ne sont plus visibles.");
  } else {
    throw fail(422, 'Action inconnue.');
  }
  return res.redirect('/admin/signalements');
}

// ---------- Users ----------
async function usersIndex(req, res) {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const role = Object.keys(ROLE_LABELS).includes(req.query.role) ? req.query.role : '';
  const banned = req.query.statut === 'bannis';
  const where = {};
  if (role) where.role = role;
  if (banned) where.isBanned = true;
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where[Op.or] = [
      sequelize.where(fn('CONCAT', col('firstName'), ' ', col('lastName')), { [Op.like]: like }),
      { email: { [Op.like]: like } },
      { phone: { [Op.like]: like } },
      { companyName: { [Op.like]: like } },
      { username: { [Op.like]: like } },
    ];
  }
  const users = await User.findAll({ where, order: [['createdAt', 'DESC']], limit: 100 });
  const reportCounts = users.length
    ? await Report.count({ where: { targetOwnerId: users.map((u) => u.id) }, group: ['targetOwnerId'] })
    : [];
  view(res, 'users', {
    title: 'Utilisateurs',
    section: 'users',
    users,
    q,
    role,
    banned,
    reportCounts: Object.fromEntries(reportCounts.map((r) => [r.targetOwnerId, Number(r.count)])),
  });
}

async function userAction(req, res) {
  const user = await User.findByPk(req.params.id);
  if (!user) throw fail(404, 'Utilisateur introuvable.');
  const action = req.body?.action;
  if (user.id === req.user.id && action !== 'verify' && action !== 'unverify') throw fail(422, 'Vous ne pouvez pas modifier votre propre compte ici.');
  if (action === 'ban') {
    await banUser(user, req.user);
    req.flash('success', `${user.firstName} ${user.lastName} est suspendu(e).`);
  } else if (action === 'unban') {
    await user.update({ isBanned: false });
    req.flash('success', `${user.firstName} ${user.lastName} est réactivé(e).`);
  } else if (action === 'verify' || action === 'unverify') {
    await user.update({ isVerified: action === 'verify', verificationStatus: action === 'verify' ? 'approved' : 'none' });
    req.flash('success', action === 'verify' ? 'Badge « vérifié » ajouté.' : 'Badge « vérifié » retiré.');
  } else if (action === 'role') {
    const role = z.enum(['candidate', 'recruiter', 'admin']).safeParse(req.body.role);
    if (!role.success) throw fail(422, 'Rôle invalide.');
    await user.update({ role: role.data, isBanned: role.data === 'admin' ? false : user.isBanned });
    req.flash('success', `Rôle mis à jour : ${ROLE_LABELS[role.data]}.`);
  } else {
    throw fail(422, 'Action inconnue.');
  }
  let back = '/admin/utilisateurs';
  try {
    const ref = new URL(req.get('Referer') || '');
    if (ref.origin === new URL(env.APP_URL).origin && ref.pathname.startsWith('/admin/')) back = ref.pathname + ref.search;
  } catch (_) { /* no or invalid referer */ }
  return res.redirect(back);
}

// ---------- Cities & sectors ----------
async function refsIndex(req, res) {
  const [cities, sectors] = await Promise.all([refs.list('city'), refs.list('sector')]);
  view(res, 'refs', { title: 'Villes et secteurs', section: 'refs', cities, sectors });
}

const refName = z.string().trim().min(2, 'Nom trop court.').max(80, 'Nom trop long.');

async function refsAdd(req, res) {
  const kind = req.body?.kind === 'sector' ? 'sector' : 'city';
  const name = refName.safeParse(req.body?.name || '');
  if (!name.success) {
    req.flash('error', name.error.issues[0].message);
    return res.redirect('/admin/referentiels');
  }
  const existing = await RefItem.findOne({ where: { kind, name: name.data } });
  if (existing) await existing.update({ active: true });
  else await RefItem.create({ kind, name: name.data, position: (await RefItem.max('position', { where: { kind } })) + 1 || 0 });
  await refs.load();
  req.flash('success', `« ${name.data} » ajouté.`);
  return res.redirect('/admin/referentiels');
}

async function refsUpdate(req, res) {
  const item = await RefItem.findByPk(req.params.id);
  if (!item) throw fail(404, 'Élément introuvable.');
  if (req.body?.action === 'toggle') {
    await item.update({ active: !item.active });
    req.flash('success', item.active ? `« ${item.name} » réactivé.` : `« ${item.name} » désactivé (les offres existantes sont conservées).`);
  } else if (req.body?.action === 'rename') {
    const name = refName.safeParse(req.body?.name || '');
    if (!name.success) {
      req.flash('error', name.error.issues[0].message);
      return res.redirect('/admin/referentiels');
    }
    if (await RefItem.findOne({ where: { kind: item.kind, name: name.data, id: { [Op.ne]: item.id } } })) {
      req.flash('error', 'Ce nom existe déjà.');
      return res.redirect('/admin/referentiels');
    }
    const old = item.name;
    await sequelize.transaction(async (t) => {
      await item.update({ name: name.data }, { transaction: t });
      // Keep existing jobs and profiles consistent with the new name.
      const field = item.kind === 'city' ? 'location' : 'sector';
      await Job.update({ [field]: name.data }, { where: { [field]: old }, transaction: t });
      await User.update({ [item.kind === 'city' ? 'city' : 'sector']: name.data }, { where: { [item.kind === 'city' ? 'city' : 'sector']: old }, transaction: t });
    });
    req.flash('success', `« ${old} » renommé en « ${name.data} ».`);
  } else {
    throw fail(422, 'Action inconnue.');
  }
  await refs.load();
  return res.redirect('/admin/referentiels');
}

module.exports = { dashboard, featureQueue, approveFeature, rejectFeature, unfeature, reportsIndex, reportAction, usersIndex, userAction, refsIndex, refsAdd, refsUpdate };

// ======================= Phase "garde-fous" =======================
const { BannedTerm } = require('../models');
const moderationActions = require('../services/moderationActions');
const moderation = require('../services/moderation');

// Counters shown in the admin navigation (every admin page).
async function adminCounts(req, res, next) {
  const [filteredPosts, filteredComments, reported, verifications] = await Promise.all([
    Post.count({ where: { status: 'pending_approval', moderationReason: 'filter' } }),
    Comment.count({ where: { status: 'pending_approval', moderationReason: 'filter' } }),
    Report.count({ where: { status: 'open' }, distinct: true, col: 'targetId' }),
    User.count({ where: { verificationStatus: 'pending' } }),
  ]);
  res.locals.adminCounts = { filtered: filteredPosts + filteredComments, reported, verifications };
  next();
}

// Moderation queue: publications and comments blocked by the anti-scam filter.
async function moderationQueue(req, res) {
  const tab = 'filtre';
  const [postRows, commentRows] = await Promise.all([
    Post.findAll({ where: { status: 'pending_approval', moderationReason: 'filter' }, include: posts.postInclude(), order: [['createdAt', 'ASC']], limit: 100 }),
    Comment.findAll({ where: { status: 'pending_approval', moderationReason: 'filter' }, include: [{ model: User, as: 'author', attributes: posts.AUTHOR_ATTRS }], order: [['createdAt', 'ASC']], limit: 100 }),
  ]);
  await posts.hydrate(postRows, req.user);
  view(res, 'moderation', { title: 'Modération', section: 'moderation', tab, posts: postRows, comments: commentRows });
}

async function moderatePost(req, res) {
  const post = await Post.findByPk(req.params.id);
  if (!post || post.status !== 'pending_approval') throw fail(404, 'Publication introuvable ou déjà traitée.');
  const back = post.moderationReason === 'reports' ? '/admin/signalements' : '/admin/moderation';
  if (req.body?.action === 'approve') {
    await moderationActions.approvePost(post, req.user);
    if (post.moderationReason === 'reports') await closeReports('post', post.id, req.user, 'dismissed', 'dismissed');
    req.flash('success', 'Publication approuvée et visible par tous.');
  } else if (req.body?.action === 'reject') {
    await moderationActions.rejectPost(post, req.user, String(req.body.reason || '').trim());
    if (post.moderationReason === 'reports') await closeReports('post', post.id, req.user, 'resolved', 'removed');
    req.flash('success', 'Publication refusée.');
  } else {
    throw fail(422, 'Action inconnue.');
  }
  return res.redirect(back);
}

async function moderateComment(req, res) {
  const comment = await Comment.findByPk(req.params.id);
  if (!comment || comment.status !== 'pending_approval') throw fail(404, 'Commentaire introuvable ou déjà traité.');
  if (req.body?.action === 'approve') {
    await moderationActions.approveComment(comment);
    req.flash('success', 'Commentaire publié.');
  } else if (req.body?.action === 'reject') {
    await moderationActions.rejectComment(comment);
    req.flash('success', 'Commentaire supprimé.');
  } else {
    throw fail(422, 'Action inconnue.');
  }
  return res.redirect('/admin/moderation');
}

// Recruiter verification requests.
async function verificationsIndex(req, res) {
  const requests = await User.findAll({ where: { verificationStatus: 'pending' }, order: [['verificationRequestedAt', 'ASC']] });
  view(res, 'verifications', { title: 'Vérifications', section: 'verifications', requests });
}

async function verificationDecision(req, res) {
  const user = await User.findByPk(req.params.id);
  if (!user || user.verificationStatus !== 'pending') throw fail(404, 'Demande introuvable ou déjà traitée.');
  if (req.body?.action === 'approve') {
    if (user.verificationMethod === 'email' && !user.verificationEmailConfirmed) {
      req.flash('error', "L'adresse professionnelle n'a pas encore été confirmée par le recruteur.");
      return res.redirect('/admin/verifications');
    }
    await user.update({ isVerified: true, verificationStatus: 'approved', verificationNote: null });
    await notifications.notify({
      userId: user.id, actorId: req.user.id, type: 'verification_approved',
      email: (r) => ({ subject: 'Votre compte SenTravail est vérifié', title: 'Badge vérifié accordé ✓', lines: [`Bonjour ${r.firstName},`, 'Votre compte est désormais vérifié : le badge apparaît sur votre profil et vos offres, et vos publications sont visibles immédiatement.'], cta: { label: 'Voir mon profil', url: `${env.APP_URL}/profil/${user.username}` } }),
    });
    req.flash('success', `${user.companyName || user.firstName} est vérifié(e).`);
  } else if (req.body?.action === 'reject') {
    const reason = String(req.body.reason || '').trim().slice(0, 300) || 'Justificatif non valide';
    await user.update({ verificationStatus: 'rejected', verificationNote: reason });
    await notifications.notify({
      userId: user.id, actorId: req.user.id, type: 'verification_rejected', data: { reason },
      email: (r) => ({ subject: 'Votre demande de badge vérifié', title: 'Demande de badge non acceptée', lines: [`Bonjour ${r.firstName},`, `Motif : ${reason}`, 'Vous pouvez faire une nouvelle demande avec un autre justificatif.'], cta: { label: 'Nouvelle demande', url: `${env.APP_URL}/parametres/verification` } }),
    });
    req.flash('success', 'Demande refusée.');
  } else {
    throw fail(422, 'Action inconnue.');
  }
  return res.redirect('/admin/verifications');
}

// Anti-scam filter terms.
async function filterIndex(req, res) {
  const terms = await BannedTerm.findAll({ order: [['active', 'DESC'], ['term', 'ASC']] });
  view(res, 'filter', { title: 'Filtre anti-arnaque', section: 'filter', terms });
}

async function filterUpdate(req, res) {
  const action = req.body?.action;
  if (action === 'add') {
    const term = z.string().trim().min(2, 'Terme trop court.').max(80, 'Terme trop long.').safeParse(req.body.term || '');
    if (!term.success) {
      req.flash('error', term.error.issues[0].message);
      return res.redirect('/admin/filtre');
    }
    const existing = (await BannedTerm.findAll()).find((t) => moderation.normalize(t.term) === moderation.normalize(term.data));
    if (existing) await existing.update({ active: true });
    else await BannedTerm.create({ term: term.data });
    req.flash('success', `« ${term.data} » ajouté au filtre.`);
  } else if (action === 'toggle' || action === 'delete') {
    const t = await BannedTerm.findByPk(req.body.id);
    if (!t) throw fail(404, 'Terme introuvable.');
    if (action === 'toggle') await t.update({ active: !t.active });
    else await t.destroy();
    req.flash('success', action === 'delete' ? `« ${t.term} » supprimé.` : `« ${t.term} » ${t.active ? 'réactivé' : 'désactivé'}.`);
  } else {
    throw fail(422, 'Action inconnue.');
  }
  moderation.invalidateTerms();
  return res.redirect('/admin/filtre');
}

Object.assign(module.exports, { adminCounts, moderationQueue, moderatePost, moderateComment, verificationsIndex, verificationDecision, filterIndex, filterUpdate });

// ======================= Branding (logo, app icon, share image) =======================
const branding = require('../services/branding');
const { saveImage, detectImageType } = require('../services/storage');

const BRAND_ASSETS = {
  logo: { label: 'Logo', done: 'Logo mis à jour.' },
  icon: { label: "Icône de l'application", done: "Icône de l'application mise à jour." },
  share: { label: 'Image de partage', done: 'Image de partage mise à jour.' },
};

function brandingIndex(req, res) {
  view(res, 'branding', { title: 'Apparence', section: 'branding', brand: branding.current(), errors: {} });
}

async function brandingUpdate(req, res) {
  const asset = req.params.asset;
  if (!BRAND_ASSETS[asset]) {
    const err = new Error('Élément inconnu.');
    err.status = 404;
    throw err;
  }
  const label = BRAND_ASSETS[asset].label;
  // Back to the original SenTravail artwork.
  if (req.body?.action === 'reset') {
    const keys = { logo: ['logo'], icon: ['icon192', 'icon512'], share: ['shareImage'] }[asset];
    await branding.set(Object.fromEntries(keys.map((k) => [k, null])));
    req.flash('success', `${label} : l'original est rétabli.`);
    return res.redirect('/admin/apparence');
  }
  const file = req.files?.image?.[0];
  const fail = (message) => {
    res.status(422);
    return view(res, 'branding', { title: 'Apparence', section: 'branding', brand: branding.current(), errors: { [asset]: message } });
  };
  if (!file) return fail('Choisissez une image.');
  if (asset === 'icon') {
    // App icons must be PNG (home screen, favicon); the browser sends a 512 px and a 192 px version.
    const small = req.files?.icon192?.[0] || file;
    if (detectImageType(file.buffer) !== 'png' || detectImageType(small.buffer) !== 'png') return fail("L'icône doit être une image PNG carrée.");
    const [icon512, icon192] = await Promise.all([saveImage(file.buffer, 'branding'), small === file ? null : saveImage(small.buffer, 'branding')]);
    await branding.set({ icon512, icon192: icon192 || icon512 });
  } else {
    const url = await saveImage(file.buffer, 'branding');
    await branding.set(asset === 'logo' ? { logo: url } : { shareImage: url });
  }
  req.flash('success', BRAND_ASSETS[asset].done);
  return res.redirect('/admin/apparence');
}

Object.assign(module.exports, { brandingIndex, brandingUpdate });

// ======================= AdSense settings =======================
const adsConfig = require('../services/adsConfig');

const adsSchema = z.object({
  enabled: z.string().optional(),
  client: z.string().trim().refine((v) => !v || /^ca-pub-\d{10,20}$/.test(v), 'Identifiant éditeur invalide (ex. ca-pub-1234567890123456).'),
  defaultSlot: z.string().trim().refine((v) => !v || /^\d{6,20}$/.test(v), "ID de bloc d'annonces invalide (chiffres uniquement)."),
  ...Object.fromEntries(adsConfig.PLACEMENTS.map((p) => [p, z.string().trim().optional().default('').refine((v) => !v || /^\d{6,20}$/.test(v), "ID de bloc d'annonces invalide (chiffres uniquement).")])),
});

async function adsIndex(req, res) {
  await adsConfig.load();
  view(res, 'ads', { title: 'Publicités', section: 'ads', ads: adsConfig.current(), errors: {}, adsTxt: adsConfig.adsTxt() });
}

async function adsUpdate(req, res) {
  const body = req.body || {};
  const parsed = adsSchema.safeParse(body);
  if (!parsed.success) {
    const errors = Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message]));
    const ads = { ...adsConfig.current(), client: body.client, defaultSlot: body.defaultSlot, switchOn: body.enabled === 'on', overrides: Object.fromEntries(adsConfig.PLACEMENTS.map((p) => [p, body[p] || ''])) };
    res.status(422);
    return view(res, 'ads', { title: 'Publicités', section: 'ads', ads, errors, adsTxt: adsConfig.adsTxt() });
  }
  const d = parsed.data;
  await adsConfig.save({
    'ads.enabled': d.enabled === 'on' ? 'on' : 'off',
    'ads.client': d.client,
    'ads.slot.default': d.defaultSlot,
    ...Object.fromEntries(adsConfig.PLACEMENTS.map((p) => [`ads.slot.${p}`, d[p]])),
  });
  req.flash('success', 'Réglages publicitaires enregistrés.');
  return res.redirect('/admin/publicites');
}

Object.assign(module.exports, { adsIndex, adsUpdate });

// ======================= Google Analytics / Search Console =======================
const googleConfig = require('../services/googleConfig');

async function googleIndex(req, res) {
  await googleConfig.load();
  view(res, 'google', { title: 'Google', section: 'google', g: googleConfig.current(), values: null, errors: {}, ...indexingLocals() });
}

function indexingLocals() {
  return {
    appUrl: env.APP_URL,
    indexing: { enabled: indexing.enabled(), problem: indexing.diagnose(), email: indexing.serviceAccountEmail(), history: indexing.recentHistory(), limit: indexing.BULK_LIMIT },
  };
}

// "Envoyer toutes les offres ouvertes à Google" (e.g. right after setting up the API).
async function googleIndexAll(req, res) {
  if (!indexing.enabled()) {
    req.flash('error', "L'API d'indexation n'est pas configurée.");
    return res.redirect('/admin/google');
  }
  const { sent, total } = await indexing.submitAllOpen();
  req.flash(sent === total ? 'success' : 'error', `${sent} offre(s) sur ${total} envoyée(s) à Google.${sent < total ? ' Voir les erreurs ci-dessous.' : ''}`);
  return res.redirect('/admin/google');
}

async function googleUpdate(req, res) {
  const analyticsId = String(req.body?.analyticsId || '').trim().toUpperCase();
  const siteVerification = googleConfig.parseVerification(req.body?.siteVerification);
  const errors = {};
  if (analyticsId && !googleConfig.GA_RE.test(analyticsId)) errors.analyticsId = 'ID de mesure invalide : il commence par G- (ex. G-ABC123XYZ9).';
  if (siteVerification && !googleConfig.GSC_RE.test(siteVerification)) errors.siteVerification = 'Code de validation invalide : collez la balise meta fournie par Search Console.';
  if (Object.keys(errors).length) {
    res.status(422);
    return view(res, 'google', { title: 'Google', section: 'google', g: googleConfig.current(), values: { analyticsId, siteVerification: req.body?.siteVerification || '' }, errors, ...indexingLocals() });
  }
  await googleConfig.save({ analyticsId, siteVerification });
  req.flash('success', 'Réglages Google enregistrés.');
  return res.redirect('/admin/google');
}

Object.assign(module.exports, { googleIndex, googleUpdate, googleIndexAll });

// ======================= Recruitment (ATS) across the platform =======================
async function applicationsIndex(req, res) {
  const atsStats = require('../services/atsStats');
  const q = String(req.query.q || '').trim().slice(0, 80);
  const status = String(req.query.statut || '');
  const mode = ['platform', 'email'].includes(req.query.mode) ? req.query.mode : '';
  const page = Math.max(1, Math.min(500, Number.parseInt(req.query.page, 10) || 1));
  const [result, stats] = await Promise.all([atsStats.search({ status, mode, q, page }), atsStats.platformStats()]);
  view(res, 'applications', {
    title: 'Recrutement', section: 'ats', result, stats, filters: { q, status, mode }, page, LABELS: Application.STATUS_LABELS, PIPELINE: Application.PIPELINE,
  });
}

Object.assign(module.exports, { applicationsIndex });
