const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job, Application } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');
const { buildCvPdf } = require('../src/services/cv');
const { period } = require('../src/services/cv/layout');
const { TEMPLATES } = require('../src/config/cvTemplates');
const { safeReturn } = require('../src/utils/returnTo');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const baseCv = () => ({
  template: 'classic',
  personal: { firstName: 'Aïssatou', lastName: 'Fall', email: 'aissatou@example.com', phone: '77 000 00 04', city: 'Dakar', photoUrl: '' },
  title: 'Comptable',
  summary: 'Comptable rigoureuse.',
  experiences: [{ title: 'Comptable', company: 'SAS', city: 'Kaolack', start: '2021-03', end: '', current: true, description: 'Paie\nFiscalité' }],
  educations: [{ degree: 'Licence', school: 'UCAD', city: 'Dakar', start: '2016-10', end: '2019-07' }],
  skills: ['Sage', 'Excel'],
  languages: [{ name: 'Wolof', level: 'Langue maternelle' }],
});

async function guest() {
  const agent = request.agent(app);
  const page = await agent.get('/connexion');
  return { agent, csrf: page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1] };
}
const saveCv = (s, body) => s.agent.post('/cv/creer').set('X-CSRF-Token', s.csrf).set('Accept', 'application/json').send(body);

let user; let session;
beforeAll(async () => {
  await resetDb();
  user = await createUser({ email: 'aissatou@example.com', firstName: 'Aïssatou', lastName: 'Fall', headline: 'Comptable senior', city: 'Thiès' });
  session = await loginAs(user);
});
afterAll(closeDb);

const pageCount = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

