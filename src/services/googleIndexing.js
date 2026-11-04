// Google Indexing API: tells Google as soon as an offer page is published, changed or removed,
// so it shows up in Google for Jobs within minutes/hours instead of waiting for a crawl.
// Credentials come from a Google Cloud service account (never in code), either:
//   GOOGLE_INDEXING_KEY_FILE = path to the JSON key (outside public_html), or
//   GOOGLE_INDEXING_CLIENT_EMAIL + GOOGLE_INDEXING_PRIVATE_KEY.
// The service account must be added as an Owner of the property in Search Console.
const fs = require('fs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const env = require('../config/env');

const SCOPE = 'https://www.googleapis.com/auth/indexing';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PUBLISH_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const HISTORY_SIZE = 50;
const DEDUP_MS = 60 * 1000;
const BULK_LIMIT = 180; // default quota: 200 notifications per day

let creds; // undefined = not read yet, null = missing/invalid
let credsProblem = '';
let token = null; // { value, expiresAt }
const history = [];
const recent = new Map(); // `${type} ${url}` -> timestamp

function normalizeKey(key) {
  // .env files often hold the key on one line with literal "\n", sometimes quoted.
  return String(key || '').trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

function loadCredentials() {
  if (creds !== undefined) return creds;
  creds = null;
  try {
    let email = env.GOOGLE_INDEXING_CLIENT_EMAIL;
    let key = env.GOOGLE_INDEXING_PRIVATE_KEY;
    if (env.GOOGLE_INDEXING_KEY_FILE) {
      const json = JSON.parse(fs.readFileSync(env.GOOGLE_INDEXING_KEY_FILE, 'utf8'));
      email = json.client_email;
      key = json.private_key;
    }
    if (!email && !key) {
      credsProblem = 'variables GOOGLE_INDEXING_* non renseignées';
      return creds;
    }
    if (!email || !/@.+\.iam\.gserviceaccount\.com$/.test(email)) {
      credsProblem = "adresse du compte de service invalide (…@….iam.gserviceaccount.com)";
      return creds;
    }
    const privateKey = crypto.createPrivateKey(normalizeKey(key));
    creds = { email, privateKey };
    credsProblem = '';
  } catch (err) {
    credsProblem = err.code === 'ENOENT' ? 'fichier de clé introuvable' : err instanceof SyntaxError ? 'fichier de clé illisible (JSON attendu)' : 'clé privée invalide';
  }
  return creds;
}

function enabled() {
  return !!loadCredentials();
}

// Human-readable reason why it is off (never prints secret values).
function diagnose() {
  return enabled() ? null : credsProblem;
}

function serviceAccountEmail() {
  return loadCredentials()?.email || '';
}

const b64url = (v) => Buffer.from(v).toString('base64url');

async function accessToken() {
  if (token && token.expiresAt > Date.now() + 60 * 1000) return token.value;
  const { email, privateKey } = loadCredentials();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`jeton refusé (${res.status}${data.error ? ` ${data.error}` : ''})`);
  token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return token.value;
}

function record(entry) {
  history.unshift({ ...entry, at: new Date() });
  history.length = Math.min(history.length, HISTORY_SIZE);
}

// Sends one notification; resolves to true on success. Never throws.
async function publish(url, type = 'URL_UPDATED') {
  if (!enabled()) return false;
  const key = `${type} ${url}`;
  const last = recent.get(key);
  if (last && Date.now() - last < DEDUP_MS) return true;
  recent.set(key, Date.now());
  try {
    const res = await fetch(PUBLISH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify({ url, type }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) token = null;
      recent.delete(key);
      throw new Error(`${res.status}${data.error?.message ? ` ${data.error.message}` : ''}`.slice(0, 200));
    }
    record({ url, type, ok: true });
    return true;
  } catch (err) {
    recent.delete(key);
    record({ url, type, ok: false, error: err.message });
    if (!env.isTest) console.error(`[indexing] ${type} ${url} failed: ${err.message}`);
    return false;
  }
}

function jobUrl(job) {
  return `${env.APP_URL}/offres/${job.slug}`;
}

// Fire-and-forget hook used by the controllers: never delays nor breaks the request.
function notifyJob(job, type = 'URL_UPDATED') {
  if (!job?.slug || !enabled()) return Promise.resolve(false);
  return publish(jobUrl(job), type);
}

// Same, from a post id (moderation decisions, reports); ignores posts that are not offers.
// Only the lookup is awaited (call it before deleting the post), the notification runs in the background.
async function notifyPost(postId, type = 'URL_UPDATED') {
  if (!enabled()) return false;
  const { Job } = require('../models');
  const job = await Job.findOne({ where: { postId }, attributes: ['slug'] }).catch(() => null);
  if (job) notifyJob(job, type);
  return !!job;
}

// Open, published offers (newest first) — for the "send all" button in the admin.
async function openJobs(limit = BULK_LIMIT) {
  const { Job, Post } = require('../models');
  const today = new Date().toISOString().slice(0, 10);
  return Job.findAll({
    attributes: ['slug'],
    where: { [Op.or]: [{ deadline: null }, { deadline: { [Op.gte]: today } }] },
    include: [{ model: Post, as: 'post', attributes: [], where: { status: 'published' }, required: true }],
    order: [['id', 'DESC']],
    limit,
  });
}

async function submitAllOpen(limit = BULK_LIMIT) {
  const list = await openJobs(limit);
  let ok = 0;
  for (const job of list) if (await publish(jobUrl(job), 'URL_UPDATED')) ok += 1;
  return { sent: ok, total: list.length };
}

// Offers whose deadline passed since the last sweep: their page no longer carries the
// JobPosting data, so Google must re-read it to drop them from Google for Jobs.
async function sweepExpired() {
  if (!enabled()) return 0;
  const { Job, SiteSetting } = require('../models');
  const today = new Date().toISOString().slice(0, 10);
  const row = await SiteSetting.findByPk('indexing.lastSweep');
  const since = row?.value || today;
  if (since === today && row) return 0;
  await SiteSetting.upsert({ key: 'indexing.lastSweep', value: today });
  if (!row) return 0; // first run: start from today
  const expired = await Job.findAll({ attributes: ['slug'], where: { deadline: { [Op.gte]: since, [Op.lt]: today } }, limit: BULK_LIMIT });
  for (const job of expired) await publish(jobUrl(job), 'URL_UPDATED');
  return expired.length;
}

function recentHistory() {
  return history.slice();
}

// Tests only.
function _reset() {
  creds = undefined;
  credsProblem = '';
  token = null;
  history.length = 0;
  recent.clear();
}

module.exports = { enabled, diagnose, serviceAccountEmail, publish, notifyJob, notifyPost, submitAllOpen, sweepExpired, recentHistory, jobUrl, normalizeKey, BULK_LIMIT, _reset };
