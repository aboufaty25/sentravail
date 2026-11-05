// CV showcase ("Vitrine des CV"): admin management of every CV on the site and of the slider,
// plus the public full-screen viewer. Admin routes are protected by adminOnly in the router.
const fs = require('fs/promises');
const { z } = require('zod');
const env = require('../config/env');
const { Application, User } = require('../models');
const showcase = require('../services/cvShowcase');
const cvStorage = require('../services/cvStorage');
const { saveImage, detectImageType } = require('../services/storage');
const { TEMPLATES } = require('../config/cvTemplates');

const view = (res, tpl, locals) => res.render(`pages/admin/${tpl}`, { noAds: true, wide: true, section: 'cv', ...locals });

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw fail(404, 'CV introuvable.');
  return id;
}

async function loadItem(req) {
  const { CvShowcase } = require('../models');
  const item = await CvShowcase.findByPk(parseId(req.params.id));
  if (!item) throw fail(404, 'CV introuvable.');
  return item;
}

const cvLink = (key, name) => (key ? cvStorage.signedPath(key, name || 'CV.pdf', 1) : null);

// ---------- Admin ----------

async function adminShowcase(req, res) {
  const { CvShowcase } = require('../models');
  const items = await CvShowcase.findAll({
    include: [{ model: User, as: 'user', attributes: ['id', 'username', 'cvShowcaseRefused', 'isBanned'], required: false }],
    order: [['sortOrder', 'ASC'], ['id', 'DESC']],
  });
  view(res, 'cvShowcase', { title: 'CV — Vitrine', tab: 'vitrine', items, errors: {}, values: {} });
}

async function adminBuilt(req, res) {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const [users, inShowcase] = await Promise.all([showcase.builtCvs({ q }), showcaseUserIds()]);
  view(res, 'cvList', {
    title: 'CV — Créés sur le site', tab: 'crees', q, inShowcase, TEMPLATES,
    rows: users.map((u) => ({ user: u, cv: u.cvBuilt, link: cvLink(u.cvUrl, u.cvName) })),
  });
}

async function adminImported(req, res) {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const { Op } = require('sequelize');
  const appWhere = q ? { [Op.or]: [{ firstName: { [Op.like]: `%${q}%` } }, { lastName: { [Op.like]: `%${q}%` } }, { email: { [Op.like]: `%${q}%` } }, { jobTitle: { [Op.like]: `%${q}%` } }] } : {};
  const [users, apps, inShowcase] = await Promise.all([
    showcase.importedCvs({ q }),
    Application.findAll({ where: appWhere, attributes: ['id', 'firstName', 'lastName', 'email', 'jobTitle', 'companyName', 'cvKey', 'cvName', 'candidateId', 'createdAt'], order: [['id', 'DESC']], limit: 100 }),
    showcaseUserIds(),
  ]);
  view(res, 'cvList', {
    title: 'CV — Importés', tab: 'importes', q, inShowcase, TEMPLATES,
    rows: users.map((u) => ({ user: u, link: cvLink(u.cvUrl, u.cvName), isPdf: /\.pdf$/.test(u.cvUrl || '') })),
    apps: apps.map((a) => ({ app: a, link: cvLink(a.cvKey, a.cvName) })),
  });
}

async function showcaseUserIds() {
  const { CvShowcase } = require('../models');
  const rows = await CvShowcase.findAll({ attributes: ['userId'], raw: true });
  return new Set(rows.map((r) => r.userId).filter(Boolean));
}

// Adds a member's CV (a member who refused is rejected by the service).
async function adminAddMember(req, res) {
  const userId = parseId(req.body?.userId);
  try {
    await showcase.addMemberCv(userId, req.user);
    req.flash('success', 'CV ajouté à la vitrine. Sa miniature se prépare sur cette page.');
    return res.redirect('/admin/cv');
  } catch (err) {
    if (err.status !== 422 && err.status !== 404) throw err;
    req.flash('error', err.message);
    return res.redirect(req.body?.from === 'importes' ? '/admin/cv/importes' : '/admin/cv/crees');
  }
}

const uploadSchema = z.object({
  name: z.string().trim().min(2, 'Indiquez le nom de la personne.').max(120),
  title: z.string().trim().max(120).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
});

async function adminUpload(req, res) {
  const parsed = uploadSchema.safeParse(req.body || {});
  const errors = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message]));
  if (!req.file) errors.cv = 'Choisissez le CV (PDF).';
  else if (cvStorage.detectCvType(req.file.buffer) !== 'pdf') errors.cv = 'Le CV doit être un fichier PDF.';
  if (Object.keys(errors).length) {
    const { CvShowcase } = require('../models');
    const items = await CvShowcase.findAll({ include: [{ model: User, as: 'user', attributes: ['id', 'username', 'cvShowcaseRefused', 'isBanned'], required: false }], order: [['sortOrder', 'ASC'], ['id', 'DESC']] });
    res.status(422);
    return view(res, 'cvShowcase', { title: 'CV — Vitrine', tab: 'vitrine', items, errors, values: req.body || {} });
  }
  await showcase.addUpload(req.file.buffer, parsed.data, req.user);
  req.flash('success', 'CV ajouté à la vitrine. Sa miniature se prépare sur cette page.');
  return res.redirect('/admin/cv');
}

