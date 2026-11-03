// AdSense settings, editable at /admin/publicites (table site_settings), with .env as fallback.
// Exposed to every view as adsEnabled / adsClient / adSlots (see app.js).
const env = require('../config/env');
const { SiteSetting } = require('../models');

const PLACEMENTS = ['feed', 'sidebar', 'jobTop', 'jobBottom'];
const KEYS = ['ads.enabled', 'ads.client', 'ads.slot.default', ...PLACEMENTS.map((p) => `ads.slot.${p}`)];
const REFRESH_MS = 30 * 1000; // several Node processes: each re-reads the settings every 30 s

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
  const client = has('ads.client') ? stored['ads.client'] || '' : env.ADSENSE_CLIENT_ID;
  const fallback = { feed: env.ADSENSE_SLOT_FEED, sidebar: env.ADSENSE_SLOT_SIDEBAR, jobTop: env.ADSENSE_SLOT_JOB, jobBottom: env.ADSENSE_SLOT_JOB };
  const def = stored['ads.slot.default'] || '';
  const slots = {};
  for (const p of PLACEMENTS) slots[p] = stored[`ads.slot.${p}`] || def || fallback[p] || '';
  const enabled = stored['ads.enabled'] !== 'off' && /^ca-pub-\d{10,20}$/.test(client);
  return { enabled, switchOn: stored['ads.enabled'] !== 'off', client, slots, defaultSlot: def, overrides: Object.fromEntries(PLACEMENTS.map((p) => [p, stored[`ads.slot.${p}`] || ''])) };
}

async function save(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!KEYS.includes(key)) continue;
    await SiteSetting.upsert({ key, value: value ?? '' });
  }
  await load();
}

// ads.txt line (Google's certification authority id is fixed).
function adsTxt() {
  const { client } = current();
  return /^ca-pub-\d{10,20}$/.test(client) ? `google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` : null;
}

module.exports = { PLACEMENTS, KEYS, load, refresh, current, save, adsTxt };
