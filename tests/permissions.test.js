const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');

let candidate;
let recruiter;
let admin;

beforeAll(async () => {
  await resetDb();
  candidate = await createUser({ username: 'cand', email: 'cand@ex.com', role: 'candidate' });
  recruiter = await createUser({ username: 'recr', email: 'recr@ex.com', role: 'recruiter', companyName: 'Recr SA' });
  admin = await createUser({ username: 'boss', email: 'boss@ex.com', role: 'admin' });
});
afterAll(closeDb);

describe('Route protection', () => {
  test.each(['/menu', '/parametres/profil', '/reels/nouveau', '/reseau', '/notifications', '/mes-offres', '/admin'])(
    'guest is redirected to login from %s',
    async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/connexion');
    }
  );

  test('htmx requests get HX-Redirect instead of a 302', async () => {
    const res = await request(app).get('/menu').set('HX-Request', 'true');
    expect(res.status).toBe(401);
    expect(res.headers['hx-redirect']).toBe('/connexion');
  });

  test('logged-in user cannot see login/register pages', async () => {
    const { agent } = await loginAs(candidate);
    expect((await agent.get('/connexion')).status).toBe(302);
    expect((await agent.get('/inscription')).status).toBe(302);
  });
});

describe('Roles', () => {
  test('candidate: no recruiter or admin areas, no job shortcut', async () => {
    const { agent } = await loginAs(candidate);
    expect((await agent.get('/mes-offres')).status).toBe(403);
    expect((await agent.get('/admin')).status).toBe(403);
    const home = await agent.get('/');
    expect(home.text).not.toContain('/publier?type=job');
    expect(home.text).not.toContain('href="/admin"');
  });

  test('recruiter: own jobs area and job shortcut, no admin', async () => {
    const { agent } = await loginAs(recruiter);
    expect((await agent.get('/mes-offres')).status).toBe(200);
    expect((await agent.get('/admin')).status).toBe(403);
    expect((await agent.get('/')).text).toContain('/publier?type=job');
  });

  test('admin: everything', async () => {
    const { agent } = await loginAs(admin);
    expect((await agent.get('/mes-offres')).status).toBe(200);
    expect((await agent.get('/admin')).status).toBe(200);
    expect((await agent.get('/menu')).text).toContain('href="/admin"');
  });

  test('a banned user loses access on the next request', async () => {
    const victim = await createUser({ email: 'soon-banned@ex.com' });
    const { agent } = await loginAs(victim);
    expect((await agent.get('/menu')).status).toBe(200);
    await victim.update({ isBanned: true });
    expect((await agent.get('/menu')).status).toBe(302);
  });
});

describe('Profile', () => {
  test('public profile is visible to guests and hides private data', async () => {
    await candidate.update({ phone: '+221770009999', headline: 'Comptable', bio: 'Bonjour' });
    const res = await request(app).get('/profil/cand');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Comptable');
    expect(res.text).not.toContain('cand@ex.com');
    expect(res.text).not.toContain('770009999');
  });

  test('unknown or banned profile returns 404', async () => {
    expect((await request(app).get('/profil/nobody')).status).toBe(404);
    await createUser({ username: 'gone', email: 'gone@ex.com', isBanned: true });
    expect((await request(app).get('/profil/gone')).status).toBe(404);
  });

  test('owner sees edit button, others do not', async () => {
    const own = await loginAs(candidate);
    expect((await own.agent.get('/profil/cand')).text).toContain('href="/parametres/profil"');
    const other = await loginAs(recruiter);
    const res = await other.agent.get('/profil/cand');
    expect(res.text).not.toMatch(/class="btn-primary[^"]*"[^>]*>[\s\S]{0,80}Modifier/);
  });

  test('profile update only touches whitelisted fields of the current user', async () => {
    const { agent, csrf } = await loginAs(candidate);
    const res = await agent.post('/parametres/profil').type('form').send({
      _csrf: csrf, firstName: 'Awa', lastName: 'Ndiaye', headline: 'Comptable senior', city: 'Thiès',
      skills: 'Excel, Sage, Excel', role: 'admin', isVerified: '1', id: String(recruiter.id),
    });
    expect(res.status).toBe(302);
    await candidate.reload();
    await recruiter.reload();
    expect(candidate.firstName).toBe('Awa');
    expect(candidate.headline).toBe('Comptable senior');
    expect(candidate.skills).toEqual(['Excel', 'Sage']);
    expect(candidate.role).toBe('candidate');
    expect(candidate.isVerified).toBe(false);
    expect(recruiter.firstName).toBe('Test');
  });

  test('profile update validates input', async () => {
    const { agent, csrf } = await loginAs(candidate);
    const res = await agent.post('/parametres/profil').type('form').send({ _csrf: csrf, firstName: '', lastName: 'X', phone: '12' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Numéro de téléphone invalide.');
  });

  test('escapes user content (no stored XSS)', async () => {
    await candidate.update({ headline: '<script>alert(1)</script>' });
    const res = await request(app).get('/profil/cand');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});
