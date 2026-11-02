const { Post, Job, Application } = require('../models');
const env = require('../config/env');
const { jobSchema, searchSchema } = require('../validators/job');
const { fieldErrors } = require('../validators/auth');
const jobs = require('../services/jobs');
const posts = require('../services/posts');
const { saveImage } = require('../services/storage');
const notifications = require('../services/notifications');
const moderation = require('../services/moderation');
const { absoluteUrl, imageUrl } = require('../utils/viewHelpers');
const { baseScore, refreshScore } = require('../services/feedRanking');
const { adjustCounter } = require('../utils/counters');
const { CITIES, SECTORS, CONTRACT_TYPES } = require('../config/constants');

const APPLY_LINK_VERIFIED = 'Le lien externe de candidature est réservé aux comptes vérifiés. Choisissez « Par email » ou demandez le badge vérifié.';
const formLocals = { CITIES, SECTORS, CONTRACT_TYPES, noAds: true };

function notFound() {
  const err = new Error("Cette offre n'existe pas ou n'est plus disponible.");
  err.status = 404;
  return err;
}

function forbidden() {
  const err = new Error("Vous ne pouvez pas modifier cette offre.");
  err.status = 403;
  return err;
}

const jobFields = (d) => ({
  title: d.title,
  companyName: d.companyName,
  location: d.location,
  contractType: d.contractType,
  sector: d.sector,
  salary: d.salary || null,
  description: d.description,
  requirements: null, // merged into the description (single field)
  benefits: null,
  applyMode: d.applyMode,
  applyEmail: d.applyMode === 'email' ? d.applyEmail : null,
  applyUrl: d.applyMode === 'link' ? d.applyUrl : null,
  deadline: d.deadline || null,
});

// ---------- Create ----------

function newForm(req, res) {
  const u = req.user;
  res.render('pages/jobs/form', {
    ...formLocals,
    title: 'Publier une offre',
    mode: 'create',
    errors: {},
    values: {
      companyName: u.companyName || '',
      applyMode: 'email',
      // Admins publish for other companies: no default email, so it is never forgotten.
      applyEmail: u.role === 'admin' ? '' : u.email,
      location: u.city || '',
      sector: u.sector || '',
      isOfficial: u.role === 'admin' ? 'on' : '',
    },
  });
}

async function create(req, res) {
  const body = req.body || {};
  const parsed = jobSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(422).render('pages/jobs/form', { ...formLocals, title: 'Publier une offre', mode: 'create', errors: fieldErrors(parsed.error), values: body });
  }
  const d = parsed.data;
  const isAdmin = req.user.role === 'admin';
  const texts = [d.title, d.companyName, d.description, d.salary, d.text];
  if (!moderation.canPostLinks(req.user) && moderation.hasExternalLink(texts)) {
    return res.status(422).render('pages/jobs/form', { ...formLocals, title: 'Publier une offre', mode: 'create', errors: { description: moderation.MESSAGES.link }, values: body });
  }
  if (d.applyMode === 'link' && !moderation.canPostLinks(req.user)) {
    return res.status(422).render('pages/jobs/form', { ...formLocals, title: 'Publier une offre', mode: 'create', errors: { applyUrl: APPLY_LINK_VERIFIED }, values: body });
  }
  const decision = await moderation.decidePublication(req.user, [...texts, d.applyMode === 'link' ? d.applyUrl : '']);

  // Logo = the recruiter's company logo; the uploaded file is the offer's own image.
  const companyLogo = req.user.companyLogo || (req.user.role === 'recruiter' ? req.user.avatarUrl : null) || null;
  const image = req.file ? await saveImage(req.file.buffer, 'jobs') : null;

  // Admin offers are official and featured by default; recruiters may request featuring.
  const official = isAdmin && d.isOfficial === 'on';
  const now = new Date();
  const post = await Post.create({
    authorId: req.user.id,
    type: 'job',
    text: d.text || null,
    visibility: 'public',
    ...decision,
    isFeatured: official,
    featuredUntil: official ? jobs.featuredUntilDate(now) : null,
    featureStatus: official ? 'approved' : d.requestFeatured === 'on' ? 'pending' : 'none',
    score: baseScore({ createdAt: now }),
  });
  const job = await Job.create({
    ...jobFields(d),
    postId: post.id,
    slug: jobs.buildSlug(d.title, d.location),
    companyLogo,
    image,
    isOfficial: official,
  });

  if (decision.status !== 'published') {
    req.flash('info', moderation.MESSAGES.pendingFilter);
    return res.redirect(job.url);
  }
  await notifications.notifyFollowersOfJob(req.user, post, job);
  req.flash(
    'success',
    post.featureStatus === 'pending'
      ? 'Offre publiée. Votre demande de mise à la une sera examinée par notre équipe.'
      : 'Offre publiée.'
  );
  return res.redirect(job.url);
}

