const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job, Report, Comment, RefItem, User } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');
const refs = require('../src/services/refs');
const { CITIES } = require('../src/config/constants');
const env = require('../src/config/env');

let admin; let rec; let cand; let other; let adminS; let recS; let candS; let otherS;
const form = (s, url, body = {}) => s.agent.post(url).type('form').send({ _csrf: s.csrf, ...body });
const report = (s, body) => s.agent.post('/signalements').set('X-CSRF-Token', s.csrf).set('Accept', 'application/json').send(body);

async function makeJob(author, extra = {}, postExtra = {}) {
  const post = await Post.create({ authorId: author.id, type: 'job', ...postExtra });
  await Job.create({ postId: post.id, slug: buildSlug(extra.title || 'Offre', 'Dakar'), title: 'Offre', companyName: 'X', location: 'Dakar', contractType: 'CDI', sector: 'Santé', description: 'x'.repeat(40), applyEmail: 'a@b.sn', ...extra });
  return post;
}

beforeAll(async () => {
  await resetDb();
  await refs.seedDefaults();
  await refs.load();
  admin = await createUser({ username: 'admin', email: 'admin@ex.com', role: 'admin' });
  rec = await createUser({ username: 'rec', email: 'rec@ex.com', role: 'recruiter', firstName: 'Rama' });
  cand = await createUser({ username: 'cand', email: 'cand@ex.com', firstName: 'Awa' });
  other = await createUser({ username: 'other', email: 'other@ex.com', firstName: 'Omar' });
  [adminS, recS, candS, otherS] = await Promise.all([admin, rec, cand, other].map((u) => loginAs(u)));
});
afterAll(closeDb);

