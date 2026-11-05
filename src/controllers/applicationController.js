const fs = require('fs');
const { hxTrigger } = require('../utils/hx');
const { Op } = require('sequelize');
const { Application, Post, Job, User } = require('../models');
const { applicationSchema, statusSchema, noteSchema } = require('../validators/application');
const { safeReturn } = require('../utils/returnTo');
const { formatDateTime } = require('../utils/viewHelpers');
const { fieldErrors } = require('../validators/auth');
const cvStorage = require('../services/cvStorage');
const applications = require('../services/applications');
const jobs = require('../services/jobs');
const notifications = require('../services/notifications');
const env = require('../config/env');

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
  if (job.applyMode === 'link') throw httpError(400, 'Pour cette offre, la candidature se fait sur le site du recruteur.');
  if (req.user && req.user.id === post.authorId) throw httpError(403, 'Vous ne pouvez pas postuler à votre propre offre.');

  const parsed = applicationSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({ errors: fieldErrors(parsed.error) });
  const d = parsed.data;
  // Honeypot filled in: a bot. Nothing is stored.
  if (d.website) {
    console.warn(`[apply] honeypot triggered from ${req.ip}`);
    return res.status(400).json({ error: 'Envoi impossible. Rechargez la page et réessayez.' });
  }

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
  // On-platform recruitment (ATS): the application is received right away, no email step.
  if (job.applyMode === 'platform') Object.assign(fields, { status: 'confirmed_sent', sentVia: 'platform', sentAt: new Date(), stageAt: new Date() });
  const app = existing ? await existing.update(fields) : await Application.create(fields);
  rememberInSession(req, app);

  if (job.applyMode === 'platform') {
    await notifyRecruiter(app, { email: true });
    return res.status(201).json({
      id: app.id,
      sent: true,
      message: req.user ? 'Le recruteur la reçoit sur SenTravail. Suivez son avancement dans « Mes candidatures ».' : 'Le recruteur la reçoit sur SenTravail et vous répondra par email ou par téléphone.',
    });
  }
  return res.status(201).json({ id: app.id, mailto: applications.mailtoFor(app, job.applyEmail) });
}

async function loadOwnApplication(req) {
  const app = await Application.findByPk(req.params.id);
  if (!app || !isApplicant(req, app)) throw httpError(404, 'Candidature introuvable.');
  return app;
}

// In-app notification for the recruiter (+ email for on-platform applications, which are not
// otherwise emailed to them).
function notifyRecruiter(app, { email = false } = {}) {
  return notifications.notify({
    email: email ? () => ({
      subject: `Nouvelle candidature : ${app.jobTitle}`,
      title: 'Nouvelle candidature',
      lines: [`${app.firstName} ${app.lastName} a postulé à votre offre « ${app.jobTitle} ».`, 'Consultez son CV et faites avancer sa candidature dans votre tableau de suivi.'],
      cta: { label: 'Voir la candidature', url: `${env.APP_URL}/candidatures/${app.id}` },
    }) : null,
    userId: app.recruiterId,
    actorId: app.candidateId,
    type: 'application',
    postId: app.jobPostId,
    applicationId: app.id,
    data: { jobTitle: app.jobTitle, actorName: `${app.firstName} ${app.lastName}` },
  });
}

// "Oui, c'est envoyé"
async function confirm(req, res) {
  const app = await loadOwnApplication(req);
  if (app.status === 'opened_mail') {
    await app.update({ status: 'confirmed_sent', sentVia: 'mailto', sentAt: new Date() });
    await notifyRecruiter(app);
  }
  return res.json({
    status: app.status,
    message: req.user ? 'Retrouvez-la dans « Mes candidatures ».' : 'Le recruteur vous répondra directement par email ou par téléphone.',
  });
}

