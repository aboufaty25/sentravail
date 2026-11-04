// Administrators appear as « Équipe SenTravail », and every member follows the team.
const { app, request, resetDb, closeDb, agentWithCsrf, createUser, loginAs, User } = require('./helpers');
const { Post, Follow } = require('../src/models');
const { followTeam } = require('../src/services/follows');

let admin; let adm;
beforeAll(async () => {
  await resetDb();
  admin = await createUser({ email: 'adm@ex.com', role: 'admin', firstName: 'Moussa', lastName: 'Diop', username: 'moussa-diop' });
  adm = await loginAs(admin);
});
afterAll(closeDb);

test('admin posts and profile show the team name, never the real name', async () => {
  await Post.create({ authorId: admin.id, type: 'advice', title: 'Préparer un entretien', text: 'Renseignez-vous sur l’entreprise avant l’entretien.', visibility: 'public', status: 'published' });
  for (const path of ['/', '/profil/moussa-diop']) {
    const res = await request(app).get(path);
    expect(res.text).toContain('Équipe SenTravail');
    expect(res.text).not.toContain('Moussa');
  }
  // Stored names are kept (reversible), only the displayed name changes.
  const [[row]] = await User.sequelize.query('SELECT firstName FROM users WHERE id = ?', { replacements: [admin.id] });
  expect(row.firstName).toBe('Moussa');
});

test('admin profile edit keeps the team name', async () => {
  const res = await adm.agent.post('/parametres/profil').type('form').send({ _csrf: adm.csrf, firstName: 'X', lastName: 'Y', headline: 'Le réseau de l’emploi' });
  expect(res.status).toBe(302);
  const [[row]] = await User.sequelize.query('SELECT firstName, headline FROM users WHERE id = ?', { replacements: [admin.id] });
  expect(row).toEqual({ firstName: 'Moussa', headline: 'Le réseau de l’emploi' });
});

test('a new member follows the team at sign-up and may unfollow', async () => {
  const { agent, csrf } = await agentWithCsrf('/inscription');
  const res = await agent.post('/inscription').type('form').send({
    firstName: 'Aïssatou', lastName: 'Fall', email: 'aissatou@example.com', phone: '77 123 45 67',
    password: 'motdepasse1', passwordConfirm: 'motdepasse1', role: 'candidate', acceptTerms: 'on', _csrf: csrf,
  });
  expect(res.status).toBe(302);
  const user = await User.findOne({ where: { email: 'aissatou@example.com' } });
  expect(await Follow.count({ where: { followerId: user.id, followingId: admin.id } })).toBe(1);
  expect((await User.findByPk(admin.id)).followersCount).toBe(1);
  expect(user.followingCount).toBe(1);

  const page = await agent.get('/parametres/profil');
  const token = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1]; // new session after sign-up
  const off = await agent.post(`/abonnements/${admin.id}`).set('HX-Request', 'true').type('form').send({ _csrf: token });
  expect(off.status).toBeLessThan(400);
  expect(await Follow.count({ where: { followerId: user.id, followingId: admin.id } })).toBe(0);
});

test('backfill: existing members follow the team once; admins and banned accounts do not', async () => {
  const [a, b, banned, other] = await Promise.all([
    createUser({ email: 'a@ex.com' }), createUser({ email: 'b@ex.com', role: 'recruiter', firstName: 'Ba SA', lastName: '' }),
    createUser({ email: 'ban@ex.com', isBanned: true }), createUser({ email: 'adm2@ex.com', role: 'admin' }),
  ]);
  await followTeam();
  expect(await Follow.count({ where: { followerId: [a.id, b.id], followingId: [admin.id, other.id] } })).toBe(4);
  expect(await Follow.count({ where: { followerId: [banned.id, other.id, admin.id] } })).toBe(0);
  expect(await followTeam()).toBe(0); // idempotent
  const fresh = await User.findByPk(admin.id);
  expect(fresh.followersCount).toBe(await Follow.count({ where: { followingId: admin.id } }));
  expect((await User.findByPk(a.id)).followingCount).toBe(2);
});

test('the team follower count is never shown to members or visitors (admins still see it)', async () => {
  const cand = await loginAs(await createUser({ email: 'viewer@ex.com' }));
  for (const agent of [request(app), cand.agent]) {
    const profile = await agent.get('/profil/moussa-diop');
    expect(profile.status).toBe(200);
    expect(profile.text).not.toMatch(/followers-count-|<\/span> abonnés/);
    expect(profile.text).not.toContain('/profil/moussa-diop/abonnes"');
    const list = await agent.get('/profil/moussa-diop/abonnes');
    expect(list.status).toBe(302);
  }
  const off = await cand.agent.post(`/abonnements/${admin.id}`).set('HX-Request', 'true').type('form').send({ _csrf: cand.csrf });
  expect(off.headers['hx-trigger'] || '').not.toContain('followersCount');
  expect((await adm.agent.get('/profil/moussa-diop')).text).toContain(`followers-count-${admin.id}`);
  expect((await adm.agent.get('/profil/moussa-diop/abonnes')).status).toBe(200);
});