// ---------- Show ----------

async function show(req, res, next) {
  const post = await jobs.findBySlug(req.params.slug);
  if (!post || !post.job || !posts.canView(post, req.user)) return next(notFound());
  if (!req.user || req.user.id !== post.authorId) {
    await adjustCounter(Post, post.id, 'viewsCount', 1);
    await refreshScore(post.id);
  }
  await posts.hydrate([post], req.user);
  const j = post.job;
  // Back from the mail app: reopen the "did you send it?" step for this offer.
  let pendingApplicationId = null;
  const mine = req.user ? { candidateId: req.user.id } : { id: req.session.applications || [] };
  if (req.user || req.session.applications?.length) {
    const pending = await Application.findOne({ where: { jobPostId: post.id, status: 'opened_mail', ...mine }, order: [['id', 'DESC']] });
    if (pending) pendingApplicationId = pending.id;
  }
  return res.render('pages/jobs/show', {
    pendingApplicationId,
    autoApply: req.query.postuler === '1' && !pendingApplicationId,
    title: `${j.title} — ${j.companyName} (${j.location})`,
    metaDescription: `${j.contractType} · ${j.location} · ${j.companyName}. ${j.description.replace(/\s+/g, ' ').slice(0, 120)}`,
    ogType: 'article',
    canonical: `${env.APP_URL}${j.url}`,
    post,
    job: j,
    canManage: jobs.canManage(post, req.user),
    jsonLd: jobPostingJsonLd(post),
    ...jobOgImage(j),
  });
}

// Link preview image (Facebook, WhatsApp…): the offer image, else the company logo.
function jobOgImage(j) {
  if (j.image) return { ogImage: absoluteUrl(imageUrl(j.image, 1200)), ogImageAlt: j.title, ogLargeImage: true };
  if (j.companyLogo) return { ogImage: absoluteUrl(imageUrl(j.companyLogo, 600)), ogImageAlt: `Logo ${j.companyName}` };
  return {};
}

function jobPostingJsonLd(post) {
  const j = post.job;
  const contractMap = { CDI: 'FULL_TIME', CDD: 'TEMPORARY', Stage: 'INTERN', Freelance: 'CONTRACTOR', 'Temps partiel': 'PART_TIME', Journalier: 'PER_DIEM' };
  const data = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: j.title,
    description: mergedDescription(j),
    datePosted: new Date(post.createdAt).toISOString().slice(0, 10),
    employmentType: contractMap[j.contractType],
    hiringOrganization: { '@type': 'Organization', name: j.companyName, ...(j.companyLogo ? { logo: j.companyLogo.startsWith('http') ? j.companyLogo : `${env.APP_URL}${j.companyLogo}` } : {}) },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: j.location, addressCountry: 'SN' } },
    industry: j.sector,
    directApply: j.applyMode !== 'link',
    url: `${env.APP_URL}${j.url}`,
  };
  if (j.deadline) data.validThrough = `${j.deadline}T23:59:59Z`;
  // Escape "<" so user text can never close the <script> tag.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

// ---------- Edit / delete ----------

async function loadManaged(req) {
  const post = await jobs.findBySlug(req.params.slug);
  if (!post || !post.job) throw notFound();
  if (!jobs.canManage(post, req.user)) throw forbidden();
  return post;
}

// Older offers had separate "profile" and "benefits" fields: shown together in the single description.
function mergedDescription(j) {
  return [j.description, j.requirements && `Profil recherché :\n${j.requirements}`, j.benefits && `Avantages :\n${j.benefits}`].filter(Boolean).join('\n\n');
}

async function editForm(req, res) {
  const post = await loadManaged(req);
  res.render('pages/jobs/form', {
    ...formLocals,
    title: "Modifier l'offre",
    mode: 'edit',
    job: post.job,
    errors: {},
    values: { ...post.job.get({ plain: true }), description: mergedDescription(post.job), text: post.text || '', isOfficial: post.job.isOfficial ? 'on' : '' },
  });
}

