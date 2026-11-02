// Site branding editable from /admin/apparence: logo, app icon (favicon + home screen) and
// default share image. Values are cached in memory and exposed to every view as `brand`.
const env = require('../config/env');
const { SiteSetting } = require('../models');
const { removeLocalMedia } = require('./storage');

const DEFAULTS = Object.freeze({
  logo: '/icons/logo.svg',
  icon192: '/icons/icon-192.png',
  icon512: '/icons/icon-512.png',
  shareImage: '/icons/og-default.jpg',
});
const KEYS = Object.keys(DEFAULTS);

const custom = {}; // key -> uploaded URL
// The host may run several Node processes: each one re-reads the settings at most every
// REFRESH_MS, so a change made through one process reaches all of them quickly.
const REFRESH_MS = 30 * 1000;
let loadedAt = 0;

async function load() {
  const rows = await SiteSetting.findAll({ where: { key: KEYS }, raw: true });
  for (const k of KEYS) delete custom[k];
  for (const r of rows) if (r.value) custom[r.key] = r.value;
  loadedAt = Date.now();
}

// Express middleware: keeps the in-memory copy fresh (one small query per process every 30 s).
async function refresh(req, res, next) {
  if (Date.now() - loadedAt > REFRESH_MS) {
    loadedAt = Date.now(); // avoid a burst of parallel reloads
    await load().catch(() => {});
  }
  next();
}

function absolute(url) {
  return /^https?:\/\//.test(url) ? url : `${env.APP_URL}${url}`;
}

// What the views use.
function current() {
  const v = { ...DEFAULTS, ...custom };
  return {
    logo: v.logo,
    customLogo: !!custom.logo,
    icon192: v.icon192,
    icon512: v.icon512,
    customIcon: !!custom.icon512,
    favicon: custom.icon192 || '/icons/logo.svg',
    faviconType: custom.icon192 ? 'image/png' : 'image/svg+xml',
    appleIcon: custom.icon192 || '/icons/apple-touch-icon.png',
    shareImage: absolute(v.shareImage),
    customShareImage: !!custom.shareImage,
  };
}

async function set(values) {
  const old = [];
  for (const [key, value] of Object.entries(values)) {
    if (!KEYS.includes(key)) continue;
    if (custom[key]) old.push(custom[key]);
    if (value) await SiteSetting.upsert({ key, value });
    else await SiteSetting.destroy({ where: { key } });
  }
  await load();
  await removeLocalMedia(old.filter((u) => !Object.values(custom).includes(u)));
}

function manifest() {
  const b = current();
  const icons = [
    { src: b.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: b.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
  ];
  // The default maskable icon has a safe zone; a custom icon is used as-is.
  icons.push(b.customIcon
    ? { src: b.icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    : { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  return {
    name: "SenTravail — Le réseau social de l'emploi au Sénégal",
    short_name: 'SenTravail',
    description: "Offres d'emploi, CV, recruteurs et candidats au Sénégal.",
    lang: 'fr-SN',
    dir: 'ltr',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f0f2f5',
    theme_color: '#1668e3',
    categories: ['business', 'social', 'productivity'],
    icons,
    shortcuts: [
      { name: "Offres d'emploi", url: '/offres', icons: [{ src: b.icon192, sizes: '192x192' }] },
      { name: 'Mes candidatures', url: '/mes-candidatures', icons: [{ src: b.icon192, sizes: '192x192' }] },
    ],
  };
}

module.exports = { DEFAULTS, load, refresh, current, set, manifest };
