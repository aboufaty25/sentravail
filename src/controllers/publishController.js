const { Post } = require('../models');
const { TYPES, EVENT_KINDS, AVAILABILITIES, typeBySlug, cannotCreate } = require('../config/postTypes');
const { schemasByType, toPostFields } = require('../validators/post');
const { fieldErrors } = require('../validators/auth');
const { CITIES } = require('../config/constants');
const { saveImage } = require('../services/storage');
const { baseScore } = require('../services/feedRanking');
const moderation = require('../services/moderation');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// "Quoi de neuf ?" → choice of publication type (only the allowed ones are active).
function choose(req, res) {
  const options = Object.entries(TYPES).map(([key, t]) => ({ key, ...t, href: key === 'job' ? '/offres/nouvelle' : `/publier/${t.slug}`, blocked: cannotCreate(key, req.user) }));
  res.render('pages/publish/choose', { title: 'Publier', noAds: true, options });
}

function resolveType(req) {
  const t = typeBySlug(req.params.type);
  if (!t) throw httpError(404, 'Type de publication inconnu.');
  return t;
}

function renderForm(res, type, { values = {}, errors = {}, status = 200 } = {}) {
  return res.status(status).render('pages/publish/form', {
    title: type.label, noAds: true, type, values, errors, CITIES, EVENT_KINDS, AVAILABILITIES,
  });
}

function form(req, res) {
  const type = resolveType(req);
  if (type.key === 'job') return res.redirect('/offres/nouvelle');
  const blocked = cannotCreate(type.key, req.user);
  if (blocked) throw httpError(403, blocked);
  return renderForm(res, type, { values: { city: req.user.city || '' } });
}

async function create(req, res) {
  const type = resolveType(req);
  if (type.key === 'job') throw httpError(404, 'Utilisez le formulaire des offres.');
  const blocked = cannotCreate(type.key, req.user);
  if (blocked) throw httpError(403, blocked);

  const body = req.body || {};
  const parsed = schemasByType[type.key].safeParse(body);
  if (!parsed.success) return renderForm(res, type, { values: body, errors: fieldErrors(parsed.error), status: 422 });

  const fields = toPostFields(type.key, parsed.data);
  const texts = [fields.title, fields.text, fields.details?.place, fields.details?.company];

  // Guardrails (server-side): links, daily limit, filter and trust level.
  if (!moderation.canPostLinks(req.user) && moderation.hasExternalLink(texts)) {
    return renderForm(res, type, { values: body, errors: { _form: moderation.MESSAGES.link }, status: 422 });
  }
  if (type.key === 'job_search' && (await moderation.jobSearchPostedToday(req.user.id))) {
    return renderForm(res, type, { values: body, errors: { _form: moderation.MESSAGES.jobSearchDaily }, status: 429 });
  }
  const decision = await moderation.decidePublication(req.user, texts);

  const mediaUrls = [];
  if (req.file) {
    if (!type.image) return renderForm(res, type, { values: body, errors: { image: "Ce type de publication n'accepte pas d'image." }, status: 422 });
    mediaUrls.push(await saveImage(req.file.buffer, 'posts'));
  }
  const now = new Date();
  const post = await Post.create({
    ...fields,
    authorId: req.user.id,
    type: type.key,
    mediaUrls,
    visibility: parsed.data.visibility,
    ...decision,
    score: baseScore({ createdAt: now }),
  });
  if (decision.status !== 'published') {
    req.flash('info', moderation.MESSAGES.pendingFilter);
    return res.redirect(`/publications/${post.id}`);
  }
  req.flash('success', 'Publication partagée.');
  return res.redirect(`/?nouveau=${post.id}`);
}

module.exports = { choose, form, create };