// "Envoyer via SenTravail" (server-side email with the CV attached)
async function sendViaServer(req, res) {
  const app = await loadOwnApplication(req);
  if (app.status !== 'opened_mail') return res.json({ status: app.status, message: 'Cette candidature a déjà été envoyée.' });
  const job = app.jobPostId ? await Job.findOne({ where: { postId: app.jobPostId } }) : null;
  if (!job) throw httpError(410, "Cette offre n'existe plus.");
  await applications.sendViaServer(app, job.applyEmail);
  await app.update({ status: 'confirmed_sent', sentVia: 'server', sentAt: new Date() });
  await notifyRecruiter(app);
  return res.json({ status: app.status, message: 'Transmise par SenTravail avec votre CV. Une copie vous a été envoyée par email.' });
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
  const active = list.filter((a) => !['opened_mail', 'rejected', 'hired'].includes(a.status));
  const summary = {
    total: list.filter((a) => a.status !== 'opened_mail').length,
    inProgress: active.length,
    interviews: list.filter((a) => a.status === 'interview').length,
    hired: list.filter((a) => a.status === 'hired').length,
  };
  res.render('pages/applications/mine', { title: 'Mes candidatures', noAds: true, applications: list, summary, LABELS: Application.STATUS_LABELS, PIPELINE: Application.PIPELINE });
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
  // Board shows every application; the mobile list is filtered by stage.
  const all = status ? await Application.findAll({ where: { jobPostId: post.id }, order: [['createdAt', 'DESC']], limit: 500 }) : list;
  res.render('pages/applications/forJob', {
    title: `Candidatures — ${post.job.title}`,
    noAds: true,
    wide: true,
    all,
    STAGES: Application.RECRUITER_STAGES,
    PIPELINE: Application.PIPELINE,
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
    PIPELINE: Application.PIPELINE,
    cvPath: cvStorage.signedPath(app.cvKey, app.cvName, 1),
  });
}

// Private recruiter note on an application.
async function saveNote(req, res) {
  const app = await Application.findByPk(req.params.id);
  if (!app) throw httpError(404, 'Candidature introuvable.');
  if (!canManageApplication(req, app)) throw httpError(403, "Vous ne pouvez pas modifier cette candidature.");
  const parsed = noteSchema.safeParse(req.body || {});
  if (!parsed.success) {
    req.flash('error', parsed.error.issues[0].message);
    return res.redirect(`/candidatures/${app.id}`);
  }
  await app.update({ recruiterNote: parsed.data.note || null });
  req.flash('success', 'Note enregistrée.');
  return res.redirect(`/candidatures/${app.id}#notes`);
}

async function setStatus(req, res) {
  const app = await Application.findByPk(req.params.id);
  if (!app) throw httpError(404, 'Candidature introuvable.');
  if (!canManageApplication(req, app)) throw httpError(403, "Vous ne pouvez pas modifier cette candidature.");
  const parsed = statusSchema.safeParse(req.body || {});
  if (!parsed.success) throw httpError(422, 'Statut invalide.');
  const d = parsed.data;
  const previous = app.status;
  const previousInterview = app.interviewAt && new Date(app.interviewAt).getTime();
  const changes = { status: d.status };
  if (d.status !== previous) changes.stageAt = new Date();
  if (d.status === 'interview') {
    if (d.interviewAt) changes.interviewAt = new Date(`${d.interviewAt.slice(0, 16)}:00Z`); // Dakar = UTC
    if (d.interviewPlace || d.interviewAt) changes.interviewPlace = d.interviewPlace || null;
  }
  await app.update(changes);
  const rescheduled = d.status === 'interview' && app.interviewAt && new Date(app.interviewAt).getTime() !== previousInterview;
  if (previous !== app.status || rescheduled) await notifyCandidate(app);
  if (req.get('HX-Request')) {
    hxTrigger(res, { toast: { message: 'Statut mis à jour.' } });
    return res.render('partials/applicationStatus', { layout: false, app, LABELS: Application.STATUS_LABELS });
  }
  req.flash('success', `Candidature déplacée : ${Application.STATUS_LABELS[app.status].recruiter}.`);
  return res.redirect(safeReturn(d.retour) || `/candidatures/${app.id}`);
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
    hasBuilt: !!req.user.cvBuilt,
  });
}

