const { cvSchema, LANGUAGE_LEVELS } = require('../validators/cv');
const { fieldErrors } = require('../validators/auth');
const { buildCvPdf, period } = require('../services/cvPdf');
const cvStorage = require('../services/cvStorage');
const { saveImage } = require('../services/storage');

const { safeReturn } = require('../utils/returnTo');

// Initial builder data: saved CV, else what we know from the profile.
function initialData(user) {
  if (user?.cvBuilt) return user.cvBuilt;
  const empty = { template: 'classic', personal: { firstName: '', lastName: '', email: '', phone: '', city: '', photoUrl: '' }, title: '', summary: '', experiences: [], educations: [], skills: [], languages: [] };
  if (!user) return empty;
  return {
    ...empty,
    personal: { firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone || '', city: user.city || '', photoUrl: user.avatarUrl || '' },
    title: user.headline || '',
    summary: user.bio || '',
    skills: user.skills || [],
  };
}

function builder(req, res) {
  res.render('pages/cv/builder', {
    title: 'Créer mon CV',
    noAds: true,
    wide: true,
    initial: initialData(req.user),
    hasSaved: !!req.user?.cvBuilt,
    returnTo: safeReturn(req.query.retour),
    LANGUAGE_LEVELS,
  });
}

// Saves the CV, generates the PDF and makes it the CV used for applications.
async function save(req, res) {
  const parsed = cvSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(422).json({ errors: fieldErrors(parsed.error), error: issue.message, path: issue.path.join('.') });
  }
  const cv = parsed.data;
  const pdf = await buildCvPdf(cv);
  const fileName = `CV ${cv.personal.firstName} ${cv.personal.lastName}.pdf`;
  const stored = await cvStorage.saveCv(pdf, fileName);

  {
    const u = req.user;
    await u.update({
      cvBuilt: cv,
      cvUrl: stored.key,
      cvName: stored.name,
      // Keep the public profile in sync with the CV.
      headline: u.headline || cv.title,
      bio: u.bio || cv.summary || null,
      city: u.city || cv.personal.city || null,
      skills: cv.skills,
      experiences: cv.experiences.map((e) => ({ title: e.title, company: e.company, period: period(e) })),
      educations: cv.educations.map((e) => ({ degree: e.degree, school: e.school, period: period(e) })),
      languages: cv.languages.map((l) => `${l.name} (${l.level.toLowerCase()})`),
    });
  }

  return res.json({
    ok: true,
    downloadPath: cvStorage.signedPath(stored.key, stored.name, 1),
    returnTo: safeReturn(req.body.returnTo),
    message: 'CV enregistré. Il sera utilisé pour vos prochaines candidatures.',
  });
}

async function uploadPhoto(req, res) {
  if (!req.file) return res.status(422).json({ error: 'Choisissez une photo.' });
  const url = await saveImage(req.file.buffer, 'cv-photos');
  return res.json({ url });
}

module.exports = { builder, save, uploadPhoto, safeReturn, initialData };
