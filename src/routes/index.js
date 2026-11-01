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
const { authLimiter, postLimiter, commentLimiter, actionLimiter, applyLimiter, serverMailLimiter } = require('../middlewares/rateLimit');
const { imageUpload, cvUpload, handleUploadErrors } = require('../middlewares/upload');

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
router.get('/publier', requireAuth, (req, res, next) => (req.query.type === 'job' ? res.redirect('/offres/nouvelle') : next()), post.newForm);
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

// Comments
router.get('/publications/:id/commentaires', comment.list);
router.post('/publications/:id/commentaires', requireAuth, commentLimiter, comment.create);
router.post('/commentaires/:commentId/supprimer', requireAuth, comment.destroy);
router.post('/commentaires/:commentId/jaime', requireAuth, actionLimiter, comment.toggleLike);

// App tabs
router.get('/menu', requireAuth, pages.menu);
router.get('/reels', requireAuth, pages.upcoming('reels'));
router.get('/reseau', requireAuth, pages.upcoming('network'));
router.get('/notifications', requireAuth, pages.upcoming('notifications'));
// Global search (people & companies arrive in Phase 6): jobs for now.
router.get('/recherche', (req, res) => res.redirect(`/offres${req.query.q ? `?q=${encodeURIComponent(String(req.query.q))}` : ''}`));
router.get('/admin', requireAuth, requireRole('admin'), pages.upcoming('admin'));

// Legal & information pages (required by AdSense)
router.get('/a-propos', pages.staticPage('about'));
router.get('/contact', pages.staticPage('contact'));
router.get('/confidentialite', pages.staticPage('privacy'));
router.get('/conditions', pages.staticPage('terms'));

module.exports = router;
