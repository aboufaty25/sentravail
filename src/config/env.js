const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  // Public address, without trailing slash (used for links, sitemap and Google/Apple return URLs).
  APP_URL: z.string().trim().default('http://localhost:3000').transform((v) => v.replace(/\/+$/, '')),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string().default(''),
  DB_NAME_TEST: z.string().default('sentravail_test'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_SECURE: z.string().default('true').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  MAIL_FROM: z.string().default('SenTravail <no-reply@sentravail.com>'),
  SEED_PASSWORD: z.string().default('Sentravail2026!'),
  ADMIN_EMAILS: z.string().optional().default(''),
  // "Continuer avec Google / Apple" (buttons shown only when configured)
  GOOGLE_CLIENT_ID: z.string().trim().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().trim().optional().default(''),
  // Services ID, e.g. com.sentravail.web (the only Apple setting: the ID token is checked with Apple's public keys)
  APPLE_CLIENT_ID: z.string().trim().optional().default(''),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  UPLOAD_DIR: z.string().optional().default(''),
  CV_DIR: z.string().optional().default(''),
  CV_LINK_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  FEED_PAGE_SIZE: z.coerce.number().int().min(3).max(50).default(10),
  VIRAL_THRESHOLD: z.coerce.number().default(5),
  FEATURED_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  // Google Analytics 4 / Search Console (normally set in the admin: /admin/google)
  GA_MEASUREMENT_ID: z.string().trim().optional().default(''),
  GOOGLE_SITE_VERIFICATION: z.string().trim().optional().default(''),
  // Google Indexing API (offers sent to Google for Jobs as soon as they change): service account
  // JSON key file (outside public_html), or its client_email + private_key.
  GOOGLE_INDEXING_KEY_FILE: z.string().trim().optional().default(''),
  GOOGLE_INDEXING_CLIENT_EMAIL: z.string().trim().optional().default(''),
  GOOGLE_INDEXING_PRIVATE_KEY: z.string().optional().default(''),
  ADSENSE_CLIENT_ID: z.string().trim().optional().default('').refine((v) => !v || /^ca-pub-\d{10,20}$/.test(v), 'ADSENSE_CLIENT_ID must look like ca-pub-1234567890123456'),
  ADSENSE_SLOT_FEED: z.string().trim().optional().default(''),
  ADSENSE_SLOT_SIDEBAR: z.string().trim().optional().default(''),
  ADSENSE_SLOT_JOB: z.string().trim().optional().default(''),
  REPORT_AUTOHIDE: z.coerce.number().int().min(1).max(100).default(3),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.issues);
  process.exit(1);
}

const env = parsed.data;
if (env.NODE_ENV === 'production' && (env.SESSION_SECRET.length < 32 || /change-me/.test(env.SESSION_SECRET))) {
  console.error('SESSION_SECRET must be a random string of at least 32 characters in production (openssl rand -hex 32).');
  process.exit(1);
}
env.isProd = env.NODE_ENV === 'production';
if (env.isProd && env.APP_URL.startsWith('http://')) {
  console.warn(`APP_URL is ${env.APP_URL}: use https://… (Google/Apple sign-in and secure cookies need it).`);
}
env.isTest = env.NODE_ENV === 'test';
if (env.isTest) env.DB_NAME = env.DB_NAME_TEST;
env.adsEnabled = !!env.ADSENSE_CLIENT_ID;
env.cloudinaryEnabled = !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
// Uploaded files must live OUTSIDE the app folder in production, otherwise a redeploy
// from GitHub can wipe them. Default: ~/sentravail-uploads (e.g. /home/u123456789/sentravail-uploads).
env.uploadDir =
  env.UPLOAD_DIR ||
  (env.isProd ? path.join(require('os').homedir(), 'sentravail-uploads') : path.join(__dirname, '../../public/uploads'));

// CVs are private: never inside a publicly served folder. Downloaded via signed links only.
env.cvDir =
  env.CV_DIR ||
  (env.isProd ? path.join(require('os').homedir(), 'sentravail-private', 'cvs') : path.join(__dirname, '../../storage/cvs'));

module.exports = env;
