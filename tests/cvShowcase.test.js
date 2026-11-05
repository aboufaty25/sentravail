// CV showcase ("Vitrine des CV"): admin management, consent, masking, slider placement.
const PDFDocument = require('pdfkit');
const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job, CvShowcase, User } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');
const showcase = require('../src/services/cvShowcase');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const pdfBuffer = () => new Promise((resolve) => {
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.text('CV de test');
  doc.end();
});
const builtCv = {
  template: 'classique',
  personal: { firstName: 'Awa', lastName: 'Ndiaye', email: 'awa@example.com', phone: '77 123 45 67', address: 'Rue 10, Dakar', website: 'awa.sn', nationality: 'Sénégalaise' },
  title: 'Comptable', summary: 'Rigoureuse.', experiences: [], educations: [], skills: [{ name: 'Sage', level: 4 }],
};

let adm; let cand; let candidate; let other;
beforeAll(async () => {
  await resetDb();
  const admin = await createUser({ email: 'adm@ex.com', role: 'admin' });
  candidate = await createUser({ email: 'awa@ex.com', firstName: 'Awa', lastName: 'Ndiaye', cvBuilt: builtCv, cvShowcaseRefused: true });
  other = await createUser({ email: 'other@ex.com', firstName: 'Moussa', lastName: 'Sarr', cvBuilt: builtCv });
  [adm, cand] = await Promise.all([loginAs(admin), loginAs(candidate)]);
  // Feed with 5 offers.
  const recruiter = await createUser({ email: 'rec@ex.com', role: 'recruiter' });
  for (let i = 0; i < 5; i += 1) {
    const post = await Post.create({ authorId: recruiter.id, type: 'job' });
    await Job.create({ postId: post.id, slug: buildSlug(`Poste ${i}`, 'Dakar'), title: `Poste ${i}`, companyName: 'Ba', location: 'Dakar', contractType: 'CDI', sector: 'Comptabilité', description: 'x'.repeat(40), applyEmail: 'a@b.sn' });
  }
});
afterAll(closeDb);

const addMember = (userId) => adm.agent.post('/admin/cv/vitrine').type('form').send({ _csrf: adm.csrf, userId });

test('admin only: every CV page and action', async () => {
  for (const path of ['/admin/cv', '/admin/cv/crees', '/admin/cv/importes']) {
    expect((await cand.agent.get(path)).status).toBe(403);
    expect((await adm.agent.get(path)).status).toBe(200);
  }
  expect((await cand.agent.post('/admin/cv/vitrine').type('form').send({ _csrf: cand.csrf, userId: other.id })).status).toBe(403);
  expect(await CvShowcase.count()).toBe(0);
});

test('the admin lists the CVs created on the site; members who refused are marked', async () => {
  const page = (await adm.agent.get('/admin/cv/crees')).text;
  expect(page).toContain('Awa Ndiaye');
  expect(page).toContain('Moussa Sarr');
  expect(page).toContain('Refuse la vitrine');
  expect((page.match(/name="userId"/g) || []).length).toBe(1); // only Moussa can be added
});

test('no prior consent needed, refusal respected; the published copy has no email, phone or address', async () => {
  const refused = await addMember(candidate.id);
  expect(refused.status).toBe(302);
  expect(await CvShowcase.count()).toBe(0);

  expect((await addMember(other.id)).status).toBe(302);
  const item = await CvShowcase.findOne({ where: { userId: other.id } });
  expect(item).toMatchObject({ source: 'built', name: 'Moussa Sarr', title: 'Comptable', isActive: true });
  expect((await addMember(other.id)).status).toBe(302); // already there: not duplicated
  expect(await CvShowcase.count()).toBe(1);

  const masked = showcase.maskCv(builtCv);
  expect(masked.personal).toMatchObject({ email: '', phone: '', address: '', website: '', firstName: 'Awa', nationality: 'Sénégalaise' });
});

