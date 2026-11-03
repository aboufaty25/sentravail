// Google Analytics 4 and Google Search Console, set at /admin/google (table site_settings),
// with GA_MEASUREMENT_ID / GOOGLE_SITE_VERIFICATION in .env as fallback.
const env = require('../config/env');
const { SiteSetting } = require('../models');

const KEYS = ['google.analyticsId', 'google.siteVerification'];
const REFRESH_MS = 30 * 1000; // several Node processes: each re-reads every 30 s
const GA_RE = /^G-[A-Z0-9]{4,15}$/;
const GSC_RE = /^[A-Za-z0-9_-]{10,100}$/;

let stored = {};
let loadedAt = 0;

async function load() {
  const rows = await SiteSetting.findAll({ where: { key: KEYS }, raw: true });
  stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  loadedAt = Date.now();
}

async function refresh(req, res, next) {
  if (Date.now() - loadedAt > REFRESH_MS) {
    loadedAt = Date.now();
    await load().catch(() => {});
  }
  next();
}

function current() {
  const has = (k) => Object.prototype.hasOwnProperty.call(stored, k);
  const analyticsId = has('google.analyticsId') ? stored['google.analyticsId'] || '' : env.GA_MEASUREMENT_ID;
  const siteVerification = has('google.siteVerification') ? stored['google.siteVerification'] || '' : env.GOOGLE_SITE_VERIFICATION;
  return { analyticsId: GA_RE.test(analyticsId) ? analyticsId : '', siteVerification: GSC_RE.test(siteVerification) ? siteVerification : '' };
}

// Accepts the bare code or the whole <meta name="google-site-verification" content="…"> tag.
function parseVerification(input) {
  const v = String(input || '').trim();
  const m = v.match(/content=["']([^"']+)["']/);
  return m ? m[1].trim() : v;
}

async function save({ analyticsId, siteVerification }) {
  await SiteSetting.upsert({ key: 'google.analyticsId', value: analyticsId || '' });
  await SiteSetting.upsert({ key: 'google.siteVerification', value: siteVerification || '' });
  await load();
}

module.exports = { KEYS, GA_RE, GSC_RE, load, refresh, current, parseVerification, save };
