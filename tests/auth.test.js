const { app, request, resetDb, closeDb, agentWithCsrf, createUser, User } = require('./helpers');
const { outbox } = require('../src/services/mail');

const validCandidate = {
  firstName: 'Aïssatou',
  lastName: 'Fall',
  email: 'Aissatou@Example.com',
  phone: '77 123 45 67',
  password: 'motdepasse1',
  passwordConfirm: 'motdepasse1',
  role: 'candidate',
  acceptTerms: 'on',
};

beforeAll(resetDb);
afterAll(closeDb);

describe('Registration', () => {
  test('creates a candidate with hashed password, normalized email/phone and slug username', async () => {
    const { agent, csrf } = await agentWithCsrf('/inscription');
    const res = await agent.post('/inscription').type('form').send({ ...validCandidate, _csrf: csrf });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');

    const user = await User.findOne({ where: { email: 'aissatou@example.com' } });
    expect(user).not.toBeNull();
    expect(user.role).toBe('candidate');
    expect(user.phone).toBe('+221771234567');
    expect(user.username).toBe('aissatou-fall');
    expect(user.passwordHash).not.toBe('motdepasse1');

    const home = await agent.get('/');
    expect(home.text).toContain('Quoi de neuf dans votre recherche d');
  });

  test('rejects duplicate email and phone', async () => {
    const { agent, csrf } = await agentWithCsrf('/inscription');
    const res = await agent.post('/inscription').type('form').send({ ...validCandidate, _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Un compte existe déjà avec cet email.');
    expect(res.text).toContain('Un compte existe déjà avec ce numéro.');
  });

  test('validates fields', async () => {
    const { agent, csrf } = await agentWithCsrf('/inscription');
    const res = await agent.post('/inscription').type('form').send({
      _csrf: csrf, firstName: 'A', lastName: '', email: 'pas-un-email', password: 'court', passwordConfirm: 'autre', role: 'candidate',
    });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Adresse email invalide.');
    expect(res.text).toContain('au moins 8 caractères');
    expect(res.text).toContain("Vous devez accepter les conditions d&#39;utilisation.");
  });

  test('recruiter must provide a company name', async () => {
    const { agent, csrf } = await agentWithCsrf('/inscription');
    const res = await agent.post('/inscription').type('form').send({
      ...validCandidate, email: 'rh@ex.com', phone: '', role: 'recruiter', companyName: '', _csrf: csrf,
    });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Indiquez le nom de votre entreprise.');
  });

  test('registers a recruiter with company', async () => {
    const { agent, csrf } = await agentWithCsrf('/inscription');
    const res = await agent.post('/inscription').type('form').send({
      ...validCandidate, firstName: 'Mariama', lastName: 'Diop', email: 'rh@ex.com', phone: '', role: 'recruiter', companyName: 'Teranga SA', _csrf: csrf,
    });
    expect(res.status).toBe(302);
    const user = await User.findOne({ where: { email: 'rh@ex.com' } });
    expect(user.role).toBe('recruiter');
    expect(user.companyName).toBe('Teranga SA');
  });

  test('a recruiter signs up with the company name only (no first or last name)', async () => {
    const { agent, csrf } = await agentWithCsrf('/inscription');
    const res = await agent.post('/inscription').type('form').send({
      ...validCandidate, firstName: '', lastName: '', email: 'contact@sahel-logistique.sn', phone: '', role: 'recruiter', companyName: 'Sahel Logistique', _csrf: csrf,
    });
    expect(res.status).toBe(302);
    const user = await User.findOne({ where: { email: 'contact@sahel-logistique.sn' } });
    expect(user.role).toBe('recruiter');
    expect(user.firstName).toBe('Sahel Logistique');
    expect(user.lastName).toBe('');
    expect(user.fullName).toBe('Sahel Logistique');
    expect(user.initials).toBe('SL');
    expect(user.username).toMatch(/^sahel-logistique/);
    // A candidate still needs first and last name.
    const again = await agentWithCsrf('/inscription');
    const bad = await again.agent.post('/inscription').type('form').send({ ...validCandidate, firstName: '', lastName: '', email: 'x@ex.com', phone: '', _csrf: again.csrf });
    expect(bad.status).toBe(422);
    expect(bad.text).toContain('Prénom : 2 caractères minimum.');
  });

  test('cannot self-register as admin', async () => {
    const { agent, csrf } = await agentWithCsrf('/inscription');
    const res = await agent.post('/inscription').type('form').send({
      ...validCandidate, email: 'pirate@ex.com', phone: '', role: 'admin', _csrf: csrf,
    });
    expect(res.status).toBe(422);
    expect(await User.findOne({ where: { email: 'pirate@ex.com' } })).toBeNull();
  });
});

describe('Login / logout', () => {
  let user;
  beforeAll(async () => {
    user = await createUser({ email: 'login@ex.com', phone: '+221781112233', password: 'secret-pass' });
  });

  test('logs in with email', async () => {
    const { agent, csrf } = await agentWithCsrf();
    const res = await agent.post('/connexion').type('form').send({ _csrf: csrf, identifier: 'LOGIN@ex.com', password: 'secret-pass' });
    expect(res.status).toBe(302);
    expect((await agent.get('/menu')).status).toBe(200);
  });

  test('logs in with a local phone number', async () => {
    const { agent, csrf } = await agentWithCsrf();
    const res = await agent.post('/connexion').type('form').send({ _csrf: csrf, identifier: '78 111 22 33', password: 'secret-pass' });
    expect(res.status).toBe(302);
  });

  test('rejects a wrong password with a generic message', async () => {
    const { agent, csrf } = await agentWithCsrf();
    const res = await agent.post('/connexion').type('form').send({ _csrf: csrf, identifier: 'login@ex.com', password: 'nope-nope' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('Identifiants incorrects.');
  });

  test('rejects an unknown account with the same message', async () => {
    const { agent, csrf } = await agentWithCsrf();
    const res = await agent.post('/connexion').type('form').send({ _csrf: csrf, identifier: 'ghost@ex.com', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('Identifiants incorrects.');
  });

  test('refuses banned users', async () => {
    await createUser({ email: 'banned@ex.com', isBanned: true });
    const { agent, csrf } = await agentWithCsrf();
    const res = await agent.post('/connexion').type('form').send({ _csrf: csrf, identifier: 'banned@ex.com', password: 'password123' });
    expect(res.status).toBe(403);
    expect(res.text).toContain('suspendu');
  });

  test('renews the session id on login (no session fixation)', async () => {
    const { agent, csrf } = await agentWithCsrf();
    const before = (await agent.get('/connexion')).headers['set-cookie'];
    const res = await agent.post('/connexion').type('form').send({ _csrf: csrf, identifier: 'login@ex.com', password: 'secret-pass' });
    expect(res.headers['set-cookie'][0]).toMatch(/^st\.sid=/);
    expect(res.headers['set-cookie'][0]).not.toEqual(before && before[0]);
  });

  test('redirects back to the requested page after login (?retour=)', async () => {
    const agent = request.agent(app);
    const r1 = await agent.get('/parametres/profil');
    expect(r1.status).toBe(302);
    expect(r1.headers.location).toBe('/connexion?retour=%2Fparametres%2Fprofil');
    const page = await agent.get(r1.headers.location);
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const retour = page.text.match(/name="retour" value="([^"]+)"/)[1];
    expect(retour).toBe('/parametres/profil');
    const res = await agent.post('/connexion').type('form').send({ _csrf: csrf, retour, identifier: 'login@ex.com', password: 'secret-pass' });
    expect(res.headers.location).toBe('/parametres/profil');
  });

  test('the return target is restricted to this site', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/connexion?retour=%2F%2Fevil.com');
    expect(page.text).not.toContain('name="retour"');
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const res = await agent.post('/connexion').type('form').send({ _csrf: csrf, retour: 'https://evil.com', identifier: 'login@ex.com', password: 'secret-pass' });
    expect(res.headers.location).toBe('/');
  });

  test('registration also brings the visitor back', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/inscription?retour=%2Foffres%2Fabc%3Fpostuler%3D1&email=new%40ex.com');
    expect(page.text).toContain('value="new@ex.com"');
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const res = await agent.post('/inscription').type('form').send({
      _csrf: csrf, retour: '/offres/abc?postuler=1', firstName: 'Back', lastName: 'Again', email: 'back@ex.com', password: 'motdepasse1', passwordConfirm: 'motdepasse1', role: 'candidate', acceptTerms: 'on',
    });
    expect(res.headers.location).toBe('/offres/abc?postuler=1');
  });

  test('logout destroys the session', async () => {
    const { agent, csrf } = await agentWithCsrf();
    await agent.post('/connexion').type('form').send({ _csrf: csrf, identifier: 'login@ex.com', password: 'secret-pass' });
    const menu = await agent.get('/menu');
    const token = menu.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    await agent.post('/deconnexion').type('form').send({ _csrf: token });
    expect((await agent.get('/parametres/profil')).status).toBe(302);
  });
});

describe('CSRF', () => {
  test('rejects POST without token', async () => {
    const res = await request(app).post('/connexion').type('form').send({ identifier: 'a@b.c', password: 'x' });
    expect(res.status).toBe(403);
  });

  test('rejects POST with a wrong token', async () => {
    const { agent } = await agentWithCsrf();
    const res = await agent.post('/connexion').type('form').send({ _csrf: 'a'.repeat(48), identifier: 'a@b.c', password: 'x' });
    expect(res.status).toBe(403);
  });

  test('accepts the token as an X-CSRF-Token header (htmx)', async () => {
    const { agent, csrf } = await agentWithCsrf();
    const res = await agent.post('/connexion').set('X-CSRF-Token', csrf).type('form').send({ identifier: 'ghost@ex.com', password: 'whatever1' });
    expect(res.status).toBe(401);
  });
});

describe('Password reset', () => {
  let user;
  beforeAll(async () => {
    user = await createUser({ email: 'reset@ex.com', password: 'old-password' });
  });

  test('does not reveal unknown emails', async () => {
    const { agent, csrf } = await agentWithCsrf('/mot-de-passe-oublie');
    const count = outbox.length;
    const res = await agent.post('/mot-de-passe-oublie').type('form').send({ _csrf: csrf, email: 'unknown@ex.com' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Si un compte existe');
    expect(outbox.length).toBe(count);
  });

  test('full reset flow with single-use token', async () => {
    const { agent, csrf } = await agentWithCsrf('/mot-de-passe-oublie');
    await agent.post('/mot-de-passe-oublie').type('form').send({ _csrf: csrf, email: 'reset@ex.com' });
    const mail = outbox[outbox.length - 1];
    expect(mail.to).toBe('reset@ex.com');
    const token = mail.text.match(/reinitialiser\/([a-f0-9]{64})/)[1];

    await user.reload();
    expect(user.resetTokenHash).not.toBe(token); // stored hashed

    const form = await agent.get(`/reinitialiser/${token}`);
    expect(form.status).toBe(200);
    const res = await agent.post(`/reinitialiser/${token}`).type('form').send({ _csrf: csrf, password: 'new-password', passwordConfirm: 'new-password' });
    expect(res.status).toBe(302);

    const login = await agent.post('/connexion').type('form').send({ _csrf: csrf, identifier: 'reset@ex.com', password: 'new-password' });
    expect(login.status).toBe(302);

    const reuse = await request(app).get(`/reinitialiser/${token}`);
    expect(reuse.status).toBe(400);
  });

  test('expired token is refused', async () => {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    await user.update({
      resetTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      resetTokenExpires: new Date(Date.now() - 1000),
    });
    const res = await request(app).get(`/reinitialiser/${token}`);
    expect(res.status).toBe(400);
  });
});
