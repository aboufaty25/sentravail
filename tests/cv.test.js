const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job, Application } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');
const { buildCvPdf, period } = require('../src/services/cvPdf');
const { safeReturn } = require('../src/controllers/cvController');

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

describe('PDF generation', () => {
  test.each(['classic', 'modern'])('%s template produces a valid PDF with metadata', async (template) => {
    const pdf = await buildCvPdf({ ...baseCv(), template });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  test('long CVs flow onto several pages', async () => {
    const cv = baseCv();
    cv.experiences = Array.from({ length: 10 }, (_, i) => ({ ...cv.experiences[0], title: `Poste ${i}`, description: 'Texte. '.repeat(120) }));
    const pdf = await buildCvPdf({ ...cv, template: 'modern' });
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    expect(pages).toBeGreaterThan(1);
  });

  test('a missing or invalid photo never breaks generation', async () => {
    const cv = baseCv();
    cv.personal.photoUrl = '/uploads/cv-photos/2026/01/doesnotexist.jpg';
    expect((await buildCvPdf(cv)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('period formatting in French', () => {
    expect(period({ start: '2021-03', current: true })).toBe("mars 2021 — aujourd'hui");
    expect(period({ start: '2016-10', end: '2019-07' })).toBe('oct. 2016 — juil. 2019');
    expect(period({})).toBe('');
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
    const res = await saveCv(session, { ...baseCv(), template: 'modern' });
    expect(res.status).toBe(200);
    expect(res.body.downloadPath).toMatch(/^\/cv\/telecharger\?/);
    await user.reload();
    expect(user.cvBuilt.template).toBe('modern');
    expect(user.cvBuilt.experiences[0]).not.toHaveProperty('_id');
    expect(user.cvUrl).toMatch(/\.pdf$/);
    expect(user.cvName).toBe('CV Aissatou Fall.pdf');
    expect(user.headline).toBe('Comptable senior'); // existing headline kept
    expect(user.skills).toEqual(['Sage', 'Excel']);
    expect(user.experiences[0]).toEqual({ title: 'Comptable', company: 'SAS', period: "mars 2021 — aujourd'hui" });
    expect(user.languages).toEqual(['Wolof (langue maternelle)']);

    const pdf = await request(app).get(res.body.downloadPath);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('builder reopens with the saved CV', async () => {
    const page = await session.agent.get('/cv/creer');
    expect(page.text).toContain('&#34;template&#34;:&#34;modern&#34;');
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

describe('Guests: create a CV from the apply modal', () => {
  test('the CV built in the session can be used to apply, not by another visitor', async () => {
    const recruiter = await createUser({ email: 'rh2@ex.com', role: 'recruiter' });
    const post = await Post.create({ type: 'advice', title: 'Conseil', authorId: recruiter.id, type: 'job' });
    const job = await Job.create({ postId: post.id, slug: buildSlug('Dev', 'Dakar'), title: 'Dev', companyName: 'Y', location: 'Dakar', contractType: 'CDI', sector: 'Informatique & Télécoms', description: 'x'.repeat(40), applyEmail: 'rh2@ex.com' });

    const g = await guest();
    const back = `/offres/${job.slug}?postuler=1`;
    const page = await g.agent.get(`/cv/creer?retour=${encodeURIComponent(back)}`);
    expect(page.status).toBe(200);
    const saved = await saveCv(g, { ...baseCv(), personal: { ...baseCv().personal, email: 'guest@example.com' }, returnTo: back });
    expect(saved.status).toBe(200);
    expect(saved.body.returnTo).toBe(back);

    const jobPage = await g.agent.get(back);
    expect(jobPage.text).toContain('CV Aissatou Fall.pdf'); // offered in the modal
    expect(jobPage.text).toContain(`$dispatch(&#39;open-apply&#39;, { slug: &#39;${job.slug}&#39;`);

    const fields = { firstName: 'Awa', lastName: 'Ba', email: 'guest@example.com', phone: '770001122', cvSource: 'built' };
    let req = g.agent.post(`/offres/${job.slug}/postuler`).set('X-CSRF-Token', g.csrf).set('Accept', 'application/json');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    const res = await req;
    expect(res.status).toBe(201);
    expect((await Application.findByPk(res.body.id)).cvName).toBe('CV Aissatou Fall.pdf');

    const stranger = await guest();
    let req2 = stranger.agent.post(`/offres/${job.slug}/postuler`).set('X-CSRF-Token', stranger.csrf).set('Accept', 'application/json');
    for (const [k, v] of Object.entries({ ...fields, email: 'other@example.com' })) req2 = req2.field(k, v);
    const denied = await req2;
    expect(denied.status).toBe(422);
    expect(denied.body.errors.cv).toBeTruthy();
  });

  test('return path is restricted to this site (no open redirect)', () => {
    expect(safeReturn('/offres/abc?postuler=1')).toBe('/offres/abc?postuler=1');
    expect(safeReturn('//evil.com')).toBeNull();
    expect(safeReturn('https://evil.com')).toBeNull();
    expect(safeReturn('/a"onmouseover=x')).toBeNull();
  });

  test('photo upload accepts images only', async () => {
    const g = await guest();
    const ok = await g.agent.post('/cv/photo').set('X-CSRF-Token', g.csrf).set('Accept', 'application/json').attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' });
    expect(ok.status).toBe(200);
    expect(ok.body.url).toMatch(/^\/uploads\/cv-photos\//);
    const bad = await g.agent.post('/cv/photo').set('X-CSRF-Token', g.csrf).set('Accept', 'application/json').attach('photo', Buffer.from('%PDF-1.4 nope'), { filename: 'p.png', contentType: 'image/png' });
    expect(bad.status).toBe(422);
  });
});
