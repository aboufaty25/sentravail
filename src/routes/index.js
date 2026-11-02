const express = require('express');
const auth = require('../controllers/authController');
const profile = require('../controllers/profileController');
const pages = require('../controllers/pageController');
const { requireAuth, requireGuest } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const post = require('../controllers/postController');
const comment = require('../controllers/commentController');
const job = require('../controllers/jobController');
const application = require('../controllers/applicationController');
const cv = require('../controllers/cvController');
const network = require('../controllers/followController');
const search = require('../controllers/searchController');
const report = require('../controllers/reportController');
const admin = require('../controllers/adminController');
const notification = require('../controllers/notificationController');
const verification = require('../controllers/verificationController');
const seo = require('../controllers/seoController');
const publish = require('../controllers/publishController');
const events = require('../controllers/eventController');
const { authLimiter, postLimiter, commentLimiter, actionLimiter, applyLimiter, serverMailLimiter, cvBuildLimiter } = require('../middlewares/rateLimit');
const { imageUpload, brandingImageUpload, jobImagesUpload, cvUpload, handleUploadErrors } = require('../middlewares/upload');

const recruiterOnly = [requireAuth, requireRole('recruiter', 'admin')];
// Job form: the offer image and the company logo (one file each).
const jobUpload = handleUploadErrors(jobImagesUpload.fields([{ name: 'image', maxCount: 1 }, { name: 'companyLogo', maxCount: 1 }]));
// Branding: one image, plus the 192 px icon generated in the browser for the app icon.
const brandingUpload = handleUploadErrors(brandingImageUpload.fields([{ name: 'image', maxCount: 1 }, { name: 'icon192', maxCount: 1 }]));

const router = express.Router();

router.get('/', pages.home);

