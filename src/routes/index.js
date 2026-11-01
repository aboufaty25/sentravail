const express = require('express');
const auth = require('../controllers/authController');
const profile = require('../controllers/profileController');
const pages = require('../controllers/pageController');
const { requireAuth, requireGuest } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const { authLimiter } = require('../middlewares/rateLimit');

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

// App tabs
router.get('/menu', requireAuth, pages.menu);
router.get('/reels', requireAuth, pages.upcoming('reels'));
router.get('/offres', pages.upcoming('jobs'));
router.get('/reseau', requireAuth, pages.upcoming('network'));
router.get('/notifications', requireAuth, pages.upcoming('notifications'));
router.get('/recherche', pages.upcoming('search'));
router.get('/publier', requireAuth, pages.upcoming('publish'));
router.get('/cv', requireAuth, pages.upcoming('cv'));
router.get('/mes-candidatures', requireAuth, pages.upcoming('applications'));
router.get('/enregistrements', requireAuth, pages.upcoming('saved'));
router.get('/mes-offres', requireAuth, requireRole('recruiter', 'admin'), pages.upcoming('myJobs'));
router.get('/admin', requireAuth, requireRole('admin'), pages.upcoming('admin'));

// Legal & information pages (required by AdSense)
router.get('/a-propos', pages.staticPage('about'));
router.get('/contact', pages.staticPage('contact'));
router.get('/confidentialite', pages.staticPage('privacy'));
router.get('/conditions', pages.staticPage('terms'));

module.exports = router;
