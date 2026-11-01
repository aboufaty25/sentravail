const { Post, Job, Save } = require('../models');
const env = require('../config/env');
const { jobSchema, searchSchema } = require('../validators/job');
const { fieldErrors } = require('../validators/auth');
const jobs = require('../services/jobs');
const posts = require('../services/posts');
const { saveImage } = require('../services/storage');
const { baseScore, refreshScore } = require('../services/feedRanking');
const { adjustCounter } = require('../utils/counters');
const { CITIES, SECTORS, CONTRACT_TYPES } = require('../config/constants');

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
  requirements: d.requirements || null,
  benefits: d.benefits || null,
  applyEmail: d.applyEmail,
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
      applyEmail: u.email,
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

  let companyLogo = req.user.companyLogo || null;
  if (req.file) {
    companyLogo = await saveImage(req.file.buffer, 'logos');
    if (req.user.role === 'recruiter' && !req.user.companyLogo) await req.user.update({ companyLogo });
  }

  // Admin offers are official and featured by default; recruiters may request featuring.
  const official = isAdmin && d.isOfficial === 'on';
  const now = new Date();
  const post = await Post.create({
    authorId: req.user.id,
    type: 'job',
    text: d.text || null,
    visibility: 'public',
    status: 'published',
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
    isOfficial: official,
  });

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
  return res.render('pages/jobs/show', {
    title: `${j.title} — ${j.companyName} (${j.location})`,
    metaDescription: `${j.contractType} · ${j.location} · ${j.companyName}. ${j.description.replace(/\s+/g, ' ').slice(0, 120)}`,
    ogType: 'article',
    canonical: `${env.APP_URL}${j.url}`,
    post,
    job: j,
    canManage: jobs.canManage(post, req.user),
    jsonLd: jobPostingJsonLd(post),
  });
}

function jobPostingJsonLd(post) {
  const j = post.job;
  const contractMap = { CDI: 'FULL_TIME', CDD: 'TEMPORARY', Stage: 'INTERN', Freelance: 'CONTRACTOR', 'Temps partiel': 'PART_TIME', Journalier: 'PER_DIEM' };
  const data = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: j.title,
    description: [j.description, j.requirements && `Profil recherché :\n${j.requirements}`, j.benefits && `Avantages :\n${j.benefits}`]
      .filter(Boolean)
      .join('\n\n'),
    datePosted: new Date(post.createdAt).toISOString().slice(0, 10),
    employmentType: contractMap[j.contractType],
    hiringOrganization: { '@type': 'Organization', name: j.companyName, ...(j.companyLogo ? { logo: j.companyLogo.startsWith('http') ? j.companyLogo : `${env.APP_URL}${j.companyLogo}` } : {}) },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: j.location, addressCountry: 'SN' } },
    industry: j.sector,
    directApply: true,
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

async function editForm(req, res) {
  const post = await loadManaged(req);
  res.render('pages/jobs/form', {
    ...formLocals,
    title: "Modifier l'offre",
    mode: 'edit',
    job: post.job,
    errors: {},
    values: { ...post.job.get({ plain: true }), text: post.text || '', isOfficial: post.job.isOfficial ? 'on' : '' },
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
  const changes = jobFields(d);
  if (req.file) changes.companyLogo = await saveImage(req.file.buffer, 'logos');
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
  res.render('pages/jobs/mine', { title: 'Mes offres', noAds: true, posts: list });
}

async function byRecruiter(user, viewer) {
  const list = await Post.findAll({
    where: { authorId: user.id, type: 'job', ...posts.visibleWhere(viewer) },
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
