// Google Indexing API (Google for Jobs) and JobPosting structured data.
const crypto = require('crypto');
const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job, SiteSetting } = require('../src/models');
const env = require('../src/config/env');
const indexing = require('../src/services/googleIndexing');
const { parseSalary } = require('../src/controllers/jobController');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = 'indexing@sentravail-test.iam.gserviceaccount.com';
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const offer = (title) => ({
  title, companyName: 'Ba Services', location: 'Thiès', contractType: 'CDI', sector: 'Comptabilité',
  description: 'Tenue de la comptabilité générale.\n\nDéclarations fiscales mensuelles.', salary: '250 000 - 350 000 FCFA / mois',
  applyMode: 'email', applyEmail: 'rh@ba.example', deadline: inDays(20),
});

let rec; let adm; let fetchMock; const realFetch = global.fetch;
const publishCalls = () => fetchMock.mock.calls.filter(([url]) => url.includes('urlNotifications')).map(([, o]) => JSON.parse(o.body));
const settle = () => new Promise((r) => setTimeout(r, 30));
const createJob = (s, data) => {
  let req = s.agent.post(`/offres/nouvelle?_csrf=${s.csrf}`);
  for (const [k, v] of Object.entries(data)) req = req.field(k, v);
  return req;
};
const configure = (vars) => {
  Object.assign(env, { GOOGLE_INDEXING_KEY_FILE: '', GOOGLE_INDEXING_CLIENT_EMAIL: '', GOOGLE_INDEXING_PRIVATE_KEY: '', ...vars });
  indexing._reset();
};

beforeAll(async () => {
  await resetDb();
  [rec, adm] = await Promise.all([
    loginAs(await createUser({ email: 'rec@ex.com', role: 'recruiter', companyName: 'Ba Services' })),
    loginAs(await createUser({ email: 'adm@ex.com', role: 'admin' })),
  ]);
});
beforeEach(() => {
  fetchMock = jest.fn(async (url) => ({
    ok: true, status: 200,
    json: async () => (url.includes('oauth2') ? { access_token: 'tok', expires_in: 3600 } : {}),
  }));
  global.fetch = fetchMock;
});
afterAll(async () => {
  global.fetch = realFetch;
  configure({});
  await closeDb();
});