async function adminItemAction(req, res) {
  const item = await loadItem(req);
  const action = req.body?.action;
  try {
    if (action === 'up' || action === 'down') await showcase.move(item, action);
    else if (action === 'toggle') {
      await showcase.toggle(item);
      req.flash('success', item.isActive ? 'CV affiché dans la vitrine.' : 'CV masqué de la vitrine.');
    } else if (action === 'remove') {
      await showcase.remove(item);
      req.flash('success', 'CV retiré de la vitrine.');
    } else if (action === 'refresh') {
      await showcase.refresh(item);
      req.flash('success', 'CV mis à jour avec sa dernière version.');
    } else throw fail(422, 'Action inconnue.');
  } catch (err) {
    if (err.status !== 422) throw err;
    req.flash('error', err.message);
  }
  return res.redirect('/admin/cv');
}

// First-page images rendered by the admin's browser (pdf.js): small for cards, large for the viewer.
async function adminImages(req, res) {
  const item = await loadItem(req);
  const small = req.files?.small?.[0];
  const large = req.files?.large?.[0];
  if (!small || !large || !detectImageType(small.buffer) || !detectImageType(large.buffer)) {
    return res.status(422).json({ error: 'Images manquantes.' });
  }
  const [thumbnail, image] = await Promise.all([saveImage(small.buffer, 'cv-showcase'), saveImage(large.buffer, 'cv-showcase')]);
  // masked=1: the admin page blacked out emails, phone numbers and links before sending.
  await showcase.setImages(item, { thumbnail, image, masked: req.body?.masked === '1' });
  return res.json({ ok: true, thumbnail });
}

// The stored PDF, for the admin (even when hidden): used to render the images.
async function adminPdf(req, res) {
  const item = await loadItem(req);
  return sendFile(res, { key: item.cvKey, name: `CV-${item.id}.pdf` }, 'private, no-store');
}

async function sendFile(res, { key, name }, cacheControl) {
  const file = cvStorage.filePath(key);
  if (!file) throw fail(404, 'CV introuvable.');
  const data = await fs.readFile(file).catch(() => null);
  if (!data) throw fail(404, 'CV introuvable.');
  const safeName = String(name || 'CV.pdf').replace(/[^\w.\- ]+/g, '');
  res.set({ 'Cache-Control': cacheControl, 'X-Robots-Tag': 'noindex', 'Content-Disposition': `inline; filename="${safeName}"` });
  return res.type(cvStorage.mimeOf(key) || 'application/pdf').send(data);
}

// Contact details (email, phone) are shown to admins and to recruiters with the verified badge
// only (anyone can open a recruiter account; the badge is checked by the team).
const seesContacts = (user) => !!user && !user.isBanned && (user.role === 'admin' || (user.role === 'recruiter' && !!user.isVerified));

// ---------- Public ----------

// Full-screen viewer, one CV per screen (swipe up/down on a phone, arrows on a computer).
async function viewer(req, res) {
  const items = await showcase.slider();
  const startId = Number(req.query.id) || null;
  if (startId && items.some((i) => i.id === startId)) await showcase.countView(startId);
  res.render('pages/cv/showcase', {
    layout: 'layouts/bare',
    title: 'Vitrine des CV',
    metaDescription: 'Découvrez les CV des candidats sur SenTravail, le réseau social de l’emploi au Sénégal.',
    noindex: true,
    noAds: true,
    items: items.map((r) => ({ r, ...showcase.publicImages(r) })),
    startId,
    seesContacts: seesContacts(req.user),
  });
}

async function publicPdf(req, res, next) {
  const item = await showcase.findVisible(parseId(req.params.id));
  if (!item) return next(fail(404, "Ce CV n'est plus disponible."));
  // Public copy: only builder CVs, published without contact details. An imported PDF keeps its
  // contact details, so the public only gets its images (contacts blacked out).
  if (item.source !== 'built') return next(fail(404, 'Le CV complet est réservé aux recruteurs.'));
  await showcase.countView(item.id);
  return sendFile(res, { key: item.cvKey, name: `CV-${item.id}.pdf` }, 'private, max-age=300');
}

// Complete CV with contact details: recruiters and admins (checked here, server-side).
async function fullPdf(req, res, next) {
  if (!seesContacts(req.user)) return next(fail(403, 'Le CV complet, avec les coordonnées, est réservé aux recruteurs vérifiés (badge bleu).'));
  const item = await showcase.findVisible(parseId(req.params.id));
  if (!item) return next(fail(404, "Ce CV n'est plus disponible."));
  await showcase.countView(item.id);
  return sendFile(res, await showcase.fullFile(item), 'private, no-store');
}

module.exports = { adminShowcase, adminBuilt, adminImported, adminAddMember, adminUpload, adminItemAction, adminImages, adminPdf, viewer, publicPdf, fullPdf, seesContacts, appUrl: env.APP_URL };
