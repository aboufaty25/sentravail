const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, request, resetDb, closeDb, createUser } = require('./helpers');
const { Job, Post, SiteSetting } = require('../src/models');
const { jobSchema } = require('../src/validators/job');
const { importFile, importPending, IMPORT_DIR } = require('../src/services/jobImport');
const env = require('../src/config/env');

const REAL = path.join(IMPORT_DIR, '2026-11-02-offres.json');

beforeAll(resetDb);
afterAll(async () => { env.ADMIN_EMAILS = ''; await closeDb(); });

test('the prepared offers file is valid (all fields accepted by the job form rules)', () => {
  const { jobs } = JSON.parse(fs.readFileSync(REAL, 'utf8'));
  expect(jobs).toHaveLength(15);
  for (const j of jobs) {
    const parsed = jobSchema.safeParse({ ...j, deadline: '' }); // deadlines checked separately (they pass with time)
    if (!parsed.success) throw new Error(`${j.title}: ${parsed.error.issues[0].message}`);
    expect(j.description).not.toMatch(/Tags à fort CPC|\*\*|^#/m);
  }
});

test('the 3 November file: 4 valid offers and one career advice post (max 2000 characters)', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(IMPORT_DIR, '2026-11-03-offres.json'), 'utf8'));
  expect(data.jobs).toHaveLength(4);
  for (const j of data.jobs) {
    const parsed = jobSchema.safeParse({ ...j, deadline: '' });
    if (!parsed.success) throw new Error(`${j.title}: ${parsed.error.issues[0].message}`);
  }
  expect(data.advice).toHaveLength(1);
  expect(data.advice[0].text.length).toBeLessThanOrEqual(2000);
  expect(data.advice[0].text).toContain("Un vrai recruteur ne demande jamais d'argent");
});

test('career advice posts are imported once, public, under the admin', async () => {
  const admin = await createUser({ role: 'admin', email: 'conseil@ex.com' });
  const file = path.join(os.tmpdir(), `conseils-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ advice: [{ title: 'Travailler en Italie', text: 'Explications détaillées du programme officiel.' }] }));
  const report = await importFile(file, admin);
  expect(report.created).toEqual(['Conseil : Travailler en Italie']);
  const post = await Post.findOne({ where: { type: 'advice', title: 'Travailler en Italie' } });
  expect(post.status).toBe('published');
  expect(post.authorId).toBe(admin.id);
  expect((await request(app).get(`/publications/${post.id}`)).status).toBe(200);
  expect((await importFile(file, admin)).created).toHaveLength(0);
  fs.unlinkSync(file);
});

test('import publishes once under the admin, visible to everyone, skips duplicates and closed offers', async () => {
  const admin = await createUser({ role: 'admin', email: 'boss@ex.com' });
  const file = path.join(os.tmpdir(), `offres-${Date.now()}.json`);
  const base = { companyName: 'BNDE', location: 'Dakar', contractType: 'CDI', sector: 'Banque & Finance', description: 'Une description suffisamment longue pour être valide.' };
  fs.writeFileSync(file, JSON.stringify({ jobs: [
    { ...base, title: 'Téléconseiller', applyMode: 'email', applyEmail: 'recrutement@bnde.sn', deadline: null },
    { ...base, title: 'Maçon', applyMode: 'link', applyUrl: 'https://example.com/postuler', deadline: null },
    { ...base, title: 'Ancienne offre', applyMode: 'email', applyEmail: 'a@b.sn', deadline: '2020-01-01' },
  ] }));
  const report = await importFile(file, admin);
  expect(report.created).toHaveLength(2);
  expect(report.skipped).toHaveLength(1);
  const job = await Job.findOne({ where: { title: 'Téléconseiller' }, include: [{ model: Post, as: 'post' }] });
  expect(job.post.authorId).toBe(admin.id);
  expect(job.post.status).toBe('published');
  expect(job.post.featureStatus).toBe('approved');
  expect(job.post.isFeatured).toBe(false);
  // Public page and everyone's feed.
  expect((await request(app).get(`/offres/${job.slug}`)).status).toBe(200);
  expect((await request(app).get('/')).text).toContain('Téléconseiller');
  // Second run: nothing duplicated.
  expect((await importFile(file, admin)).created).toHaveLength(0);
  fs.unlinkSync(file);
});

test('startup import runs once per file and waits for an admin account', async () => {
  await Job.destroy({ where: {} });
  await importPending();
  const count = await Job.count();
  expect(count).toBeGreaterThan(0); // future offers of the real file (closed ones are skipped)
  expect(await SiteSetting.findByPk('import:2026-11-02-offres.json')).not.toBeNull();
  expect(await SiteSetting.findByPk('import:2026-11-03-offres.json')).not.toBeNull();
  await importPending();
  expect(await Job.count()).toBe(count);
});
