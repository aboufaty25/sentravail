const express = require('express');
const auth = require('../controllers/authController');
const profile = require('../controllers/profileController');
const pages = require('../controllers/pageController');
const { requireAuth, requireGuest } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const post = require('../controllers/postController');
const comment = require('../controllers/commentController');
const { authLimiter, postLimiter, commentLimiter, actionLimiter } = require('../middlewares/rateLimit');
const { imageUpload, handleUploadErrors } = require('../middlewares/upload');

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
router.get('/publier', requireAuth, post.newForm);
router.post('/publier', requireAuth, postLimiter, handleUploadErrors(imageUpload.array('photos', 4)), post.create);
router.get('/publications/:id', post.show);
router.post('/publications/:id/supprimer', requireAuth, post.destroy);
router.post('/publications/:id/reaction', requireAuth, actionLimiter, post.react);
router.post('/publications/:id/enregistrer', requireAuth, actionLimiter, post.toggleSave);
router.post('/publications/:id/partager', requireAuth, postLimiter, post.share);
router.get('/enregistrements', requireAuth, post.savedList);

// Comments
router.get('/publications/:id/commentaires', comment.list);
router.post('/publications/:id/commentaires', requireAuth, commentLimiter, comment.create);
router.post('/commentaires/:commentId/supprimer', requireAuth, comment.destroy);
router.post('/commentaires/:commentId/jaime', requireAuth, actionLimiter, comment.toggleLike);

// App tabs
router.get('/menu', requireAuth, pages.menu);
router.get('/reels', requireAuth, pages.upcoming('reels'));
router.get('/offres', pages.upcoming('jobs'));
router.get('/reseau', requireAuth, pages.upcoming('network'));
router.get('/notifications', requireAuth, pages.upcoming('notifications'));
router.get('/recherche', pages.upcoming('search'));
router.get('/cv', requireAuth, pages.upcoming('cv'));
router.get('/mes-candidatures', requireAuth, pages.upcoming('applications'));
router.get('/mes-offres', requireAuth, requireRole('recruiter', 'admin'), pages.upcoming('myJobs'));
router.get('/admin', requireAuth, requireRole('admin'), pages.upcoming('admin'));

// Legal & information pages (required by AdSense)
router.get('/a-propos', pages.staticPage('about'));
router.get('/contact', pages.staticPage('contact'));
router.get('/confidentialite', pages.staticPage('privacy'));
router.get('/conditions', pages.staticPage('terms'));

module.exports = router;
