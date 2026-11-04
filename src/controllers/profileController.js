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
  const isAdmin = req.user.role === 'admin'; // always shown as the SenTravail team: names unchanged
  const nameErrors = {};
  if (isRecruiter && data.companyName.length < 2) nameErrors.companyName = "Indiquez le nom de votre entreprise.";
  if (!isRecruiter && !isAdmin && data.firstName.length < 2) nameErrors.firstName = 'Prénom : 2 caractères minimum.';
  if (!isRecruiter && !isAdmin && data.lastName.length < 2) nameErrors.lastName = 'Nom : 2 caractères minimum.';
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
    ...(isAdmin ? {} : { firstName: isRecruiter ? data.companyName.slice(0, 60) : data.firstName, lastName: isRecruiter ? '' : data.lastName }),
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

// ---------- Profile photo and cover ----------
const { saveImage, removeLocalMedia } = require('../services/storage');
const { safeReturn } = require('../utils/returnTo');
const { Job } = require('../models');
const { Op } = require('sequelize');

const PHOTO_FIELDS = { photo: 'avatarUrl', couverture: 'coverUrl' };

// Deletes an old local image unless it is still used (offers keep a copy of the logo URL).
async function removeIfUnused(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const inJobs = await Job.count({ where: { [Op.or]: [{ companyLogo: url }, { image: url }] } });
  const inUsers = await User.count({ where: { [Op.or]: [{ avatarUrl: url }, { coverUrl: url }, { companyLogo: url }] } });
  if (!inJobs && !inUsers) await removeLocalMedia([url]);
}

async function updatePhoto(req, res) {
  const field = PHOTO_FIELDS[req.params.kind];
  if (!field) return res.status(404).end();
  const back = safeReturn(req.body?.retour) || `/profil/${req.user.username}`;
  const u = req.user;
  const old = u[field];
  if (req.body?.action === 'remove') {
    const changes = { [field]: null };
    if (field === 'avatarUrl' && u.role === 'recruiter' && u.companyLogo === old) changes.companyLogo = null;
    await u.update(changes);
    await removeIfUnused(old);
    req.flash('success', field === 'avatarUrl' ? 'Photo de profil retirée.' : 'Photo de couverture retirée.');
    return res.redirect(back);
  }
  if (!req.file) {
    req.flash('error', 'Choisissez une image (JPEG, PNG ou WebP, 2 Mo maximum).');
    return res.redirect(back);
  }
  const url = await saveImage(req.file.buffer, field === 'avatarUrl' ? 'avatars' : 'covers');
  const changes = { [field]: url };
  // For a recruiter, the profile photo is the company logo shown on new offers.
  if (field === 'avatarUrl' && u.role === 'recruiter' && (!u.companyLogo || u.companyLogo === old)) changes.companyLogo = url;
  await u.update(changes);
  await removeIfUnused(old);
  req.flash('success', field === 'avatarUrl' ? 'Photo de profil mise à jour.' : 'Photo de couverture mise à jour.');
  return res.redirect(back);
}

module.exports.updatePhoto = updatePhoto;
