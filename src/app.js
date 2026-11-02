const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const expressLayouts = require('express-ejs-layouts');
const env = require('./config/env');
const { sessionMiddleware } = require('./config/session');
const { loadUser } = require('./middlewares/auth');
const { flash } = require('./middlewares/flash');
const { csrfProtection } = require('./middlewares/csrf');
const { globalLimiter } = require('./middlewares/rateLimit');
const { notFound, errorHandler } = require('./middlewares/errors');
const viewHelpers = require('./utils/viewHelpers');
const routes = require('./routes');
const { unseenCount } = require('./services/notifications');

const root = path.join(__dirname, '..');
const app = express();

// Google AdSense domains, allowed only when ADSENSE_CLIENT_ID is set.
const GOOGLE_ADS = ['https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com', 'https://*.doubleclick.net', 'https://*.google.com', 'https://*.googleadservices.com', 'https://*.googletagservices.com', 'https://*.adtrafficquality.google', 'https://*.gstatic.com'];
const ADS = env.adsEnabled
  ? { script: GOOGLE_ADS, connect: GOOGLE_ADS, frame: GOOGLE_ADS, img: ['https:'] }
  : { script: [], connect: [], frame: [], img: [] };

// Short hash of the built assets, appended as ?v= so browsers and the service worker
// pick up new CSS/JS right after a deploy.
const assetVersion = (() => {
  const fs = require('fs');
  const crypto = require('crypto');
  const hash = crypto.createHash('sha1');
  for (const f of ['public/css/app.css', 'public/js/app.js', 'public/js/ads.js', 'node_modules/htmx.org/package.json', 'node_modules/alpinejs/package.json']) {
    try { hash.update(fs.readFileSync(path.join(root, f))); } catch (_) { /* not built yet */ }
  }
  return hash.digest('hex').slice(0, 10);
})();

app.set('trust proxy', 1); // behind Hostinger / Nginx proxy
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Alpine.js (standard build) evaluates expressions with Function().
        scriptSrc: ["'self'", "'unsafe-eval'", ...ADS.script],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', ...ADS.img],
        mediaSrc: ["'self'"],
        connectSrc: ["'self'", env.APP_URL.replace(/^http/, 'ws'), ...ADS.connect], // Socket.io + ads
        frameSrc: ["'self'", ...ADS.frame],
        formAction: ["'self'"],
        upgradeInsecureRequests: env.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
// Never log CSRF tokens passed in URLs.
morgan.token('safe-url', (req) => (req.originalUrl || req.url).replace(/([?&]_csrf=)[^&]+/, '$1***'));
if (!env.isTest) {
  app.use(morgan(env.isProd ? ':remote-addr - [:date[clf]] ":method :safe-url" :status :res[content-length] ":user-agent"' : ':method :safe-url :status :response-time ms'));
}

const staticOpts = { maxAge: env.isProd ? '7d' : 0 };
// The service worker must always be revalidated, and may control the whole site.
app.get('/sw.js', (req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  res.sendFile(path.join(root, 'public/sw.js'));
});
app.use(express.static(path.join(root, 'public'), staticOpts));
// Uploaded files have random, never-reused names: cache them for a long time.
const uploadOpts = { maxAge: env.isProd ? '30d' : 0, immutable: env.isProd };
app.use('/uploads', express.static(env.uploadDir, uploadOpts));
app.use('/vendor/htmx', express.static(path.join(root, 'node_modules/htmx.org/dist'), staticOpts));
app.use('/vendor/alpine', express.static(path.join(root, 'node_modules/alpinejs/dist'), staticOpts));

app.use(globalLimiter);
// Dynamic pages: never stored by shared caches/CDN (they contain personal data);
// "no-cache" (not "no-store") keeps the browser's instant back/forward navigation.
app.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-cache');
  next();
});
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '200kb' }));
app.use(sessionMiddleware());
app.use(flash);
app.use(csrfProtection);
app.use(loadUser);
app.use((req, res, next) => {
  Object.assign(res.locals, viewHelpers, {
    appUrl: env.APP_URL,
    currentPath: req.path,
    title: 'SenTravail',
    metaDescription: "SenTravail, le réseau social de l'emploi au Sénégal : offres d'emploi, CV, recruteurs et candidats.",
    activeTab: null,
    noAds: false,
    wide: false,
    builtCvName: req.session.builtCv?.name || null, // guest CV made with the builder
    assetVersion,
    adsEnabled: env.adsEnabled,
    adsClient: env.ADSENSE_CLIENT_ID,
    adSlots: { feed: env.ADSENSE_SLOT_FEED, sidebar: env.ADSENSE_SLOT_SIDEBAR, job: env.ADSENSE_SLOT_JOB },
    consent: req.cookies?.st_consent || (req.get('cookie') || '').match(/(?:^|;\s*)st_consent=(granted|denied)/)?.[1] || null,
    ogImage: `${env.APP_URL}/icons/og-default.jpg`,
    // Private or personal pages are never indexed.
    noindex: /^\/(admin|parametres|mes-|cv|candidatures|notifications|enregistrements|publier|menu|recherche|reinitialiser|mot-de-passe-oublie|offres\/nouvelle|offres\/[^/]+\/modifier)/.test(req.path),
  });
  next();
});

// Notification badge (logged-in HTML pages only).
app.use(async (req, res, next) => {
  res.locals.unseenNotifications = 0;
  if (req.user && req.method === 'GET' && !req.get('HX-Request')) res.locals.unseenNotifications = await unseenCount(req.user.id);
  next();
});

app.use(routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
