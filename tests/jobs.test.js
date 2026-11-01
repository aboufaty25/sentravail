const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');
const { jobPostingJsonLd } = require('../src/controllers/jobController');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const validJob = {
  title: 'Comptable confirmé',
  companyName: 'Ba Services',
  location: 'Dakar',
  contractType: 'CDI',
  sector: 'Comptabilité',
  description: 'Tenue de la comptabilité générale et analytique, déclarations fiscales mensuelles.',
  applyEmail: 'rh@ba.example',
  deadline: inDays(10),
};

let candidate; let recruiter; let otherRecruiter; let admin;
let cand; let rec; let other; let adm;

beforeAll(async () => {
  await resetDb();
  candidate = await createUser({ email: 'cand@ex.com', city: 'Dakar' });
  recruiter = await createUser({ email: 'rec@ex.com', role: 'recruiter', companyName: 'Ba Services' });
  otherRecruiter = await createUser({ email: 'rec2@ex.com', role: 'recruiter', companyName: 'Autre' });
  admin = await createUser({ email: 'admin@ex.com', role: 'admin' });
  [cand, rec, other, adm] = await Promise.all([loginAs(candidate), loginAs(recruiter), loginAs(otherRecruiter), loginAs(admin)]);
});
afterAll(closeDb);

const createJob = (s, data = validJob, file) => {
  let req = s.agent.post(`/offres/nouvelle?_csrf=${s.csrf}`);
  for (const [k, v] of Object.entries(data)) req = req.field(k, v);
  if (file) req = req.attach('companyLogo', file, { filename: 'logo.png', contentType: 'image/png' });
  return req;
};
const lastJob = () => Job.findOne({ order: [['id', 'DESC']], include: [{ model: Post, as: 'post' }] });

