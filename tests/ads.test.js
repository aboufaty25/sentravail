// AdSense configured for this file only (env is read when modules load).
process.env.ADSENSE_CLIENT_ID = 'ca-pub-1234567890123456';
process.env.ADSENSE_SLOT_FEED = '1111111111';
process.env.ADSENSE_SLOT_SIDEBAR = '2222222222';
process.env.ADSENSE_SLOT_JOB = '3333333333';

const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');

let user; let s; let job;
beforeAll(async () => {
  await resetDb();
  user = await createUser({ email: 'u@ex.com', role: 'recruiter' });
  s = await loginAs(user);
  for (let i = 0; i < 8; i += 1) await Post.create({ type: 'advice', title: 'Conseil', authorId: user.id, text: `Post ${i}` });
  const post = await Post.create({ type: 'advice', title: 'Conseil', authorId: user.id, type: 'job' });
  job = await Job.create({ postId: post.id, slug: buildSlug('Chauffeur', 'Dakar'), title: 'Chauffeur', companyName: 'Ba', location: 'Dakar', contractType: 'CDI', sector: 'Logistique & Transport', description: 'x'.repeat(40), applyEmail: 'a@b.sn' });
});
afterAll(closeDb);

test('ads.txt is generated from the publisher id', async () => {
  const res = await request(app).get('/ads.txt');
  expect(res.status).toBe(200);
  expect(res.text).toBe('google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
});

test('CSP allows Google ad domains', async () => {
  const csp = (await request(app).get('/offres')).headers['content-security-policy'];
  expect(csp).toContain('https://pagead2.googlesyndication.com');
  expect(csp).toMatch(/frame-src[^;]*doubleclick/);
});

test('ads load directly (no cookie banner), with early connections to Google', async () => {
  const res = await request(app).get('/offres');
  expect(res.text).toContain('src="/js/ads.js?v=');
  expect(res.text).toContain('data-client="ca-pub-1234567890123456"');
  expect(res.text).not.toContain('consent-banner');
  expect(res.text).toContain('<link rel="preconnect" href="https://pagead2.googlesyndication.com" crossorigin>');
  const js = (await request(app).get('/js/ads.js')).text;
  expect(js).not.toContain('st_consent');
  expect(js).toContain('pagead2.googlesyndication.com/pagead/js/adsbygoogle.js');
});

test('ad placements: feed after the 1st post then every 3 posts, both side columns, job page under the title and after Postuler', async () => {
  // FEED_PAGE_SIZE is 3 in tests: posts 1-3 on page 1 (ad after post 1), posts 4-6 on page 2 (ad after post 4).
  const home = await s.agent.get('/');
  const feed1 = home.text.slice(home.text.indexOf('id="feed"'));
  expect((feed1.match(/data-ad-slot="1111111111"/g) || []).length).toBe(1);
  const firstArticleEnd = feed1.indexOf('</article>');
  expect(feed1.indexOf('data-ad-slot="1111111111"')).toBeGreaterThan(firstArticleEnd);
  expect(feed1.indexOf('data-ad-slot="1111111111"')).toBeLessThan(feed1.indexOf('<article', firstArticleEnd));
  // Left and right columns.
  expect((home.text.match(/data-ad-slot="2222222222"/g) || []).length).toBe(2);
  const since = home.text.match(/since=(\d+)/)[1];
  const page2 = await s.agent.get(`/fil?page=2&since=${since}`);
  expect((page2.text.match(/data-ad-slot="1111111111"/g) || []).length).toBe(1);
  expect(page2.text.indexOf('data-ad-slot="1111111111"')).toBeLessThan(page2.text.indexOf('<article', page2.text.indexOf('</article>')));
  const jobPage = (await request(app).get(`/offres/${job.slug}`)).text;
  expect((jobPage.match(/data-ad-slot="3333333333"/g) || []).length).toBe(2);
  expect(jobPage.indexOf('data-ad-place="jobTop"')).toBeGreaterThan(jobPage.indexOf('id="job-title"'));
  expect(jobPage.indexOf('data-ad-place="jobTop"')).toBeLessThan(jobPage.indexOf('Description du poste'));
  expect(jobPage.indexOf('data-ad-place="jobBottom"')).toBeGreaterThan(jobPage.indexOf('id="postuler"'));
});

test('ads are lazy and never leave an empty box: requested one screen ahead, unfolded only once filled', async () => {
  const js = (await request(app).get('/js/ads.js')).text;
  expect(js).toContain('IntersectionObserver');
  expect(js).toContain('offsetParent');
  expect(js).toContain("'0px 0px 100% 0px'");
  expect(js).toContain('ad-filled');
  const css = (await request(app).get('/css/app.css')).text;
  expect(css).toMatch(/\.ad-unit:not\(\.ad-filled\)\{[^}]*max-height:0/);
  const home = (await s.agent.get('/')).text;
  expect(home).toMatch(/data-ad-slot-wrapper[^>]*class="ad-unit /);
});

test('admin settings override .env: publisher id, default unit, on/off switch, ads.txt', async () => {
  const { SiteSetting } = require('../src/models');
  const adsConfig = require('../src/services/adsConfig');
  const adm = await loginAs(await createUser({ role: 'admin' }));
  expect((await s.agent.get('/admin/publicites')).status).toBe(403);
  expect((await adm.agent.get('/admin/publicites')).status).toBe(200);
  const post = (body) => adm.agent.post('/admin/publicites').type('form').send({ _csrf: adm.csrf, ...body });
  expect((await post({ enabled: 'on', client: 'pub-123', defaultSlot: '6556069017' })).status).toBe(422);
  expect((await s.agent.post('/admin/publicites').type('form').send({ _csrf: s.csrf, client: 'ca-pub-1531184274736744' })).status).toBe(403);
  expect((await post({ enabled: 'on', client: 'ca-pub-1531184274736744', defaultSlot: '6556069017', feed: '', sidebar: '', jobTop: '', jobBottom: '' })).status).toBe(302);
  expect(adsConfig.current().slots).toEqual({ feed: '6556069017', sidebar: '6556069017', jobTop: '6556069017', jobBottom: '6556069017' });
  expect((await request(app).get('/ads.txt')).text).toBe('google.com, pub-1531184274736744, DIRECT, f08c47fec0942fa0\n');
  expect((await request(app).get(`/offres/${job.slug}`)).text).toContain('data-ad-slot="6556069017"');
  // Switched off: no ad code at all.
  await post({ client: 'ca-pub-1531184274736744', defaultSlot: '6556069017' });
  const off = (await request(app).get(`/offres/${job.slug}`)).text;
  expect(off).not.toContain('adsbygoogle');
  expect(off).not.toContain('/js/ads.js');
  await SiteSetting.destroy({ where: { key: adsConfig.KEYS } });
  await adsConfig.load();
});

test.each(['/connexion', '/inscription', '/mot-de-passe-oublie', '/offres/nouvelle', '/publier', '/cv/creer', '/admin', '/notifications', '/menu', '/mes-offres'])(
  'no ads on %s',
  async (url) => {
    const res = await s.agent.get(url);
    expect(res.text).not.toContain('adsbygoogle');
    expect(res.text).not.toContain('/js/ads.js');
  }
);

test('no ads on error pages', async () => {
  const res = await request(app).get('/nexiste-pas');
  expect(res.status).toBe(404);
  expect(res.text).not.toContain('/js/ads.js');
});
