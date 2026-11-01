const fs = require('fs');
const { Op } = require('sequelize');
const { Application, Post, Job, User } = require('../models');
const { applicationSchema, statusSchema } = require('../validators/application');
const { fieldErrors } = require('../validators/auth');
const cvStorage = require('../services/cvStorage');
const applications = require('../services/applications');
const jobs = require('../services/jobs');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Applications created in this browser session (lets guests confirm their own).
function rememberInSession(req, app) {
  req.session.applications = [...new Set([...(req.session.applications || []), app.id])].slice(-20);
}

function isApplicant(req, app) {
  return (req.user && app.candidateId === req.user.id) || (req.session.applications || []).includes(app.id);
}

function canManageApplication(req, app) {
  return !!req.user && (req.user.id === app.recruiterId || req.user.role === 'admin');
}

// ---------- Candidate side ----------

async function apply(req, res) {
  const post = await jobs.findBySlug(req.params.slug);
  if (!post || !post.job || post.status !== 'published' || post.author.isBanned) throw httpError(404, "Cette offre n'existe plus.");
  const job = post.job;
  if (job.isExpired) throw httpError(410, 'Cette offre est clôturée.');
  if (req.user && req.user.id === post.authorId) throw httpError(403, 'Vous ne pouvez pas postuler à votre propre offre.');

  const parsed = applicationSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({ errors: fieldErrors(parsed.error) });
  const d = parsed.data;

  // CV: uploaded file, or the one saved on the profile.
  let cv;
  if (req.file) {
    cv = await cvStorage.saveCv(req.file.buffer, req.file.originalname);
    if (req.user && (d.saveToProfile === 'on' || !req.user.cvUrl)) await req.user.update({ cvUrl: cv.key, cvName: cv.name });
  } else if (d.cvSource === 'profile' && req.user?.cvUrl) {
    cv = { key: req.user.cvUrl, name: req.user.cvName || 'CV.pdf' };
  } else {
    return res.status(422).json({ errors: { cv: 'Ajoutez votre CV (PDF ou Word, 5 Mo maximum).' } });
  }

  // One application per person and offer: an unconfirmed one is updated, a sent one blocks.
  const owner = req.user ? { candidateId: req.user.id } : { email: d.email, candidateId: null };
  const existing = await Application.findOne({ where: { jobPostId: post.id, ...owner }, order: [['id', 'DESC']] });
  if (existing && existing.status !== 'opened_mail') {
    return res.status(409).json({ error: 'Vous avez déjà postulé à cette offre. Retrouvez-la dans « Mes candidatures ».' });
  }

  const fields = {
    jobPostId: post.id,
    jobTitle: job.title,
    companyName: job.companyName,
    jobSlug: job.slug,
    recruiterId: post.authorId,
    candidateId: req.user ? req.user.id : null,
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email,
    phone: d.phone,
    cvKey: cv.key,
    cvName: cv.name,
    message: d.message || null,
    status: 'opened_mail',
  };
  const app = existing ? await existing.update(fields) : await Application.create(fields);
  rememberInSession(req, app);

  return res.status(201).json({ id: app.id, mailto: applications.mailtoFor(app, job.applyEmail) });
}

async function loadOwnApplication(req) {
  const app = await Application.findByPk(req.params.id);
  if (!app || !isApplicant(req, app)) throw httpError(404, 'Candidature introuvable.');
  return app;
}

// "Oui, c'est envoyé"
async function confirm(req, res) {
  const app = await loadOwnApplication(req);
  if (app.status === 'opened_mail') await app.update({ status: 'confirmed_sent', sentVia: 'mailto', sentAt: new Date() });
  // Recruiter notification (in-app + email) is added with the notifications system (Phase 9).
  return res.json({ status: app.status, message: 'Candidature envoyée ! Retrouvez-la dans « Mes candidatures ».' });
}

// "Envoyer via SenTravail" (server-side email with the CV attached)
async function sendViaServer(req, res) {
  const app = await loadOwnApplication(req);
  if (app.status !== 'opened_mail') return res.json({ status: app.status, message: 'Cette candidature a déjà été envoyée.' });
  const job = app.jobPostId ? await Job.findOne({ where: { postId: app.jobPostId } }) : null;
  if (!job) throw httpError(410, "Cette offre n'existe plus.");
  await applications.sendViaServer(app, job.applyEmail);
  await app.update({ status: 'confirmed_sent', sentVia: 'server', sentAt: new Date() });
  return res.json({ status: app.status, message: 'Candidature envoyée par SenTravail. Une copie vous a été envoyée par email.' });
}

// Reopen the mail app for an unconfirmed application (from "Mes candidatures").
async function mailto(req, res) {
  const app = await loadOwnApplication(req);
  const job = app.jobPostId ? await Job.findOne({ where: { postId: app.jobPostId } }) : null;
  if (!job) throw httpError(410, "Cette offre n'existe plus.");
  return res.json({ id: app.id, mailto: applications.mailtoFor(app, job.applyEmail) });
}

async function mine(req, res) {
  const list = await Application.findAll({ where: { candidateId: req.user.id }, order: [['createdAt', 'DESC']], limit: 200 });
  res.render('pages/applications/mine', { title: 'Mes candidatures', noAds: true, applications: list, LABELS: Application.STATUS_LABELS });
}

