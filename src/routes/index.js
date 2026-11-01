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
const reel = require('../controllers/reelController');
const report = require('../controllers/reportController');
const admin = require('../controllers/adminController');
const { authLimiter, postLimiter, commentLimiter, actionLimiter, applyLimiter, serverMailLimiter, cvBuildLimiter } = require('../middlewares/rateLimit');
const { imageUpload, cvUpload, reelUpload, handleUploadErrors } = require('../middlewares/upload');

const recruiterOnly = [requireAuth, requireRole('recruiter', 'admin')];
const logoUpload = handleUploadErrors(imageUpload.single('companyLogo'));

const router = express.Router();

router.get('/', pages.home);

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
router.get('/publier', requireAuth, (req, res, next) => {
  if (req.query.type === 'job') return res.redirect('/offres/nouvelle');
  if (req.query.type === 'reel') return res.redirect('/reels/nouveau');
  return next();
}, post.newForm);
router.post('/publier', requireAuth, postLimiter, handleUploadErrors(imageUpload.array('photos', 4)), post.create);
router.get('/publications/:id', post.show);
router.post('/publications/:id/supprimer', requireAuth, post.destroy);
router.post('/publications/:id/reaction', requireAuth, actionLimiter, post.react);
router.post('/publications/:id/enregistrer', requireAuth, actionLimiter, post.toggleSave);
router.post('/publications/:id/partager', requireAuth, postLimiter, post.share);
router.get('/enregistrements', requireAuth, post.savedList);

// Jobs (static paths before /offres/:slug)
router.get('/offres', job.index);
router.get('/offres-a-la-une', job.sidebarFeatured);
router.get('/offres/nouvelle', ...recruiterOnly, job.newForm);
router.post('/offres/nouvelle', ...recruiterOnly, postLimiter, logoUpload, job.create);
router.get('/offres/:slug', job.show);
router.get('/offres/:slug/modifier', requireAuth, job.editForm);
router.post('/offres/:slug/modifier', requireAuth, logoUpload, job.update);
router.post('/offres/:slug/supprimer', requireAuth, job.destroy);
router.get('/mes-offres', ...recruiterOnly, job.mine);

// Applications
const cvFile = handleUploadErrors(cvUpload.single('cv'));
router.post('/offres/:slug/postuler', applyLimiter, cvFile, application.apply);
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
// CV builder: open to guests too (used from the apply modal)
router.get('/cv/creer', cv.builder);
router.post('/cv/creer', cvBuildLimiter, cv.save);
router.post('/cv/photo', cvBuildLimiter, handleUploadErrors(imageUpload.single('photo')), cv.uploadPhoto);

// Comments
router.get('/publications/:id/commentaires', comment.list);
router.post('/publications/:id/commentaires', requireAuth, commentLimiter, comment.create);
router.post('/commentaires/:commentId/supprimer', requireAuth, comment.destroy);
router.post('/commentaires/:commentId/jaime', requireAuth, actionLimiter, comment.toggleLike);

// App tabs
router.get('/menu', requireAuth, pages.menu);
router.get('/reels', reel.index);
router.get('/reels/suite', reel.more);
router.get('/reels/nouveau', requireAuth, reel.newForm);
router.post('/reels', requireAuth, postLimiter, handleUploadErrors(reelUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }])), reel.create);
router.post('/reels/:id/jaime', requireAuth, actionLimiter, reel.like);
router.post('/reels/:id/vue', reel.view);
router.get('/reseau', requireAuth, network.network);
router.get('/reseau/suggestions', network.sidebarSuggestions);
router.post('/abonnements/:id', requireAuth, actionLimiter, network.toggle);
router.get('/abonnements/:id/bouton', requireAuth, network.button);
router.get('/profil/:username/abonnes', (req, res, next) => network.lists(Object.assign(req, { params: { ...req.params, list: 'abonnes' } }), res, next));
router.get('/profil/:username/abonnements', (req, res, next) => network.lists(Object.assign(req, { params: { ...req.params, list: 'abonnements' } }), res, next));
router.get('/notifications', requireAuth, pages.upcoming('notifications'));
router.get('/recherche', search.index);
// Reports (any logged-in user)
router.post('/signalements', requireAuth, actionLimiter, report.create);

// Administration (admin only, checked server-side on every route)
const adminOnly = [requireAuth, requireRole('admin')];
router.get('/admin', ...adminOnly, admin.dashboard);
router.get('/admin/offres', ...adminOnly, admin.featureQueue);
router.post('/admin/offres/:id/approuver', ...adminOnly, admin.approveFeature);
router.post('/admin/offres/:id/refuser', ...adminOnly, admin.rejectFeature);
router.post('/admin/offres/:id/retirer', ...adminOnly, admin.unfeature);
router.get('/admin/signalements', ...adminOnly, admin.reportsIndex);
router.post('/admin/signalements/:type/:id', ...adminOnly, admin.reportAction);
router.get('/admin/utilisateurs', ...adminOnly, admin.usersIndex);
router.post('/admin/utilisateurs/:id', ...adminOnly, admin.userAction);
router.get('/admin/referentiels', ...adminOnly, admin.refsIndex);
router.post('/admin/referentiels', ...adminOnly, admin.refsAdd);
router.post('/admin/referentiels/:id', ...adminOnly, admin.refsUpdate);

// Legal & information pages (required by AdSense)
router.get('/a-propos', pages.staticPage('about'));
router.get('/contact', pages.staticPage('contact'));
router.get('/confidentialite', pages.staticPage('privacy'));
router.get('/conditions', pages.staticPage('terms'));

module.exports = router;