async function update(req, res) {
  const post = await loadManaged(req);
  const body = req.body || {};
  const parsed = jobSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(422).render('pages/jobs/form', {
      ...formLocals, title: "Modifier l'offre", mode: 'edit', job: post.job, errors: fieldErrors(parsed.error), values: body,
    });
  }
  const d = parsed.data;
  const texts = [d.title, d.companyName, d.description, d.salary, d.text];
  if (!moderation.canPostLinks(req.user) && moderation.hasExternalLink(texts)) {
    return res.status(422).render('pages/jobs/form', { ...formLocals, title: "Modifier l'offre", mode: 'edit', job: post.job, errors: { description: moderation.MESSAGES.link }, values: body });
  }
  if (d.applyMode === 'link' && !moderation.canPostLinks(req.user)) {
    return res.status(422).render('pages/jobs/form', { ...formLocals, title: "Modifier l'offre", mode: 'edit', job: post.job, errors: { applyUrl: APPLY_LINK_VERIFIED }, values: body });
  }
  // An edit introducing banned terms sends the offer back to moderation.
  const found = req.user.role === 'admin' ? [] : await moderation.findBannedTerms([...texts, d.applyMode === 'link' ? d.applyUrl : '']);
  if (found.length) await post.update({ status: 'pending_approval', moderationReason: 'filter', moderationNote: `Termes détectés : ${found.join(', ')}`.slice(0, 300) });
  const changes = jobFields(d);
  if (req.file) changes.image = await saveImage(req.file.buffer, 'jobs');
  else if (body.removeImage === 'on') changes.image = null;
  await post.job.update(changes); // slug is kept so shared links keep working
  await post.update({ text: d.text || null });
  req.flash('success', 'Offre mise à jour.');
  return res.redirect(post.job.url);
}

async function destroy(req, res) {
  const post = await loadManaged(req);
  await post.destroy(); // job, reactions, comments and saves cascade
  req.flash('success', 'Offre supprimée.');
  return res.redirect(req.user.role === 'admin' && req.user.id !== post.authorId ? '/offres' : '/mes-offres');
}

// ---------- Search & lists ----------

async function index(req, res) {
  const filters = searchSchema.parse(req.query);
  const result = await jobs.search(filters, req.user);
  const locals = { ...result, filters, page: filters.page, CITIES, SECTORS, CONTRACT_TYPES };
  if (req.get('HX-Request') && filters.page > 1) {
    return res.render('partials/jobResults', { layout: false, ...locals });
  }
  const parts = [filters.q, filters.contrat, filters.secteur, filters.ville && `à ${filters.ville}`].filter(Boolean);
  return res.render('pages/jobs/index', {
    title: parts.length ? `Offres d'emploi : ${parts.join(' · ')}` : "Offres d'emploi au Sénégal",
    metaDescription: `${result.total} offres d'emploi au Sénégal${filters.ville ? ` à ${filters.ville}` : ''} : CDI, CDD, stages… Postulez gratuitement sur SenTravail.`,
    activeTab: 'jobs',
    ...locals,
  });
}

async function mine(req, res) {
  const list = await Post.findAll({
    where: { authorId: req.user.id, type: 'job' },
    include: [{ model: Job, as: 'job', required: true }],
    order: [['createdAt', 'DESC']],
    limit: 100,
  });
  const counts = await require('./applicationController').countsByJob(list.map((p) => p.id));
  res.render('pages/jobs/mine', { title: 'Mes offres', noAds: true, posts: list, counts });
}

async function byRecruiter(user, viewer) {
  // Job offers are public pages (SEO), so the profile lists all published ones.
  const own = viewer && (viewer.id === user.id || viewer.role === 'admin');
  const list = await Post.findAll({
    where: { authorId: user.id, type: 'job', ...(own ? {} : { status: 'published' }) },
    include: posts.postInclude(),
    order: [['createdAt', 'DESC']],
    limit: 30,
  });
  return posts.hydrate(list, viewer);
}

async function sidebarFeatured(req, res) {
  const list = await jobs.featuredJobs(req.user, 4);
  res.set('Cache-Control', 'private, max-age=60');
  res.render('partials/featuredSidebar', { layout: false, posts: list });
}

module.exports = { sidebarFeatured, newForm, create, show, editForm, update, destroy, index, mine, byRecruiter, jobPostingJsonLd };
