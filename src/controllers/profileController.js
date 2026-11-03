const { User } = require('../models');
const { profileSchema } = require('../validators/profile');
const { fieldErrors } = require('../validators/auth');
const { CITIES, SECTORS } = require('../config/constants');
const { byAuthor } = require('./postController');
const { byRecruiter } = require('./jobController');
const { isFollowing } = require('../services/follows');
const env = require('../config/env');
const { absoluteUrl } = require('../utils/viewHelpers');

async function show(req, res, next) {
  const profileUser = await User.findOne({ where: { username: req.params.username } });
  if (!profileUser || profileUser.isBanned) {
    const err = new Error("Ce profil n'existe pas ou n'est plus disponible.");
    err.status = 404;
    return next(err);
  }
  const isOwner = !!req.user && req.user.id === profileUser.id;
  const tab = req.query.onglet || 'publications';
  let posts = [];
  if (tab === 'publications') posts = await byAuthor(profileUser, req.user);
  else if (tab === 'offres') posts = await byRecruiter(profileUser, req.user);
  return res.render('pages/profile/show', {
    title: `${profileUser.displayName}${profileUser.headline ? ` — ${profileUser.headline}` : ''}`,
    metaDescription: profileUser.bio ? profileUser.bio.slice(0, 160) : `Profil de ${profileUser.displayName} sur SenTravail.`,
    profileUser,
    isOwner,
    tab,
    posts,
    followsProfile: await isFollowing(req.user?.id, profileUser.id),
    ogType: 'profile',
    canonical: `${env.APP_URL}/profil/${profileUser.username}`,
    ...(profileUser.avatarUrl ? { ogImage: absoluteUrl(profileUser.avatarUrl) } : {}),
  });
}

function editForm(req, res) {
  const u = req.user;
  res.render('pages/profile/edit', {
    title: 'Modifier mon profil',
    noAds: true,
    values: { ...u.get({ plain: true }), skills: u.skills.join(', ') },
    errors: {},
    CITIES,
    SECTORS,
  });
}

async function update(req, res) {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).render('pages/profile/edit', {
      title: 'Modifier mon profil', noAds: true, values: req.body, errors: fieldErrors(parsed.error), CITIES, SECTORS,
    });
  }
  const data = parsed.data;
  const isRecruiter = req.user.role === 'recruiter';
  const nameErrors = {};
  if (isRecruiter && data.companyName.length < 2) nameErrors.companyName = "Indiquez le nom de votre entreprise.";
  if (!isRecruiter && data.firstName.length < 2) nameErrors.firstName = 'Prénom : 2 caractères minimum.';
  if (!isRecruiter && data.lastName.length < 2) nameErrors.lastName = 'Nom : 2 caractères minimum.';
  if (Object.keys(nameErrors).length) {
    return res.status(422).render('pages/profile/edit', { title: 'Modifier mon profil', noAds: true, values: req.body, errors: nameErrors, CITIES, SECTORS });
  }
  if (data.phone && data.phone !== req.user.phone) {
    const taken = await User.findOne({ where: { phone: data.phone }, attributes: ['id'] });
    if (taken) {
      return res.status(422).render('pages/profile/edit', {
        title: 'Modifier mon profil', noAds: true, values: req.body, errors: { phone: 'Ce numéro est déjà utilisé.' }, CITIES, SECTORS,
      });
    }
  }
  // Only whitelisted fields are written; role/isVerified/etc. can never be changed here.
  await req.user.update({
    // A recruiter account is named after the company.
    firstName: isRecruiter ? data.companyName.slice(0, 60) : data.firstName,
    lastName: isRecruiter ? '' : data.lastName,
    headline: data.headline || null,
    bio: data.bio || null,
    city: data.city || null,
    sector: data.sector || null,
    skills: data.skills,
    phone: data.phone,
    companyName: isRecruiter ? data.companyName : req.user.companyName,
  });
  req.flash('success', 'Profil mis à jour.');
  return res.redirect(`/profil/${req.user.username}`);
}

module.exports = { show, editForm, update };