async function uploadMyCv(req, res) {
  const back = require('../utils/returnTo').safeReturn(req.body?.retour) || '/cv';
  if (!req.file) {
    req.flash('error', 'Choisissez un fichier PDF ou Word.');
    return res.redirect(back);
  }
  const cv = await cvStorage.saveCv(req.file.buffer, req.file.originalname);
  await req.user.update({ cvUrl: cv.key, cvName: cv.name });
  req.flash('success', 'CV importé. Il sera proposé automatiquement quand vous postulez.');
  return res.redirect(back);
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
  const byStage = await Application.count({ where: { jobPostId: { [Op.in]: postIds }, status: { [Op.ne]: 'opened_mail' } }, group: ['jobPostId', 'status'] });
  const out = {};
  for (const r of rows) out[r.jobPostId] = { total: Number(r.count), fresh: 0, stages: {} };
  for (const r of fresh) (out[r.jobPostId] ||= { total: 0, fresh: 0, stages: {} }).fresh = Number(r.count);
  for (const r of byStage) (out[r.jobPostId] ||= { total: 0, fresh: 0, stages: {} }).stages[r.status] = Number(r.count);
  return out;
}

// Candidate: in-app (members) + email at each important stage (members and guests).
function candidateEmail(app) {
  const hi = `Bonjour ${app.firstName},`;
  const job = `« ${app.jobTitle} »`;
  const myApps = { label: 'Voir mes candidatures', url: `${env.APP_URL}/mes-candidatures` };
  switch (app.status) {
    case 'shortlisted':
      return { subject: `Bonne nouvelle pour votre candidature ${job}`, title: 'Vous êtes présélectionné(e) !', lines: [hi, `${app.companyName} a présélectionné votre candidature au poste ${job}. Le recruteur va vous contacter par email ou par téléphone.`], cta: myApps };
    case 'interview':
      return {
        subject: `Entretien pour le poste ${job}`,
        title: 'Vous êtes invité(e) à un entretien',
        lines: [hi, `${app.companyName} vous invite à un entretien pour le poste ${job}.`,
          ...(app.interviewAt ? [`Date : ${formatDateTime(app.interviewAt)}`] : []),
          ...(app.interviewPlace ? [`Lieu : ${app.interviewPlace}`] : []),
          ...(!app.interviewAt ? ['Le recruteur vous précisera la date et le lieu.'] : [])],
        cta: myApps,
      };
    case 'offer':
      return { subject: `Proposition d'embauche : ${app.jobTitle}`, title: "Vous avez reçu une proposition d'embauche !", lines: [hi, `${app.companyName} souhaite vous proposer le poste ${job}. Le recruteur va vous contacter pour les détails.`], cta: myApps };
    case 'hired':
      return { subject: `Félicitations : ${app.jobTitle}`, title: 'Félicitations, vous êtes embauché(e) !', lines: [hi, `${app.companyName} confirme votre recrutement au poste ${job}. Pensez à partager la bonne nouvelle avec « J'ai été recruté ! ».`], cta: myApps };
    case 'rejected':
      return { subject: `Votre candidature ${job}`, title: 'Réponse à votre candidature', lines: [hi, `${app.companyName} n'a pas retenu votre candidature au poste ${job}. Ne vous découragez pas : de nouvelles offres sont publiées chaque jour.`], cta: { label: 'Voir les offres', url: `${env.APP_URL}/offres` } };
    default:
      return null;
  }
}

async function notifyCandidate(app) {
  const statusLabel = Application.STATUS_LABELS[app.status].candidate;
  const email = candidateEmail(app);
  if (app.candidateId) {
    await notifications.notify({ userId: app.candidateId, type: 'application_status', postId: app.jobPostId, applicationId: app.id, data: { jobTitle: app.jobTitle, statusLabel: statusLabel.replace(' 🎉', '') }, email: email ? () => email : null });
  } else if (email) {
    notifications.emailAddress(app.email, email);
  }
}

module.exports = { apply, confirm, sendViaServer, mailto, mine, forJob, show, setStatus, saveNote, downloadCv, myCv, uploadMyCv, removeMyCv, countsByJob };