// Health check (uptime monitoring): app + database
router.get('/sante', async (req, res) => {
  try {
    await require('../models').sequelize.query('SELECT 1');
    res.set('Cache-Control', 'no-store').json({ status: 'ok', uptime: Math.round(process.uptime()) });
  } catch (_) {
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

// SEO & AdSense files
router.get('/robots.txt', seo.robots);
router.get('/sitemap.xml', seo.sitemap);
router.get('/ads.txt', seo.adsTxt);

// Auth
router.get('/inscription', requireGuest, auth.showRegister);
router.post('/inscription', requireGuest, authLimiter, auth.register);
router.get('/connexion', requireGuest, auth.showLogin);
router.post('/connexion', requireGuest, authLimiter, auth.login);
router.post('/deconnexion', auth.logout);
router.get('/mot-de-passe-oublie', requireGuest, auth.showForgot);
router.post('/mot-de-passe-oublie', requireGuest, authLimiter, auth.forgot);
router.get('/reinitialiser/:token', auth.showReset);
router.post('/reinitialiser/:token', authLimiter, auth.reset);

// Profile
router.get('/profil/:username', profile.show);
router.get('/parametres/profil', requireAuth, profile.editForm);
router.post('/parametres/profil', requireAuth, profile.update);

// Feed & posts
router.get('/fil', post.feed);
router.get('/publier', requireAuth, publish.choose);
router.get('/publier/:type', requireAuth, publish.form);
router.post('/publier/:type', requireAuth, postLimiter, handleUploadErrors(imageUpload.single('image')), publish.create);
router.get('/publications/:id', post.show);
router.post('/publications/:id/supprimer', requireAuth, post.destroy);
router.post('/publications/:id/reaction', requireAuth, actionLimiter, post.react);
router.post('/publications/:id/enregistrer', requireAuth, actionLimiter, post.toggleSave);
router.post('/publications/:id/partager', requireAuth, postLimiter, post.share);
router.get('/enregistrements', requireAuth, post.savedList);

// Jobs (static paths before /offres/:slug)
router.get('/evenements', events.index);
router.get('/offres', job.index);
router.get('/offres-a-la-une', job.sidebarFeatured);
router.get('/offres/nouvelle', ...recruiterOnly, job.newForm);
router.post('/offres/nouvelle', ...recruiterOnly, postLimiter, jobUpload, job.create);
router.get('/offres/:slug', job.show);
router.get('/offres/:slug/modifier', requireAuth, job.editForm);
router.post('/offres/:slug/modifier', requireAuth, jobUpload, job.update);
router.post('/offres/:slug/supprimer', requireAuth, job.destroy);
router.get('/mes-offres', ...recruiterOnly, job.mine);

// Applications
const cvFile = handleUploadErrors(cvUpload.single('cv'));
router.post('/offres/:slug/postuler', ...applyLimiter, cvFile, application.apply);
router.post('/candidatures/:id/confirmer', application.confirm);
router.post('/candidatures/:id/envoyer', serverMailLimiter, application.sendViaServer);
router.post('/candidatures/:id/mailto', application.mailto);
router.get('/mes-candidatures', requireAuth, application.mine);
router.get('/mes-offres/:slug/candidatures', ...recruiterOnly, application.forJob);
router.get('/candidatures/:id', ...recruiterOnly, application.show);
router.post('/candidatures/:id/statut', ...recruiterOnly, application.setStatus);

// CV
router.get('/cv', requireAuth, application.myCv);
router.post('/cv/importer', requireAuth, cvFile, application.uploadMyCv);
router.post('/cv/retirer', requireAuth, application.removeMyCv);
router.get('/cv/telecharger', application.downloadCv);
// CV builder: members only (the apply modal asks guests to log in)
router.get('/cv/creer', requireAuth, cv.builder);
router.post('/cv/creer', requireAuth, cvBuildLimiter, cv.save);
router.post('/cv/photo', requireAuth, cvBuildLimiter, handleUploadErrors(imageUpload.single('photo')), cv.uploadPhoto);

// Comments
router.get('/publications/:id/commentaires', comment.list);
router.post('/publications/:id/commentaires', requireAuth, commentLimiter, comment.create);
router.post('/commentaires/:commentId/supprimer', requireAuth, comment.destroy);
router.post('/commentaires/:commentId/jaime', requireAuth, actionLimiter, comment.toggleLike);

// App tabs
router.get('/menu', pages.menu);
router.get('/reseau', requireAuth, network.network);
router.get('/reseau/suggestions', network.sidebarSuggestions);
router.post('/abonnements/:id', requireAuth, actionLimiter, network.toggle);
router.get('/abonnements/:id/bouton', requireAuth, network.button);
router.get('/profil/:username/abonnes', (req, res, next) => network.lists(Object.assign(req, { params: { ...req.params, list: 'abonnes' } }), res, next));
router.get('/profil/:username/abonnements', (req, res, next) => network.lists(Object.assign(req, { params: { ...req.params, list: 'abonnements' } }), res, next));
router.get('/notifications', requireAuth, notification.index);
router.post('/notifications/tout-lire', requireAuth, notification.readAll);
router.get('/notifications/:id', requireAuth, notification.open);
router.get('/parametres/verification', requireAuth, verification.show);
router.post('/parametres/verification', requireAuth, authLimiter, verification.request);
router.get('/verification/confirmer/:token', verification.confirmEmail);
router.get('/parametres/notifications', requireAuth, notification.settings);
router.post('/parametres/notifications', requireAuth, notification.saveSettings);
router.get('/recherche', search.index);
// Reports (any logged-in user)
router.post('/signalements', requireAuth, actionLimiter, report.create);

// Administration (admin only, checked server-side on every route)
const adminOnly = [requireAuth, requireRole('admin'), admin.adminCounts];
router.get('/admin', ...adminOnly, admin.dashboard);
router.get('/admin/offres', ...adminOnly, admin.featureQueue);
router.post('/admin/offres/:id/approuver', ...adminOnly, admin.approveFeature);
router.post('/admin/offres/:id/refuser', ...adminOnly, admin.rejectFeature);
router.post('/admin/offres/:id/retirer', ...adminOnly, admin.unfeature);
router.get('/admin/signalements', ...adminOnly, admin.reportsIndex);
router.post('/admin/signalements/:type/:id', ...adminOnly, admin.reportAction);
router.get('/admin/utilisateurs', ...adminOnly, admin.usersIndex);
router.post('/admin/utilisateurs/:id', ...adminOnly, admin.userAction);
router.get('/admin/moderation', ...adminOnly, admin.moderationQueue);
router.get('/admin/moderation/:tab', ...adminOnly, admin.moderationQueue);
router.post('/admin/moderation/publications/:id', ...adminOnly, admin.moderatePost);
router.post('/admin/moderation/commentaires/:id', ...adminOnly, admin.moderateComment);
router.get('/admin/verifications', ...adminOnly, admin.verificationsIndex);
router.post('/admin/verifications/:id', ...adminOnly, admin.verificationDecision);
router.get('/admin/filtre', ...adminOnly, admin.filterIndex);
router.post('/admin/filtre', ...adminOnly, admin.filterUpdate);
router.get('/admin/referentiels', ...adminOnly, admin.refsIndex);
router.get('/admin/apparence', ...adminOnly, admin.brandingIndex);
router.post('/admin/apparence/:asset', ...adminOnly, brandingUpload, admin.brandingUpdate);
router.post('/admin/referentiels', ...adminOnly, admin.refsAdd);
router.post('/admin/referentiels/:id', ...adminOnly, admin.refsUpdate);

// Legal & information pages (required by AdSense)
router.get('/a-propos', pages.staticPage('about'));
router.get('/contact', pages.staticPage('contact'));
router.get('/confidentialite', pages.staticPage('privacy'));
router.get('/conditions', pages.staticPage('terms'));

module.exports = router;
