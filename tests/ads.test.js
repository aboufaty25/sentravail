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

test('the Google script is never in the HTML: it is loaded by ads.js after consent', async () => {
  const res = await request(app).get('/offres');
  expect(res.text).toContain('src="/js/ads.js?v=');
  expect(res.text).toContain('data-client="ca-pub-1234567890123456"');
  expect(res.text).toContain('id="consent-banner"');
  expect(res.text).not.toContain('pagead2.googlesyndication.com/pagead/js');
});

test('ad placements: feed after every 6 posts, right column, bottom of a job page', async () => {
  // FEED_PAGE_SIZE is 3 in tests: posts 1-3 on page 1, the ad comes after post 6 (page 2).
  const home = await s.agent.get('/');
  expect(home.text).not.toContain('data-ad-slot="1111111111"');
  expect(home.text).toContain('data-ad-slot="2222222222"');
  const since = home.text.match(/since=(\d+)/)[1];
  const page2 = await s.agent.get(`/fil?page=2&since=${since}`);
  expect((page2.text.match(/data-ad-slot="1111111111"/g) || []).length).toBe(1);
  expect(page2.text.indexOf('data-ad-slot="1111111111"')).toBeGreaterThan(page2.text.lastIndexOf('<article'));
  const jobPage = await request(app).get(`/offres/${job.slug}`);
  expect(jobPage.text).toContain('data-ad-slot="3333333333"');
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