test('slider: at the top of the home feed (before the first offer), at the bottom of offer pages; viewer public', async () => {
  const home = (await request(app).get('/')).text;
  expect((home.match(/data-reels>/g) || []).length).toBe(1);
  expect(home.indexOf('data-reels>')).toBeLessThan(home.indexOf('data-post-type="job"'));
  expect(home).toContain('Moussa Sarr');
  expect(home).toContain('Créer un CV');
  const since = home.match(/since=(\d+)/)[1];
  expect((await request(app).get(`/fil?page=2&since=${since}`)).text).not.toContain('data-reels>');

  const job = await Job.findOne();
  expect((await request(app).get(`/offres/${job.slug}`)).text).toContain('data-reels>');

  const item = await CvShowcase.findOne();
  const viewer = await request(app).get(`/cv/vitrine?id=${item.id}`);
  expect(viewer.status).toBe(200);
  expect(viewer.text).toContain('data-reels-viewer');
  expect(viewer.text).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(viewer.text).not.toContain('awa@example.com');
  expect(viewer.text).toContain('Email et téléphone visibles par les recruteurs vérifiés.');
  expect((await CvShowcase.findByPk(item.id)).viewsCount).toBe(1);
  // Builder CV: the public copy (no contact details) can be opened.
  const pdf = await request(app).get(`/cv/vitrine/${item.id}/cv.pdf`);
  expect(pdf.status).toBe(200);
  expect(pdf.headers['content-type']).toBe('application/pdf');
});

test('complete CV with contact details: verified recruiters and admins only', async () => {
  const item = await CvShowcase.findOne();
  expect((await request(app).get(`/cv/vitrine/${item.id}/complet`)).status).toBe(302); // guest: login
  expect((await cand.agent.get(`/cv/vitrine/${item.id}/complet`)).status).toBe(403);
  // A recruiter account without the verified badge does not see contact details.
  const unverified = await loginAs(await createUser({ email: 'rh2@ex.com', role: 'recruiter', isVerified: false }));
  expect((await unverified.agent.get(`/cv/vitrine/${item.id}/complet`)).status).toBe(403);
  const page = (await unverified.agent.get(`/cv/vitrine?id=${item.id}`)).text;
  expect(page).not.toContain(`/cv/vitrine/${item.id}/complet`);
  expect(page).toContain('Obtenir le badge vérifié');
  const rec = await loginAs(await createUser({ email: 'rh@ex.com', role: 'recruiter', isVerified: true }));
  const full = await rec.agent.get(`/cv/vitrine/${item.id}/complet`);
  expect(full.status).toBe(200);
  expect(full.headers['content-type']).toBe('application/pdf');
  expect((await rec.agent.get(`/cv/vitrine?id=${item.id}`)).text).toContain(`/cv/vitrine/${item.id}/complet`);
  expect((await adm.agent.get(`/cv/vitrine/${item.id}/complet`)).status).toBe(200);
});

