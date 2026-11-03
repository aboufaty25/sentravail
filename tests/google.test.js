// Google Analytics 4 and Search Console settings (/admin/google).
const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const googleConfig = require('../src/services/googleConfig');

let adm; let cand;
beforeAll(async () => {
  await resetDb();
  await googleConfig.load();
  [adm, cand] = await Promise.all([loginAs(await createUser({ role: 'admin' })), loginAs(await createUser({ email: 'c@ex.com' }))]);
});
afterAll(closeDb);

const save = (s, body) => s.agent.post('/admin/google').type('form').send({ _csrf: s.csrf, ...body });

test('nothing from Google Analytics until configured', async () => {
  const home = await request(app).get('/');
  expect(home.text).not.toContain('/js/analytics.js');
  expect(home.text).not.toContain('google-site-verification');
});

test('admin only, validated', async () => {
  expect((await cand.agent.get('/admin/google')).status).toBe(403);
  expect((await save(cand, { analyticsId: 'G-ABC123XYZ9' })).status).toBe(403);
  expect((await adm.agent.get('/admin/google')).status).toBe(200);
  expect((await save(adm, { analyticsId: 'UA-1234-1' })).status).toBe(422);
  expect((await save(adm, { siteVerification: 'bad code!' })).status).toBe(422);
});

test('GA4 on public pages (not admin), Search Console tag on the home page, CSP allows Google Analytics', async () => {
  const res = await save(adm, { analyticsId: 'g-abc123xyz9', siteVerification: '<meta name="google-site-verification" content="AbCdEf_1234567890-xyz" />' });
  expect(res.status).toBe(302);
  expect(googleConfig.current()).toEqual({ analyticsId: 'G-ABC123XYZ9', siteVerification: 'AbCdEf_1234567890-xyz' });
  const home = await request(app).get('/');
  expect(home.text).toContain('<meta name="google-site-verification" content="AbCdEf_1234567890-xyz">');
  expect(home.text).toContain('src="/js/analytics.js?v=');
  expect(home.text).toContain('data-id="G-ABC123XYZ9"');
  expect(home.text).not.toContain('<script>'); // no inline script (strict CSP)
  expect((await request(app).get('/offres')).text).not.toContain('google-site-verification');
  expect((await adm.agent.get('/admin')).text).not.toContain('/js/analytics.js');
  const csp = home.headers['content-security-policy'];
  expect(csp).toContain('https://www.googletagmanager.com');
  expect(csp).toMatch(/connect-src[^;]*google-analytics\.com/);
});

test('sign-up and login events are sent once on the next page', async () => {
  const agent = request.agent(app);
  const csrf = (await agent.get('/inscription')).text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  await agent.post('/inscription').type('form').send({ _csrf: csrf, firstName: 'Awa', lastName: 'Diop', email: 'awa@ex.com', password: 'motdepasse1', passwordConfirm: 'motdepasse1', role: 'candidate', acceptTerms: 'on' });
  const next = (await agent.get('/')).text;
  expect(next).toContain('data-events="[{&#34;name&#34;:&#34;sign_up&#34;');
  expect(next).toContain('data-user="candidate"');
  expect((await agent.get('/')).text).toContain('data-events="[]"');
});

test('clearing the fields switches Google Analytics off', async () => {
  await save(adm, { analyticsId: '', siteVerification: '' });
  expect((await request(app).get('/')).text).not.toContain('/js/analytics.js');
});
