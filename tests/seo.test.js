const fs = require('fs');
const path = require('path');
const { app, request, resetDb, closeDb, createUser } = require('./helpers');
const { Post, Job } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');

const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let rec; let activeJob; let expiredJob;

beforeAll(async () => {
  await resetDb();
  rec = await createUser({ username: 'rama-ndiaye', email: 'rec@ex.com', role: 'recruiter' });
  await createUser({ username: 'banni', email: 'b@ex.com', isBanned: true });
  const mk = async (title, deadline, postExtra = {}) => {
    const post = await Post.create({ type: 'advice', title: 'Conseil', authorId: rec.id, type: 'job', ...postExtra });
    return Job.create({ postId: post.id, slug: buildSlug(title, 'Dakar'), title, companyName: 'Atlantique', companyLogo: '/uploads/logos/2026/01/logo.png', location: 'Dakar', contractType: 'CDI', sector: 'Santé', description: 'x'.repeat(40), applyEmail: 'a@b.sn', deadline });
  };
  activeJob = await mk('Infirmier', inDays(10));
  expiredJob = await mk('Ancienne', inDays(-2));
});
afterAll(closeDb);

describe('robots.txt and sitemap.xml', () => {
  test('robots.txt allows public pages, blocks private ones, links the sitemap', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('Disallow: /admin');
    expect(res.text).toContain('Disallow: /cv');
    expect(res.text).toContain('Sitemap: http://localhost:3000/sitemap.xml');
  });

  test('sitemap lists active offers and public profiles only', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toContain(`<loc>http://localhost:3000/offres/${activeJob.slug}</loc>`);
    expect(res.text).not.toContain(expiredJob.slug);
    expect(res.text).toContain('/profil/rama-ndiaye');
    expect(res.text).not.toContain('/profil/banni');
    expect(res.text).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });
});

describe('Open Graph and indexing', () => {
  test('job page: canonical, og tags (default share image without an offer image), JobPosting', async () => {
    const res = await request(app).get(`/offres/${activeJob.slug}`);
    expect(res.text).toContain(`<link rel="canonical" href="http://localhost:3000/offres/${activeJob.slug}">`);
    expect(res.text).toContain('<meta property="og:image" content="http://localhost:3000/icons/og-default.jpg">');
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(res.text).toContain('<meta property="og:locale" content="fr_FR">');
    expect(res.text).not.toContain('noindex');
  });

  test('default share image elsewhere; private pages are noindex', async () => {
    const offres = await request(app).get('/offres');
    expect(offres.text).toContain('og-default.jpg');
    expect(offres.text).toContain('summary_large_image');
    expect((await request(app).get('/mot-de-passe-oublie')).text).toContain('<meta name="robots" content="noindex, nofollow">');
    // open pages are indexable
    for (const url of ['/', '/offres', '/evenements', '/recherche?q=comptable', '/profil/rama-ndiaye']) {
      expect((await request(app).get(url)).text).not.toContain('noindex');
    }
    expect((await request(app).get('/robots.txt')).text).not.toContain('Disallow: /recherche');
  });

  test('profile pages are canonical profiles', async () => {
    const res = await request(app).get('/profil/rama-ndiaye');
    expect(res.text).toContain('<meta property="og:type" content="profile">');
    expect(res.text).toContain('href="http://localhost:3000/profil/rama-ndiaye"');
  });
});

describe('PWA', () => {
  test('manifest is valid and its icons exist', async () => {
    const res = await request(app).get('/manifest.webmanifest');
    expect(res.status).toBe(200);
    const m = JSON.parse(res.text);
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/?source=pwa');
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of m.icons) expect(fs.existsSync(path.join(__dirname, '../public', icon.src))).toBe(true);
  });

  test('service worker is served uncached with a site-wide scope; offline page exists', async () => {
    const sw = await request(app).get('/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
    expect(sw.headers['service-worker-allowed']).toBe('/');
    expect(sw.text).toContain("'/offline.html'");
    expect((await request(app).get('/offline.html')).status).toBe(200);
  });

  test('pages link the manifest and use versioned assets', async () => {
    const res = await request(app).get('/connexion');
    expect(res.text).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(res.text).toMatch(/\/css\/app\.css\?v=[a-f0-9]{10}/);
    expect(res.text).toContain('apple-touch-icon');
  });
});

describe('Without AdSense configured', () => {
  test('no ads.txt, no ad script, no consent banner, CSP without Google', async () => {
    expect((await request(app).get('/ads.txt')).status).toBe(404);
    const res = await request(app).get('/offres');
    expect(res.text).not.toContain('/js/ads.js');
    expect(res.text).not.toContain('consent-banner');
    expect(res.text).not.toContain('adsbygoogle');
    expect(res.headers['content-security-policy']).not.toContain('googlesyndication');
  });
});