// ---------- Recruiter side ----------

async function forJob(req, res) {
  const post = await jobs.findBySlug(req.params.slug);
  if (!post || !post.job) throw httpError(404, "Cette offre n'existe pas.");
  if (!jobs.canManage(post, req.user)) throw httpError(403, "Vous n'avez pas accès aux candidatures de cette offre.");
  const status = Application.STATUSES.includes(req.query.statut) ? req.query.statut : null;
  const list = await Application.findAll({
    where: { jobPostId: post.id, ...(status ? { status } : {}) },
    order: [['createdAt', 'DESC']],
    limit: 500,
  });
  const counts = await Application.count({ where: { jobPostId: post.id }, group: ['status'] });
  res.render('pages/applications/forJob', {
    title: `Candidatures — ${post.job.title}`,
    noAds: true,
    post,
    job: post.job,
    applications: list,
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.count)])),
    filter: status,
    LABELS: Application.STATUS_LABELS,
    cvLink: (a) => cvStorage.signedPath(a.cvKey, a.cvName, 1),
  });
}

async function show(req, res) {
  const app = await Application.findByPk(req.params.id);
  if (!app) throw httpError(404, 'Candidature introuvable.');
  if (!canManageApplication(req, app)) throw httpError(403, "Vous n'avez pas accès à cette candidature.");
  if (app.status === 'confirmed_sent') await app.update({ status: 'viewed' });
  res.render('pages/applications/show', {
    title: `Candidature de ${app.firstName} ${app.lastName}`,
    noAds: true,
    app,
    LABELS: Application.STATUS_LABELS,
    cvPath: cvStorage.signedPath(app.cvKey, app.cvName, 1),
  });
}

async function setStatus(req, res) {
  const app = await Application.findByPk(req.params.id);
  if (!app) throw httpError(404, 'Candidature introuvable.');
  if (!canManageApplication(req, app)) throw httpError(403, "Vous ne pouvez pas modifier cette candidature.");
  const parsed = statusSchema.safeParse(req.body || {});
  if (!parsed.success) throw httpError(422, 'Statut invalide.');
  await app.update({ status: parsed.data.status });
  // Candidate notification arrives with Phase 9.
  if (req.get('HX-Request')) {
    res.set('HX-Trigger', JSON.stringify({ toast: { message: 'Statut mis à jour.' } }));
    return res.render('partials/applicationStatus', { layout: false, app, LABELS: Application.STATUS_LABELS });
  }
  req.flash('success', 'Statut mis à jour.');
  return res.redirect(`/candidatures/${app.id}`);
}

// ---------- CV download (signed link) ----------

async function downloadCv(req, res) {
  if (!cvStorage.verify(req.query)) throw httpError(403, 'Ce lien de téléchargement est invalide ou a expiré.');
  const file = cvStorage.filePath(req.query.k);
  if (!file || !fs.existsSync(file)) throw httpError(404, "Ce CV n'est plus disponible.");
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Robots-Tag', 'noindex');
  res.type(cvStorage.mimeOf(req.query.k));
  return res.download(file, req.query.n);
}

// ---------- My CV page (profile CV import; the CV builder comes in Phase 5) ----------

function myCv(req, res) {
  res.render('pages/applications/myCv', {
    title: 'Mon CV',
    noAds: true,
    cvPath: req.user.cvUrl ? cvStorage.signedPath(req.user.cvUrl, req.user.cvName || 'CV.pdf', 1) : null,
  });
}

async function uploadMyCv(req, res) {
  if (!req.file) {
    req.flash('error', 'Choisissez un fichier PDF ou Word.');
    return res.redirect('/cv');
  }
  const cv = await cvStorage.saveCv(req.file.buffer, req.file.originalname);
  await req.user.update({ cvUrl: cv.key, cvName: cv.name });
  req.flash('success', 'CV enregistré. Il sera proposé automatiquement quand vous postulez.');
  return res.redirect('/cv');
}

async function removeMyCv(req, res) {
  // The file itself is kept: past applications still link to it.
  await req.user.update({ cvUrl: null, cvName: null });
  req.flash('success', 'CV retiré de votre profil.');
  return res.redirect('/cv');
}

async function countsByJob(postIds) {
  if (!postIds.length) return {};
  const rows = await Application.count({
    where: { jobPostId: { [Op.in]: postIds }, status: { [Op.ne]: 'opened_mail' } },
    group: ['jobPostId'],
  });
  const fresh = await Application.count({ where: { jobPostId: { [Op.in]: postIds }, status: 'confirmed_sent' }, group: ['jobPostId'] });
  const out = {};
  for (const r of rows) out[r.jobPostId] = { total: Number(r.count), fresh: 0 };
  for (const r of fresh) (out[r.jobPostId] ||= { total: 0, fresh: 0 }).fresh = Number(r.count);
  return out;
}

module.exports = { apply, confirm, sendViaServer, mailto, mine, forJob, show, setStatus, downloadCv, myCv, uploadMyCv, removeMyCv, countsByJob };