describe('Access control', () => {
  test.each(['/admin', '/admin/offres', '/admin/signalements', '/admin/utilisateurs', '/admin/referentiels'])('%s is admin-only', async (url) => {
    expect((await candS.agent.get(url)).status).toBe(403);
    expect((await recS.agent.get(url)).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(302);
    expect((await adminS.agent.get(url)).status).toBe(200);
  });

  test('admin POST actions are refused to non-admins', async () => {
    const p = await makeJob(rec, {}, { featureStatus: 'pending' });
    expect((await form(recS, `/admin/offres/${p.id}/approuver`, { days: 30 })).status).toBe(403);
    expect((await form(candS, `/admin/utilisateurs/${other.id}`, { action: 'ban' })).status).toBe(403);
    expect((await form(recS, '/admin/referentiels', { kind: 'city', name: 'Pirate' })).status).toBe(403);
    await p.reload();
    expect(p.isFeatured).toBe(false);
  });
});

describe('Featured offers', () => {
  test('approve for N days: pinned for everyone; extending adds days', async () => {
    const p = await makeJob(rec, { title: 'Infirmier' }, { featureStatus: 'pending' });
    expect((await adminS.agent.get('/admin/offres')).text).toContain('Infirmier');
    await form(adminS, `/admin/offres/${p.id}/approuver`, { days: 10 });
    await p.reload();
    expect(p.isFeatured).toBe(true);
    expect(p.featureStatus).toBe('approved');
    const left = (new Date(p.featuredUntil) - Date.now()) / 86_400_000;
    expect(left).toBeGreaterThan(9.9);
    expect(left).toBeLessThan(10.1);
    expect((await otherS.agent.get('/')).text).toContain('Infirmier'); // non-follower sees it pinned

    await form(adminS, `/admin/offres/${p.id}/approuver`, { days: 7 });
    await p.reload();
    expect((new Date(p.featuredUntil) - Date.now()) / 86_400_000).toBeGreaterThan(16.9);

    await form(adminS, `/admin/offres/${p.id}/retirer`);
    await p.reload();
    expect(p.isFeatured).toBe(false);
  });

  test('invalid duration falls back to FEATURED_DAYS', async () => {
    const p = await makeJob(rec, {}, { featureStatus: 'pending' });
    await form(adminS, `/admin/offres/${p.id}/approuver`, { days: 'abc' });
    await p.reload();
    expect((new Date(p.featuredUntil) - Date.now()) / 86_400_000).toBeCloseTo(env.FEATURED_DAYS, 0);
  });

  test('reject requires a reason, shown to the recruiter', async () => {
    const p = await makeJob(rec, { title: 'Caissier' }, { featureStatus: 'pending' });
    await form(adminS, `/admin/offres/${p.id}/refuser`, { reason: '' });
    await p.reload();
    expect(p.featureStatus).toBe('pending');
    await form(adminS, `/admin/offres/${p.id}/refuser`, { reason: 'Offre incomplète' });
    await p.reload();
    expect(p.featureStatus).toBe('rejected');
    expect(p.featureRejectReason).toBe('Offre incomplète');
    const slug = (await Job.findOne({ where: { postId: p.id } })).slug;
    expect((await recS.agent.get(`/offres/${slug}`)).text).toContain('Offre incomplète');
  });
});

describe('Reports', () => {
  test('validation, own content, duplicates', async () => {
    const p = await Post.create({ authorId: rec.id, text: 'contenu' });
    expect((await report(candS, { targetType: 'post', targetId: p.id, reason: 'nope' })).status).toBe(422);
    expect((await report(recS, { targetType: 'post', targetId: p.id, reason: 'spam' })).status).toBe(422); // own
    expect((await report(candS, { targetType: 'post', targetId: 999999, reason: 'spam' })).status).toBe(404);
    expect((await report(candS, { targetType: 'post', targetId: p.id, reason: 'spam' })).status).toBe(201);
    expect((await report(candS, { targetType: 'post', targetId: p.id, reason: 'scam' })).status).toBe(200); // already reported
    expect(await Report.count({ where: { targetId: p.id } })).toBe(1);
  });

  test('cannot report what you cannot see (network posts of non-followed authors)', async () => {
    const p = await Post.create({ authorId: rec.id, text: 'réseau', visibility: 'network' });
    expect((await report(candS, { targetType: 'post', targetId: p.id, reason: 'spam' })).status).toBe(404);
  });

  test(`a post is hidden automatically after ${env.REPORT_AUTOHIDE} reports, then restored when dismissed`, async () => {
    const p = await Post.create({ authorId: rec.id, text: 'Arnaque probable' });
    const reporters = [];
    for (let i = 0; i < env.REPORT_AUTOHIDE; i += 1) reporters.push(await loginAs(await createUser({ email: `r${i}@ex.com` })));
    for (const s of reporters) await report(s, { targetType: 'post', targetId: p.id, reason: 'scam' });
    await p.reload();
    expect(p.status).toBe('pending_approval');
    expect((await otherS.agent.get(`/publications/${p.id}`)).status).toBe(404);
    expect((await recS.agent.get(`/publications/${p.id}`)).status).toBe(200); // author still sees it

    const page = await adminS.agent.get('/admin/signalements');
    expect(page.text).toContain('Masquée automatiquement');
    await form(adminS, `/admin/signalements/post/${p.id}`, { action: 'dismiss' });
    await p.reload();
    expect(p.status).toBe('published');
    expect(await Report.count({ where: { targetId: p.id, status: 'open' } })).toBe(0);
    expect(await Report.count({ where: { targetId: p.id, status: 'dismissed' } })).toBe(env.REPORT_AUTOHIDE);
  });

  test('remove a reported post or comment', async () => {
    const p = await Post.create({ authorId: rec.id, text: 'à supprimer', commentsCount: 1 });
    await report(candS, { targetType: 'post', targetId: p.id, reason: 'inappropriate' });
    await form(adminS, `/admin/signalements/post/${p.id}`, { action: 'remove' });
    expect(await Post.findByPk(p.id)).toBeNull();
    expect((await Report.findOne({ where: { targetId: p.id } })).resolution).toBe('removed');

    const host = await Post.create({ authorId: cand.id, text: 'hôte', commentsCount: 1 });
    const c = await Comment.create({ postId: host.id, authorId: rec.id, text: 'insulte' });
    expect((await report(otherS, { targetType: 'comment', targetId: c.id, reason: 'harassment' })).status).toBe(201);
    await form(adminS, `/admin/signalements/comment/${c.id}`, { action: 'remove' });
    expect(await Comment.findByPk(c.id)).toBeNull();
    await host.reload();
    expect(host.commentsCount).toBe(0);
  });

  test('ban the author from a report; admins cannot be banned', async () => {
    const spammer = await createUser({ email: 'spam@ex.com' });
    const p = await Post.create({ authorId: spammer.id, text: 'spam' });
    await report(candS, { targetType: 'post', targetId: p.id, reason: 'spam' });
    await form(adminS, `/admin/signalements/post/${p.id}`, { action: 'ban' });
    await spammer.reload();
    expect(spammer.isBanned).toBe(true);

    expect((await report(candS, { targetType: 'user', targetId: admin.id, reason: 'other' })).status).toBe(201);
    expect((await form(adminS, `/admin/signalements/user/${admin.id}`, { action: 'remove' })).status).toBe(422);
  });
});

describe('Users management', () => {
  test('ban, unban, verify, change role; cannot act on yourself', async () => {
    const u = await createUser({ email: 'u@ex.com', firstName: 'Ibou' });
    const s = await loginAs(u);
    await form(adminS, `/admin/utilisateurs/${u.id}`, { action: 'ban' });
    await u.reload();
    expect(u.isBanned).toBe(true);
    expect((await s.agent.get('/menu')).status).toBe(302); // session no longer valid

    await form(adminS, `/admin/utilisateurs/${u.id}`, { action: 'unban' });
    await form(adminS, `/admin/utilisateurs/${u.id}`, { action: 'verify' });
    await form(adminS, `/admin/utilisateurs/${u.id}`, { action: 'role', role: 'recruiter' });
    await u.reload();
    expect([u.isBanned, u.isVerified, u.role]).toEqual([false, true, 'recruiter']);
    expect((await form(adminS, `/admin/utilisateurs/${u.id}`, { action: 'role', role: 'god' })).status).toBe(422);

    expect((await form(adminS, `/admin/utilisateurs/${admin.id}`, { action: 'ban' })).status).toBe(422);
    expect((await form(adminS, `/admin/utilisateurs/${admin.id}`, { action: 'role', role: 'candidate' })).status).toBe(422);
  });

  test('search by name, email or company', async () => {
    expect((await adminS.agent.get('/admin/utilisateurs?q=rec%40ex')).text).toContain('Rama');
    const res = await adminS.agent.get('/admin/utilisateurs?role=recruiter');
    expect(res.text).toContain('Rama');
    expect(res.text).not.toContain('Awa');
  });
});

describe('Cities and sectors', () => {
  test('add a city: available in job validation; deactivate: refused for new offers', async () => {
    await form(adminS, '/admin/referentiels', { kind: 'city', name: 'Mbacké' });
    expect(CITIES).toContain('Mbacké');
    const create = (city) => {
      let req = recS.agent.post(`/offres/nouvelle?_csrf=${recS.csrf}`);
      const data = { title: 'Chauffeur', companyName: 'Transports Ba', location: city, contractType: 'CDI', sector: 'Logistique & Transport', description: 'Conduite de véhicules de livraison dans la région.', applyEmail: 'a@b.sn' };
      for (const [k, v] of Object.entries(data)) req = req.field(k, v);
      return req;
    };
    expect((await create('Mbacké')).status).toBe(302);

    const item = await RefItem.findOne({ where: { kind: 'city', name: 'Mbacké' } });
    await form(adminS, `/admin/referentiels/${item.id}`, { action: 'toggle' });
    expect(CITIES).not.toContain('Mbacké');
    expect((await create('Mbacké')).status).toBe(422);
    expect(await Job.count({ where: { location: 'Mbacké' } })).toBe(1); // existing offer kept
  });

  test('rename updates existing offers and profiles', async () => {
    await User.update({ city: 'Diamniadio' }, { where: { id: cand.id } });
    await makeJob(rec, { title: 'Agent', location: 'Diamniadio' });
    const item = await RefItem.findOne({ where: { kind: 'city', name: 'Diamniadio' } });
    await form(adminS, `/admin/referentiels/${item.id}`, { action: 'rename', name: 'Diamniadio (pôle urbain)' });
    expect(CITIES).toContain('Diamniadio (pôle urbain)');
    expect(await Job.count({ where: { location: 'Diamniadio (pôle urbain)' } })).toBe(1);
    await cand.reload();
    expect(cand.city).toBe('Diamniadio (pôle urbain)');
    // duplicate names refused
    const other = await RefItem.findOne({ where: { kind: 'city', name: 'Thiès' } });
    await form(adminS, `/admin/referentiels/${other.id}`, { action: 'rename', name: 'Dakar' });
    await other.reload();
    expect(other.name).toBe('Thiès');
  });
});

describe('Dashboard', () => {
  test('shows key numbers', async () => {
    const res = await adminS.agent.get('/admin');
    expect(res.text).toContain('Signalements à traiter');
    expect(res.text).toContain('Inscriptions — 14 derniers jours');
    expect(res.text).not.toContain('adsbygoogle');
  });
});