describe('configuration', () => {
  test('off without credentials, nothing sent, reason given without secrets', async () => {
    configure({});
    expect(indexing.enabled()).toBe(false);
    expect(indexing.diagnose()).toMatch(/GOOGLE_INDEXING/);
    expect(await indexing.publish('http://localhost:3000/offres/x')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('invalid key or address is reported', () => {
    configure({ GOOGLE_INDEXING_CLIENT_EMAIL: SA, GOOGLE_INDEXING_PRIVATE_KEY: 'not a key' });
    expect(indexing.diagnose()).toBe('clé privée invalide');
    configure({ GOOGLE_INDEXING_CLIENT_EMAIL: 'me@gmail.com', GOOGLE_INDEXING_PRIVATE_KEY: PEM });
    expect(indexing.diagnose()).toMatch(/compte de service/);
    configure({ GOOGLE_INDEXING_KEY_FILE: '/nonexistent/key.json' });
    expect(indexing.diagnose()).toBe('fichier de clé introuvable');
  });

  test('accepts a key written on one line with \\n', () => {
    configure({ GOOGLE_INDEXING_CLIENT_EMAIL: SA, GOOGLE_INDEXING_PRIVATE_KEY: `"${PEM.replace(/\n/g, '\\n')}"` });
    expect(indexing.enabled()).toBe(true);
    expect(indexing.serviceAccountEmail()).toBe(SA);
  });
});

describe('notifications', () => {
  beforeEach(() => configure({ GOOGLE_INDEXING_CLIENT_EMAIL: SA, GOOGLE_INDEXING_PRIVATE_KEY: PEM }));

  test('signed service-account token, then URL_UPDATED; token reused', async () => {
    expect(await indexing.publish('http://localhost:3000/offres/a')).toBe(true);
    expect(await indexing.publish('http://localhost:3000/offres/b')).toBe(true);
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => url.includes('oauth2'));
    expect(tokenCalls).toHaveLength(1);
    const assertion = new URLSearchParams(tokenCalls[0][1].body).get('assertion');
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ iss: SA, scope: 'https://www.googleapis.com/auth/indexing', aud: 'https://oauth2.googleapis.com/token' });
    const [, opts] = fetchMock.mock.calls.find(([url]) => url.includes('urlNotifications'));
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(publishCalls()).toEqual([{ url: 'http://localhost:3000/offres/a', type: 'URL_UPDATED' }, { url: 'http://localhost:3000/offres/b', type: 'URL_UPDATED' }]);
  });

  test('a Google error never breaks the app and is kept in the history', async () => {
    fetchMock.mockImplementation(async (url) => (url.includes('oauth2')
      ? { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) }
      : { ok: false, status: 403, json: async () => ({ error: { message: 'Permission denied. Failed to verify the URL ownership.' } }) }));
    expect(await indexing.publish('http://localhost:3000/offres/c')).toBe(false);
    expect(indexing.recentHistory()[0]).toMatchObject({ ok: false, error: expect.stringContaining('403') });
  });

  test('publish, edit, delete an offer → Google is told each time', async () => {
    expect((await createJob(rec, offer('Comptable Thiès'))).status).toBe(302);
    const job = await Job.findOne({ where: { title: 'Comptable Thiès' } });
    const url = `${env.APP_URL}/offres/${job.slug}`;
    await settle();
    expect(publishCalls()).toEqual([{ url, type: 'URL_UPDATED' }]);

    let req = rec.agent.post(`/offres/${job.slug}/modifier?_csrf=${rec.csrf}`);
    for (const [k, v] of Object.entries({ ...offer('Comptable Thiès'), description: 'Nouvelle description du poste de comptable.' })) req = req.field(k, v);
    expect((await req).status).toBe(302);
    indexing._reset(); // clears the 1-minute de-duplication
    configure({ GOOGLE_INDEXING_CLIENT_EMAIL: SA, GOOGLE_INDEXING_PRIVATE_KEY: PEM });
    fetchMock.mockClear();
    expect((await rec.agent.post(`/offres/${job.slug}/supprimer`).type('form').send({ _csrf: rec.csrf })).status).toBe(302);
    await settle();
    expect(publishCalls()).toEqual([{ url, type: 'URL_DELETED' }]);
  });

  test('an offer held by the anti-scam filter is announced only once approved', async () => {
    expect((await createJob(rec, { ...offer('Caissier Thiès'), description: 'Des frais de dossier sont demandés au candidat.' })).status).toBe(302);
    const job = await Job.findOne({ where: { title: 'Caissier Thiès' }, include: [{ model: Post, as: 'post' }] });
    expect(job.post.status).toBe('pending_approval');
    await settle();
    expect(publishCalls()).toEqual([]);
    expect((await adm.agent.post(`/admin/moderation/publications/${job.postId}`).type('form').send({ _csrf: adm.csrf, action: 'approve' })).status).toBe(302);
    await settle();
    expect(publishCalls()).toEqual([{ url: `${env.APP_URL}/offres/${job.slug}`, type: 'URL_UPDATED' }]);
  });

  test('daily sweep re-submits offers that just expired, once', async () => {
    const post = await Post.findOne({ where: { type: 'job', status: 'published' } });
    const job = await Job.findOne({ where: { postId: post.id } });
    await job.update({ deadline: inDays(-1) });
    await SiteSetting.upsert({ key: 'indexing.lastSweep', value: inDays(-3) });
    expect(await indexing.sweepExpired()).toBe(1);
    expect(publishCalls()).toEqual([{ url: `${env.APP_URL}/offres/${job.slug}`, type: 'URL_UPDATED' }]);
    expect(await indexing.sweepExpired()).toBe(0); // already done today
    await job.update({ deadline: inDays(20) });
  });

  test('admin page shows the status; bulk submission of open offers is admin only', async () => {
    const page = await adm.agent.get('/admin/google');
    expect(page.text).toContain('Google for Jobs');
    expect(page.text).toContain(SA);
    expect(page.text).not.toContain('PRIVATE KEY');
    expect((await rec.agent.post('/admin/google/indexation').type('form').send({ _csrf: rec.csrf })).status).toBe(403);
    fetchMock.mockClear();
    expect((await adm.agent.post('/admin/google/indexation').type('form').send({ _csrf: adm.csrf })).status).toBe(302);
    const open = await Job.count({ include: [{ model: Post, as: 'post', where: { status: 'published' } }] });
    expect(publishCalls().length).toBe(open);
  });
});

describe('JobPosting structured data', () => {
  test('HTML description, salary, region, identifier, image-free', async () => {
    const job = await Job.findOne({ where: { title: 'Caissier Thiès' } });
    const res = await request(app).get(`/offres/${job.slug}`);
    const ld = JSON.parse(res.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    expect(ld.description).toMatch(/^<p>.*<\/p>$/);
    expect(ld.jobLocation.address).toMatchObject({ addressLocality: 'Thiès', addressRegion: 'Thiès', addressCountry: 'SN' });
    expect(ld.identifier).toEqual({ '@type': 'PropertyValue', name: 'SenTravail', value: String(job.id) });
    expect(ld.baseSalary).toEqual({ '@type': 'MonetaryAmount', currency: 'XOF', value: { '@type': 'QuantitativeValue', unitText: 'MONTH', minValue: 250000, maxValue: 350000 } });
  });

  test('no structured data once the offer has expired', async () => {
    const job = await Job.findOne({ where: { title: 'Caissier Thiès' } });
    await job.update({ deadline: inDays(-2) });
    const res = await request(app).get(`/offres/${job.slug}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('application/ld+json');
  });

  test('salary parsing', () => {
    expect(parseSalary('150 000 FCFA')).toMatchObject({ currency: 'XOF', value: { value: 150000, unitText: 'MONTH' } });
    expect(parseSalary('1,5 million FCFA par an').value).toMatchObject({ value: 1500000, unitText: 'YEAR' });
    expect(parseSalary('10.000 F / jour').value).toMatchObject({ value: 10000, unitText: 'DAY' });
    expect(parseSalary('À négocier')).toBeNull();
    expect(parseSalary('')).toBeNull();
  });
});
