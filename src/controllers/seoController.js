const { Op } = require('sequelize');
const { Post, Job, User } = require('../models');
const env = require('../config/env');
const jobs = require('../services/jobs');

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

function robots(req, res) {
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400');
  res.send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /parametres',
    'Disallow: /mes-',
    'Disallow: /cv',
    'Disallow: /candidatures',
    'Disallow: /notifications',
    'Disallow: /enregistrements',
    'Disallow: /publier',
    'Disallow: /reinitialiser',
    'Disallow: /*?*postuler=',
    '',
    `Sitemap: ${env.APP_URL}/sitemap.xml`,
    '',
  ].join('\n'));
}

// Public, indexable URLs: static pages, active job offers, public profiles.
async function sitemap(req, res) {
  const startOfToday = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const [jobRows, users, eventRows] = await Promise.all([
    Post.findAll({
      where: { type: 'job', status: 'published', visibility: 'public' },
      include: [
        { model: Job, as: 'job', where: jobs.activeJobWhere(), attributes: ['slug', 'updatedAt'], required: true },
        { model: User, as: 'author', where: { isBanned: false }, attributes: [], required: true },
      ],
      attributes: ['id', 'updatedAt'],
      order: [['createdAt', 'DESC']],
      limit: 20000,
    }),
    User.findAll({ where: { isBanned: false }, attributes: ['username', 'updatedAt'], order: [['followersCount', 'DESC']], limit: 20000 }),
    Post.findAll({
      where: { type: 'event', status: 'published', visibility: 'public', eventDate: { [Op.gte]: startOfToday } },
      include: [{ model: User, as: 'author', where: { isBanned: false }, attributes: [], required: true }],
      attributes: ['id', 'updatedAt'],
      limit: 5000,
    }),
  ]);
  const base = env.APP_URL;
  const urls = [
    { loc: `${base}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${base}/offres`, changefreq: 'hourly', priority: '0.9' },
    { loc: `${base}/evenements`, changefreq: 'daily', priority: '0.7' },
    ...['a-propos', 'contact', 'confidentialite', 'conditions'].map((p) => ({ loc: `${base}/${p}`, changefreq: 'monthly', priority: '0.3' })),
    ...jobRows.map((p) => {
      const last = new Date(Math.max(new Date(p.updatedAt), new Date(p.job.updatedAt)));
      return { loc: `${base}/offres/${p.job.slug}`, lastmod: last.toISOString().slice(0, 10), changefreq: 'daily', priority: '0.8' };
    }),
    ...eventRows.map((p) => ({ loc: `${base}/publications/${p.id}`, lastmod: new Date(p.updatedAt).toISOString().slice(0, 10), changefreq: 'weekly', priority: '0.6' })),
    ...users.map((u) => ({ loc: `${base}/profil/${u.username}`, lastmod: new Date(u.updatedAt).toISOString().slice(0, 10), changefreq: 'weekly', priority: '0.4' })),
  ];
  const body = urls
    .map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`)
    .join('\n');
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
}

// ads.txt generated from ADSENSE_CLIENT_ID (Google's certification authority id is fixed).
function adsTxt(req, res) {
  if (!env.adsEnabled) return res.status(404).type('text/plain').send('');
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400');
  return res.send(`google.com, ${env.ADSENSE_CLIENT_ID.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
}

module.exports = { robots, sitemap, adsTxt };