test('thumbnails: uploaded by the admin page (images only), shown on the cards', async () => {
  const item = await CvShowcase.findOne();
  expect((await cand.agent.post(`/admin/cv/vitrine/${item.id}/images`).set('X-CSRF-Token', cand.csrf).attach('small', PNG, 's.png').attach('large', PNG, 'l.png')).status).toBe(403);
  const res = await adm.agent.post(`/admin/cv/vitrine/${item.id}/images`).set('X-CSRF-Token', adm.csrf).field('masked', '1').attach('small', PNG, 's.png').attach('large', PNG, 'l.png');
  expect(res.status).toBe(200);
  const fresh = await CvShowcase.findByPk(item.id);
  expect(fresh.thumbnail).toMatch(/^\/uploads\/cv-showcase\//);
  expect(fresh.masked).toBe(true);
  expect((await request(app).get('/')).text).toContain(fresh.thumbnail);
});

test('admin upload: PDF only, name required', async () => {
  const pdf = await pdfBuffer();
  const post = (fields, file = pdf, name = 'cv.pdf') => {
    let req = adm.agent.post(`/admin/cv/vitrine/ajouter?_csrf=${adm.csrf}`);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return file ? req.attach('cv', file, name) : req;
  };
  expect((await post({ title: 'Commerciale' })).status).toBe(422); // name required
  expect((await post({ name: 'Fatou Sow' }, Buffer.from('not a pdf'), 'cv.pdf')).status).toBe(422);
  expect((await post({ name: 'Fatou Sow', title: 'Commerciale' })).status).toBe(302);
  const item = await CvShowcase.findOne({ where: { name: 'Fatou Sow', userId: null } });
  expect(item).not.toBeNull();
  // An imported PDF keeps its contact details: never served to the public, images only once masked.
  expect((await request(app).get(`/cv/vitrine/${item.id}/cv.pdf`)).status).toBe(404);
  const upload = (masked) => {
    let req = adm.agent.post(`/admin/cv/vitrine/${item.id}/images`).set('X-CSRF-Token', adm.csrf);
    if (masked) req = req.field('masked', '1');
    return req.attach('small', PNG, 's.png').attach('large', PNG, 'l.png');
  };
  await upload(false);
  showcase.invalidate();
  const unmasked = await CvShowcase.findByPk(item.id);
  expect((await request(app).get('/')).text).not.toContain(unmasked.thumbnail);
  expect((await request(app).get(`/cv/vitrine?id=${item.id}`)).text).not.toContain(unmasked.image);
  await upload(true);
  showcase.invalidate();
  const masked = await CvShowcase.findByPk(item.id);
  expect((await request(app).get('/')).text).toContain(masked.thumbnail);
});

test('order, hide and remove', async () => {
  const [first, second] = await CvShowcase.findAll({ order: [['sortOrder', 'ASC'], ['id', 'DESC']] });
  const act = (id, action) => adm.agent.post(`/admin/cv/vitrine/${id}`).type('form').send({ _csrf: adm.csrf, action });
  await act(second.id, 'up');
  expect((await showcase.visibleItems())[0].id).toBe(second.id);
  await act(second.id, 'toggle');
  expect((await showcase.visibleItems()).map((i) => i.id)).not.toContain(second.id);
  expect((await request(app).get(`/cv/vitrine/${second.id}/cv.pdf`)).status).toBe(404);
  await act(second.id, 'remove');
  expect(await CvShowcase.findByPk(second.id)).toBeNull();
  expect(first).toBeTruthy();
});

test('refusing from the profile removes the CV at once; a suspended account is never shown', async () => {
  const otherSession = await loginAs(other);
  if (!(await CvShowcase.findOne({ where: { userId: other.id } }))) await addMember(other.id);
  const item = await CvShowcase.findOne({ where: { userId: other.id } });
  expect(item).not.toBeNull();
  await User.update({ isBanned: true }, { where: { id: other.id } });
  showcase.invalidate();
  expect((await showcase.slider()).map((i) => i.id)).not.toContain(item.id);
  await User.update({ isBanned: false }, { where: { id: other.id } });

  const res = await otherSession.agent.post('/parametres/profil').type('form').send({ _csrf: otherSession.csrf, firstName: 'Moussa', lastName: 'Sarr', cvShowcaseRefused: 'on' });
  expect(res.status).toBe(302);
  expect((await User.findByPk(other.id)).cvShowcaseRefused).toBe(true);
  expect(await CvShowcase.count({ where: { userId: other.id } })).toBe(0);
});

test('a candidate who changes their mind (box unticked) can be shown again; the rule is in the legal pages', async () => {
  const res = await cand.agent.post('/parametres/profil').type('form').send({ _csrf: cand.csrf, firstName: 'Awa', lastName: 'Ndiaye' });
  expect(res.status).toBe(302);
  expect((await User.findByPk(candidate.id)).cvShowcaseRefused).toBe(false);
  for (const path of ['/conditions', '/confidentialite']) expect((await request(app).get(path)).text).toContain('id="vitrine"');
  expect((await addMember(candidate.id)).status).toBe(302);
  expect(await CvShowcase.count({ where: { userId: candidate.id } })).toBe(1);
});

test('the first card imports an existing CV and comes back to the page', async () => {
  const pdf = await pdfBuffer();
  const res = await cand.agent.post(`/cv/importer?_csrf=${cand.csrf}`).field('retour', '/offres').attach('cv', pdf, 'mon-cv.pdf');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/offres');
  expect((await User.findByPk(candidate.id)).cvName).toBe('mon-cv.pdf');
  const home = (await cand.agent.get('/')).text;
  expect(home).toContain('/cv/importer?_csrf=');
  expect(home).toContain('Importer un CV');
  expect((await request(app).get('/')).text).toContain('data-login="Connectez-vous pour importer votre CV."');
});
