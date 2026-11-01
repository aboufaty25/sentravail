const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().default('http://localhost:3000'),
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
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  UPLOAD_DIR: z.string().optional().default(''),
  CV_DIR: z.string().optional().default(''),
  CV_LINK_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  FEED_PAGE_SIZE: z.coerce.number().int().min(3).max(50).default(10),
  VIRAL_THRESHOLD: z.coerce.number().default(5),
  FEATURED_DAYS: z.coerce.number().int().min(1).max(90).default(7),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.issues);
  process.exit(1);
}

const env = parsed.data;
env.isProd = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';
if (env.isTest) env.DB_NAME = env.DB_NAME_TEST;
env.cloudinaryEnabled = !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
// Uploaded files must live OUTSIDE the app folder in production, otherwise a redeploy
// from GitHub can wipe them. Default: ~/sentravail-uploads (e.g. /home/u123456789/sentravail-uploads).
env.uploadDir =
  env.UPLOAD_DIR ||
  (env.isProd ? path.join(require('os').homedir(), 'sentravail-uploads') : path.join(__dirname, '../../public/uploads'));

// Temp folder for large uploads (videos): next to uploads, never publicly served.
const publicDir = path.join(__dirname, '../../public');
env.uploadTmpDir = env.uploadDir.startsWith(publicDir)
  ? path.join(__dirname, '../../storage/tmp')
  : `${env.uploadDir.replace(/[\\/]+$/, '')}-tmp`;

// CVs are private: never inside a publicly served folder. Downloaded via signed links only.
env.cvDir =
  env.CV_DIR ||
  (env.isProd ? path.join(require('os').homedir(), 'sentravail-private', 'cvs') : path.join(__dirname, '../../storage/cvs'));

module.exports = env;