describe('PDF generation', () => {
  test.each(Object.keys(TEMPLATES))('%s template produces a valid one-page PDF with embedded fonts', async (template) => {
    const pdf = await buildCvPdf({ ...baseCv(), template });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    expect(pdf.toString('latin1')).toMatch(/\/FontFile2/); // Inter / Lora embedded (subset)
    expect(pdf.length).toBeLessThan(120000);
  });

  test.each(Object.keys(TEMPLATES))('%s: long CVs continue on the next pages', async (template) => {
    const cv = baseCv();
    cv.experiences = Array.from({ length: 12 }, (_, i) => ({ ...cv.experiences[0], title: `Poste ${i}`, description: Array.from({ length: 6 }, (__, j) => `Mission ${j} : ${'texte '.repeat(12)}`).join('\n') }));
    cv.skills = Array.from({ length: 25 }, (_, i) => ({ name: `Compétence ${i}`, level: (i % 5) + 1 }));
    const pdf = await buildCvPdf({ ...cv, template });
    expect(pageCount(pdf)).toBeGreaterThan(2);
  });

  test('older saved CVs (first builder format) still render', async () => {
    const pdf = await buildCvPdf({ ...baseCv(), template: 'modern' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('a missing or invalid photo never breaks generation', async () => {
    const cv = baseCv();
    cv.personal.photoUrl = '/uploads/cv-photos/2026/01/doesnotexist.jpg';
    expect((await buildCvPdf(cv)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('period formatting in French', () => {
    expect(period({ start: '2021-03', current: true })).toBe("mars 2021 – Aujourd'hui");
    expect(period({ start: '2016-10', end: '2019-07' })).toBe('oct. 2016 – juil. 2019');
    expect(period({})).toBe('');
  });
});

describe('Live preview', () => {
  test('returns a PDF even for an incomplete CV, never stored; login required', async () => {
    const res = await session.agent.post('/cv/apercu').set('X-CSRF-Token', session.csrf).send({ template: 'prune', personal: { firstName: 'A' } }).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    await user.reload();
    expect(user.cvBuilt).toBeNull();
    const g = await guest();
    expect((await g.agent.post('/cv/apercu').set('X-CSRF-Token', g.csrf).set('Accept', 'application/json').send({})).status).toBe(401);
  });

  test('a foreign photo URL is ignored in the preview', async () => {
    const res = await session.agent.post('/cv/apercu').set('X-CSRF-Token', session.csrf).send({ ...baseCv(), personal: { ...baseCv().personal, photoUrl: 'https://evil.example/x.jpg' } });
    expect(res.status).toBe(200);
  });

  test('pdf.js is served for the preview', async () => {
    const res = await request(app).get('/vendor/pdfjs/pdf.min.mjs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect((await request(app).get('/vendor/pdfjs/../package.json')).status).toBe(404);
  });
});

describe('Builder for logged-in users', () => {
  test('builder is prefilled from the profile', async () => {
    const page = await session.agent.get('/cv/creer');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Comptable senior');
    expect(page.text).not.toContain('ads.txt');
  });

  test('saving stores the CV, makes it the application CV and syncs the profile', async () => {
    const res = await saveCv(session, { ...baseCv(), template: 'emeraude', color: '#0F766E', font: 'serif', qualities: ['Rigueur'], certificates: [{ name: 'Sage Paie', year: '2022' }] });
    expect(res.status).toBe(200);
    expect(res.body.downloadPath).toMatch(/^\/cv\/telecharger\?/);
    expect(res.body.fileName).toBe('CV Aissatou Fall.pdf');
    await user.reload();
    expect(user.cvBuilt.template).toBe('emeraude');
    expect(user.cvBuilt.color).toBe('#0F766E');
    expect(user.cvBuilt.qualities).toEqual(['Rigueur']);
    expect(user.cvBuilt.skills).toEqual([{ name: 'Sage', level: 0 }, { name: 'Excel', level: 0 }]);
    expect(user.cvBuilt.experiences[0]).not.toHaveProperty('_id');
    expect(user.cvUrl).toMatch(/\.pdf$/);
    expect(user.cvName).toBe('CV Aissatou Fall.pdf');
    expect(user.headline).toBe('Comptable senior'); // existing headline kept
    expect(user.skills).toEqual(['Sage', 'Excel']);
    expect(user.experiences[0]).toEqual({ title: 'Comptable', company: 'SAS', period: "mars 2021 – Aujourd'hui" });
    expect(user.languages).toEqual(['Wolof (langue maternelle)']);

    const pdf = await request(app).get(res.body.downloadPath);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('builder reopens with the saved CV', async () => {
    const page = await session.agent.get('/cv/creer');
    expect(page.text).toContain('&#34;template&#34;:&#34;emeraude&#34;');
  });

  test('the saved CV is offered when applying', async () => {
    const recruiter = await createUser({ email: 'rh@ex.com', role: 'recruiter' });
    const post = await Post.create({ type: 'advice', title: 'Conseil', authorId: recruiter.id, type: 'job' });
    const job = await Job.create({ postId: post.id, slug: buildSlug('Comptable', 'Dakar'), title: 'Comptable', companyName: 'X', location: 'Dakar', contractType: 'CDI', sector: 'Comptabilité', description: 'x'.repeat(40), applyEmail: 'rh@ex.com' });
    const res = await session.agent.post(`/offres/${job.slug}/postuler`).set('X-CSRF-Token', session.csrf).set('Accept', 'application/json')
      .field('firstName', 'Aïssatou').field('lastName', 'Fall').field('email', 'aissatou@example.com').field('phone', '770000004').field('cvSource', 'profile');
    expect(res.status).toBe(201);
    await user.reload();
    expect((await Application.findByPk(res.body.id)).cvKey).toBe(user.cvUrl);
  });
});

describe('Validation', () => {
  test.each([
    [(cv) => { cv.personal.firstName = 'A'; }, 'personal.firstName'],
    [(cv) => { cv.personal.email = 'nope'; }, 'personal.email'],
    [(cv) => { cv.title = ''; }, 'title'],
    [(cv) => { cv.experiences[0].start = '2021-13'; }, 'experiences.0.start'],
    [(cv) => { cv.experiences[0].title = ''; }, 'experiences.0.title'],
    [(cv) => { cv.languages[0].level = 'Expert++'; }, 'languages.0.level'],
    [(cv) => { cv.skills = Array.from({ length: 31 }, (_, i) => `s${i}`); }, 'skills'],
    [(cv) => { cv.skills = [{ name: 'Excel', level: 9 }]; }, 'skills.0.level'],
    [(cv) => { cv.color = 'red'; }, 'color'],
    [(cv) => { cv.personal.photoUrl = 'https://evil.example/x.jpg'; }, 'personal.photoUrl'],
    [(cv) => { cv.personal.photoUrl = 'javascript:alert(1)'; }, 'personal.photoUrl'],
    [(cv) => { cv.template = 'other'; }, 'template'],
  ])('rejects invalid data %#', async (mutate, path) => {
    const cv = baseCv();
    mutate(cv);
    const res = await saveCv(session, cv);
    expect(res.status).toBe(422);
    expect(res.body.path).toBe(path);
  });

  test('requires CSRF', async () => {
    const res = await session.agent.post('/cv/creer').set('Accept', 'application/json').send(baseCv());
    expect(res.status).toBe(403);
  });
});

describe('Guests and the CV builder', () => {
  test('creating a CV requires an account (page, save and photo)', async () => {
    const g = await guest();
    const page = await g.agent.get('/cv/creer?retour=%2Foffres%2Fabc%3Fpostuler%3D1');
    expect(page.status).toBe(302);
    expect(page.headers.location).toMatch(/^\/connexion\?retour=/);
    expect((await saveCv(g, baseCv())).status).toBe(401);
    const photo = await g.agent.post('/cv/photo').set('X-CSRF-Token', g.csrf).set('Accept', 'application/json').attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' });
    expect(photo.status).toBe(401);
  });

  test('return path is restricted to this site (no open redirect)', () => {
    expect(safeReturn('/offres/abc?postuler=1')).toBe('/offres/abc?postuler=1');
    expect(safeReturn('//evil.com')).toBeNull();
    expect(safeReturn('https://evil.com')).toBeNull();
    expect(safeReturn('/a"onmouseover=x')).toBeNull();
  });

  test('photo upload accepts images only', async () => {
    const ok = await session.agent.post('/cv/photo').set('X-CSRF-Token', session.csrf).set('Accept', 'application/json').attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' });
    expect(ok.status).toBe(200);
    expect(ok.body.url).toMatch(/^\/uploads\/cv-photos\//);
    const bad = await session.agent.post('/cv/photo').set('X-CSRF-Token', session.csrf).set('Accept', 'application/json').attach('photo', Buffer.from('%PDF-1.4 nope'), { filename: 'p.png', contentType: 'image/png' });
    expect(bad.status).toBe(422);
  });
});
