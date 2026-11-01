const { Op, fn, col, literal } = require('sequelize');
const { z } = require('zod');
const { sequelize, User, Post, Job, Application, Report, Comment, RefItem } = require('../models');
const env = require('../config/env');
const posts = require('../services/posts');
const refs = require('../services/refs');
const jobsService = require('../services/jobs');
const { removeLocalMedia } = require('../services/video');
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
    if (type === 'post') await Post.update({ status: 'published' }, { where: { id: targetId, status: 'pending_approval' } });
    await closeReports(type, targetId, req.user, 'dismissed', 'dismissed');
    req.flash('success', 'Signalement classé sans suite.');
  } else if (action === 'remove') {
    if (type === 'post') {
      const post = await Post.findByPk(targetId);
      if (post) {
        if (post.sharedPostId) await adjustCounter(Post, post.sharedPostId, 'sharesCount', -1);
        await post.destroy();
        await removeLocalMedia([...(post.mediaUrls || []), post.videoUrl, post.thumbnailUrl]);
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
    await user.update({ isVerified: action === 'verify' });
    req.flash('success', action === 'verify' ? 'Badge « vérifié » ajouté.' : 'Badge « vérifié » retiré.');
  } else if (action === 'role') {
    const role = z.enum(['candidate', 'recruiter', 'admin']).safeParse(req.body.role);
    if (!role.success) throw fail(422, 'Rôle invalide.');
    await user.update({ role: role.data, isBanned: role.data === 'admin' ? false : user.isBanned });
    req.flash('success', `Rôle mis à jour : ${ROLE_LABELS[role.data]}.`);
  } else {
    throw fail(422, 'Action inconnue.');
  }
  const back = req.get('Referer');
  return res.redirect(back && back.startsWith(env.APP_URL) ? back : '/admin/utilisateurs');
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
