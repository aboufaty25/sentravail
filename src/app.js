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

const app = express();
const root = path.join(__dirname, '..');

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
        scriptSrc: ["'self'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
        mediaSrc: ["'self'", 'https://res.cloudinary.com'],
        connectSrc: ["'self'"],
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
app.use(express.static(path.join(root, 'public'), staticOpts));
if (!env.uploadDir.startsWith(path.join(root, 'public'))) {
  app.use('/uploads', express.static(env.uploadDir, staticOpts));
}
app.use('/vendor/htmx', express.static(path.join(root, 'node_modules/htmx.org/dist'), staticOpts));
app.use('/vendor/alpine', express.static(path.join(root, 'node_modules/alpinejs/dist'), staticOpts));

app.use(globalLimiter);
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
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
  });
  next();
});

app.use(routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
