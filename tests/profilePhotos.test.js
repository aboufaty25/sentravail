// Profile photo and cover image.
const fs = require('fs');
const path = require('path');
const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const env = require('../src/config/env');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let cand; let candidate; let rec; let recruiter;

beforeAll(async () => {
  await resetDb();
  candidate = await createUser({ email: 'photo@ex.com' });
  recruiter = await createUser({ email: 'logo@ex.com', role: 'recruiter', companyName: 'Logo SA' });
  [cand, rec] = await Promise.all([loginAs(candidate), loginAs(recruiter)]);
});
afterAll(closeDb);

const send = (s, kind, file = PNG, extra = {}) => {
  let req = s.agent.post(`/parametres/${kind}?_csrf=${s.csrf}`);
  for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
  return file ? req.attach('image', file, { filename: 'p.png', contentType: 'image/png' }) : req.field('x', '');
};

test('a member sets a profile photo and a cover, shown on the profile; old files are removed', async () => {
  const res = await send(cand, 'photo', PNG, { retour: '/parametres/profil' });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/parametres/profil');
  await candidate.reload();
  expect(candidate.avatarUrl).toMatch(/^\/uploads\/avatars\//);
  const first = candidate.avatarUrl;
  await send(cand, 'photo');
  await candidate.reload();
  expect(candidate.avatarUrl).not.toBe(first);
  expect(fs.existsSync(path.join(env.uploadDir, first.replace('/uploads/', '')))).toBe(false);

  await send(cand, 'couverture');
  await candidate.reload();
  expect(candidate.coverUrl).toMatch(/^\/uploads\/covers\//);
  const page = (await request(app).get(`/profil/${candidate.username}`)).text;
  expect(page).toContain(`src="${candidate.avatarUrl}"`);
  expect(page).toContain(`src="${candidate.coverUrl}"`);
  expect(page).not.toContain('data-crop="cover"'); // controls only for the owner
  expect((await cand.agent.get(`/profil/${candidate.username}`)).text).toContain('data-crop="cover"');
});

test('removing the photo and the cover', async () => {
  await send(cand, 'photo', null, { action: 'remove' });
  await send(cand, 'couverture', null, { action: 'remove' });
  await candidate.reload();
  expect(candidate.avatarUrl).toBeNull();
  expect(candidate.coverUrl).toBeNull();
});

test("a recruiter's photo is the company logo used on new offers, and kept while offers use it", async () => {
  await send(rec, 'photo');
  await recruiter.reload();
  expect(recruiter.companyLogo).toBe(recruiter.avatarUrl);
  const logo = recruiter.avatarUrl;
  const { Post, Job } = require('../src/models');
  const post = await Post.create({ type: 'job', authorId: recruiter.id });
  await Job.create({ postId: post.id, slug: 'offre-logo-x1', title: 'Offre', companyName: 'Logo SA', companyLogo: logo, location: 'Dakar', contractType: 'CDI', sector: 'Comptabilité', description: 'x'.repeat(40), applyEmail: 'a@b.sn' });
  await send(rec, 'photo');
  await recruiter.reload();
  expect(recruiter.companyLogo).toBe(recruiter.avatarUrl);
  expect(fs.existsSync(path.join(env.uploadDir, logo.replace('/uploads/', '')))).toBe(true); // still used by the offer
});

test('guests, wrong files and CSRF are refused', async () => {
  const g = request.agent(app);
  const page = await g.get('/connexion');
  const csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const guest = await g.post(`/parametres/photo?_csrf=${csrf}`).attach('image', PNG, { filename: 'p.png', contentType: 'image/png' });
  expect(guest.status).toBe(302);
  expect(guest.headers.location).toMatch(/^\/connexion/);
  const bad = await cand.agent.post(`/parametres/photo?_csrf=${cand.csrf}`).attach('image', Buffer.from('%PDF-1.4'), { filename: 'x.png', contentType: 'image/png' });
  expect(bad.status).toBe(422);
  expect((await cand.agent.post('/parametres/photo').attach('image', PNG, { filename: 'p.png', contentType: 'image/png' })).status).toBe(403);
});