describe('Publishing jobs', () => {
  test('candidates cannot publish jobs', async () => {
    expect((await cand.agent.get('/offres/nouvelle')).status).toBe(403);
    const before = await Job.count();
    expect((await createJob(cand)).status).toBe(403);
    expect(await Job.count()).toBe(before);
  });

  test('guests are redirected to login', async () => {
    const res = await request(app).get('/offres/nouvelle');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/connexion');
  });

  test('multipart form requires the CSRF token', async () => {
    const res = await rec.agent.post('/offres/nouvelle').field('title', 'x');
    expect(res.status).toBe(403);
  });

  test('recruiter publishes a job with logo; readable slug; visible immediately', async () => {
    const res = await createJob(rec, { ...validJob, requestFeatured: 'on', text: 'Nous recrutons !' }, PNG);
    expect(res.status).toBe(302);
    const job = await lastJob();
    expect(res.headers.location).toBe(`/offres/${job.slug}`);
    expect(job.slug).toMatch(/^comptable-confirme-dakar-[a-f0-9]{6}$/);
    expect(job.post.type).toBe('job');
    expect(job.post.authorId).toBe(recruiter.id);
    expect(job.post.status).toBe('published');
    expect(job.post.featureStatus).toBe('pending');
    expect(job.post.isFeatured).toBe(false);
    expect(job.isOfficial).toBe(false);
    expect(job.companyLogo).toMatch(/^\/uploads\/logos\//);
    await recruiter.reload();
    expect(recruiter.companyLogo).toBe(job.companyLogo); // first logo saved on the company profile
  });

  test('recruiter cannot make an official offer', async () => {
    await createJob(rec, { ...validJob, isOfficial: 'on' });
    const job = await lastJob();
    expect(job.isOfficial).toBe(false);
    expect(job.post.isFeatured).toBe(false);
  });

  test('admin official offer is featured for FEATURED_DAYS', async () => {
    await createJob(adm, { ...validJob, title: 'Offre officielle', isOfficial: 'on' });
    const job = await lastJob();
    expect(job.isOfficial).toBe(true);
    expect(job.post.isFeatured).toBe(true);
    expect(job.post.featureStatus).toBe('approved');
    const days = (new Date(job.post.featuredUntil) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  test.each([
    [{ title: 'x' }, 'Intitulé du poste'],
    [{ location: 'Paris' }, 'Choisissez une ville.'],
    [{ contractType: 'CDI à vie' }, 'Choisissez un type de contrat.'],
    [{ description: 'trop court' }, '30 caractères minimum'],
    [{ applyEmail: 'pas-un-email' }, 'Adresse email de candidature invalide.'],
    [{ deadline: '2020-01-01' }, 'La date limite doit être dans le futur.'],
  ])('validation: %p', async (override, message) => {
    const before = await Job.count();
    const res = await createJob(rec, { ...validJob, ...override });
    expect(res.status).toBe(422);
    expect(res.text).toContain(message);
    expect(await Job.count()).toBe(before);
  });

  test('/publier?type=job redirects to the job form', async () => {
    const res = await rec.agent.get('/publier?type=job');
    expect(res.headers.location).toBe('/offres/nouvelle');
  });
});

describe('Job page', () => {
  let job;
  beforeAll(async () => {
    await createJob(rec, { ...validJob, title: 'Développeur <script>alert(1)</script>', description: 'Description </script><script>alert(2)</script> assez longue pour passer.' });
    job = await lastJob();
  });

  test('is public, server-rendered, escaped, with JobPosting structured data', async () => {
    const res = await request(app).get(`/offres/${job.slug}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<script type="application/ld+json">');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).not.toContain('</script><script>alert(2)');
    const ld = JSON.parse(res.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    expect(ld['@type']).toBe('JobPosting');
    expect(ld.employmentType).toBe('FULL_TIME');
    expect(ld.jobLocation.address.addressLocality).toBe('Dakar');
    expect(ld.validThrough).toBe(`${validJob.deadline}T23:59:59Z`);
    expect(res.text).toContain(`rel="canonical" href="http://localhost:3000/offres/${job.slug}"`);
    expect(res.text).toContain('property="og:title"');
  });

  test('JSON-LD cannot break out of its script tag', () => {
    const json = jobPostingJsonLd({ createdAt: new Date(), job: { ...job.get({ plain: true }), description: '</script><b>x</b>', url: '/offres/x' } });
    expect(json).not.toContain('</script>');
  });

  test('counts views from others only', async () => {
    const before = (await Post.findByPk(job.postId)).viewsCount;
    await cand.agent.get(`/offres/${job.slug}`);
    await rec.agent.get(`/offres/${job.slug}`);
    expect((await Post.findByPk(job.postId)).viewsCount).toBe(before + 1);
  });

  test('unknown or malformed slug is a 404', async () => {
    expect((await request(app).get('/offres/nexiste-pas-123456')).status).toBe(404);
    expect((await request(app).get('/offres/..%2F..%2Fetc')).status).toBe(404);
  });

  test('expired job shows as closed', async () => {
    await job.update({ deadline: inDays(-1) });
    const res = await request(app).get(`/offres/${job.slug}`);
    expect(res.text).toContain('Expirée');
    expect(res.text).toContain('clôturée');
    await job.update({ deadline: inDays(10) });
  });
});

describe('Editing and deleting jobs', () => {
  let job;
  beforeAll(async () => {
    await createJob(rec, { ...validJob, title: 'À modifier' });
    job = await lastJob();
  });
  const edit = (s, data) => {
    let req = s.agent.post(`/offres/${job.slug}/modifier?_csrf=${s.csrf}`);
    for (const [k, v] of Object.entries(data)) req = req.field(k, v);
    return req;
  };

  test('only the owner or an admin can edit', async () => {
    expect((await other.agent.get(`/offres/${job.slug}/modifier`)).status).toBe(403);
    expect((await edit(other, { ...validJob, title: 'Piraté' })).status).toBe(403);
    expect((await edit(cand, { ...validJob, title: 'Piraté' })).status).toBe(403);
    await job.reload();
    expect(job.title).toBe('À modifier');

    expect((await edit(rec, { ...validJob, title: 'Modifié', salary: '300 000 FCFA' })).status).toBe(302);
    await job.reload();
    expect(job.title).toBe('Modifié');
    expect(job.salary).toBe('300 000 FCFA');
    expect(job.slug).toMatch(/^a-modifier-dakar-/); // slug stable so shared links keep working

    expect((await edit(adm, { ...validJob, title: 'Modéré' })).status).toBe(302);
  });

  test('only the owner or an admin can delete; job row cascades', async () => {
    const del = (s) => s.agent.post(`/offres/${job.slug}/supprimer`).type('form').send({ _csrf: s.csrf });
    expect((await del(other)).status).toBe(403);
    expect((await del(cand)).status).toBe(403);
    expect((await del(rec)).status).toBe(302);
    expect(await Job.findByPk(job.id)).toBeNull();
    expect(await Post.findByPk(job.postId)).toBeNull();
  });
});

describe('Search', () => {
  beforeAll(async () => {
    await Job.destroy({ where: {} });
    await Post.destroy({ where: { type: 'job' } });
    const mk = async (author, data, postExtra = {}) => {
      const post = await Post.create({ authorId: author.id, type: 'job', ...postExtra });
      return Job.create({ ...validJob, ...data, postId: post.id, slug: buildSlug(data.title, data.location || 'Dakar') });
    };
    await mk(recruiter, { title: 'Comptable Dakar', location: 'Dakar', contractType: 'CDI', sector: 'Comptabilité' });
    await mk(recruiter, { title: 'Stage marketing', location: 'Thiès', contractType: 'Stage', sector: 'Marketing & Communication' });
    await mk(recruiter, { title: 'Infirmier', location: 'Saint-Louis', contractType: 'CDD', sector: 'Santé', companyName: 'Clinique Test' });
    await mk(recruiter, { title: 'Ancienne offre comptable', deadline: inDays(-3) });
    await mk(recruiter, { title: 'Sans date', deadline: null, contractType: 'Freelance' });
    await mk(admin, { title: 'Officielle à la une', isOfficial: true }, { isFeatured: true, featuredUntil: new Date(Date.now() + 86_400_000) });
  });

  const titles = (html) => [...html.matchAll(/class="mt-0\.5 block text-\[17px\][^"]*">([^<]+)<\/a>/g)].map((m) => m[1]);

  test('lists active jobs only, featured first', async () => {
    const res = await request(app).get('/offres');
    expect(res.status).toBe(200);
    const t = titles(res.text);
    expect(t[0]).toBe('Officielle à la une');
    expect(t).toContain('Sans date');
    expect(t).not.toContain('Ancienne offre comptable');
    expect(res.text).toContain('<strong>5</strong> offres');
  });

  test('filters by city, sector, contract and keyword (title, company, description)', async () => {
    expect(titles((await request(app).get('/offres?ville=Thi%C3%A8s')).text)).toEqual(['Stage marketing']);
    expect(titles((await request(app).get('/offres?contrat=CDD')).text)).toEqual(['Infirmier']);
    expect(titles((await request(app).get('/offres?secteur=Sant%C3%A9')).text)).toEqual(['Infirmier']);
    expect(titles((await request(app).get('/offres?q=clinique')).text)).toEqual(['Infirmier']);
    expect(titles((await request(app).get('/offres?q=comptable&ville=Dakar')).text)).toEqual(['Comptable Dakar']);
  });

  test('ignores unknown filter values and escapes LIKE wildcards', async () => {
    expect((await request(app).get('/offres?ville=Paris&contrat=xx')).text).toContain('<strong>5</strong>');
    expect((await request(app).get('/offres?q=%25')).text).toContain('Aucune offre');
  });

  test('global search "Offres" tab forwards to job search with filters', async () => {
    const res = await request(app).get('/recherche?type=offres&q=stage&ville=Thi%C3%A8s');
    expect(res.headers.location).toBe('/offres?q=stage&ville=Thi%C3%A8s');
  });
});

describe('Featured jobs in the feed', () => {
  test('featured jobs are pinned on top of the feed, once', async () => {
    const res = await cand.agent.get('/');
    // Count rendered job titles (the title also appears inside the Postuler button handler).
    const titleLinks = res.text.match(/>Officielle à la une<\/a>/g) || [];
    expect(titleLinks).toHaveLength(1);
    expect(res.text.indexOf('À la une')).toBeLessThan(res.text.indexOf('Comptable Dakar') === -1 ? Infinity : res.text.indexOf('Comptable Dakar'));
  });

  test('expired featuring is no longer pinned', async () => {
    const job = await Job.findOne({ where: { title: 'Officielle à la une' } });
    await Post.update({ featuredUntil: new Date(Date.now() - 1000) }, { where: { id: job.postId } });
    const sidebar = await request(app).get('/offres-a-la-une');
    expect(sidebar.text).not.toContain('Officielle à la une');
  });

  test('Mes offres is reserved to recruiters and admins and lists own jobs', async () => {
    expect((await cand.agent.get('/mes-offres')).status).toBe(403);
    const res = await rec.agent.get('/mes-offres');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Comptable Dakar');
    expect(res.text).not.toContain('Officielle à la une');
  });
});
