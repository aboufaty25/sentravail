const { User } = require('../models');
const { profileSchema } = require('../validators/profile');
const { fieldErrors } = require('../validators/auth');
const { CITIES, SECTORS } = require('../config/constants');

async function show(req, res, next) {
  const profileUser = await User.findOne({ where: { username: req.params.username } });
  if (!profileUser || profileUser.isBanned) {
    const err = new Error("Ce profil n'existe pas ou n'est plus disponible.");
    err.status = 404;
    return next(err);
  }
  const isOwner = !!req.user && req.user.id === profileUser.id;
  return res.render('pages/profile/show', {
    title: `${profileUser.displayName}${profileUser.headline ? ` — ${profileUser.headline}` : ''}`,
    metaDescription: profileUser.bio ? profileUser.bio.slice(0, 160) : `Profil de ${profileUser.displayName} sur SenTravail.`,
    profileUser,
    isOwner,
    tab: req.query.onglet || 'publications',
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
    firstName: data.firstName,
    lastName: data.lastName,
    headline: data.headline || null,
    bio: data.bio || null,
    city: data.city || null,
    sector: data.sector || null,
    skills: data.skills,
    phone: data.phone,
    companyName: req.user.role === 'recruiter' ? data.companyName || null : req.user.companyName,
  });
  req.flash('success', 'Profil mis à jour.');
  return res.redirect(`/profil/${req.user.username}`);
}

module.exports = { show, editForm, update };
