const { execFile } = require('child_process');
const path = require('path');
const { app, request, resetDb, closeDb, createUser, loginAs, User } = require('./helpers');

let admin; let adminS;
beforeAll(async () => {
  await resetDb();
  admin = await createUser({ email: 'admin@ex.com', role: 'admin' });
  adminS = await loginAs(admin);
});
afterAll(closeDb);

describe('Sessions and CSRF', () => {
  test('anonymous browsing creates no session (no st.sid cookie), only a CSRF cookie', async () => {
    const res = await request(app).get('/offres');
    const cookies = (res.headers['set-cookie'] || []).map((c) => c.split('=')[0]);
    expect(cookies).not.toContain('st.sid');
    expect(cookies).toContain('st_csrf');
    expect(res.headers['set-cookie'].find((c) => c.startsWith('st_csrf'))).toMatch(/HttpOnly/i);
  });

  test('guest forms work with the cookie token; a forged token is refused', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/mot-de-passe-oublie');
    const token = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    expect((await agent.post('/mot-de-passe-oublie').type('form').send({ _csrf: token, email: 'x@ex.com' })).status).toBe(200);
    expect((await agent.post('/mot-de-passe-oublie').type('form').send({ _csrf: 'f'.repeat(48), email: 'x@ex.com' })).status).toBe(403);
    // a token without its cookie (other browser) is refused
    expect((await request(app).post('/mot-de-passe-oublie').type('form').send({ _csrf: token, email: 'x@ex.com' })).status).toBe(403);
  });

  test('after login the session token replaces the guest token', async () => {
    const user = await createUser({ email: 'switch@ex.com' });
    const agent = request.agent(app);
    const page = await agent.get('/connexion');
    const guestToken = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    await agent.post('/connexion').type('form').send({ _csrf: guestToken, identifier: user.email, password: 'password123' });
    const menu = await agent.get('/menu');
    const sessionToken = menu.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    expect(sessionToken).not.toBe(guestToken);
    expect((await agent.post('/deconnexion').type('form').send({ _csrf: guestToken })).status).toBe(403);
    expect((await agent.post('/deconnexion').type('form').send({ _csrf: sessionToken })).status).toBe(302);
  });

  test('login with a malformed phone number fails cleanly', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/connexion');
    const token = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const res = await agent.post('/connexion').type('form').send({ _csrf: token, identifier: '123', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('Identifiants incorrects.');
  });
});

describe('HTTP headers', () => {
  test('security headers are set and the framework is not advertised', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(res.headers['content-security-policy']).toContain("script-src-attr 'none'");
  });

  test('dynamic pages are private (never stored by a CDN)', async () => {
    expect((await request(app).get('/offres')).headers['cache-control']).toBe('private, no-cache');
    expect((await adminS.agent.get('/admin')).headers['cache-control']).toBe('private, no-cache');
  });

  test('static assets are cacheable', async () => {
    expect((await request(app).get('/css/app.css')).headers['cache-control']).toMatch(/public/);
  });
});

describe('Redirects', () => {
  test('admin actions never redirect to another site, even a look-alike domain', async () => {
    const target = await createUser({ email: 'target@ex.com' });
    const res = await adminS.agent.post(`/admin/utilisateurs/${target.id}`)
      .set('Referer', 'http://localhost:3000.evil.com/admin/utilisateurs')
      .type('form').send({ _csrf: adminS.csrf, action: 'verify' });
    expect(res.headers.location).toBe('/admin/utilisateurs');
    const ok = await adminS.agent.post(`/admin/utilisateurs/${target.id}`)
      .set('Referer', 'http://localhost:3000/admin/utilisateurs?q=target')
      .type('form').send({ _csrf: adminS.csrf, action: 'unverify' });
    expect(ok.headers.location).toBe('/admin/utilisateurs?q=target');
  });
});

describe('Operations', () => {
  test('health check reports the database status', async () => {
    const res = await request(app).get('/sante');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('make-admin promotes an existing account', async () => {
    const u = await createUser({ email: 'boss@ex.com' });
    const run = (args) => new Promise((resolve) => {
      execFile('node', [path.join(__dirname, '../scripts/makeAdmin.js'), ...args], { env: { ...process.env, NODE_ENV: 'test' } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
    });
    const ok = await run(['BOSS@ex.com']);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('is now an administrator');
    await u.reload();
    expect(u.role).toBe('admin');
    const missing = await run(['nobody@ex.com']);
    expect(missing.code).not.toBe(0);
  });

  test('seed refuses to run in production', async () => {
    const res = await new Promise((resolve) => {
      execFile('node', [path.join(__dirname, '../scripts/seed.js')], { env: { ...process.env, NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(64) } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stderr }));
    });
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Refusing to seed in production');
    expect(await User.count({ where: { email: 'admin@ex.com' } })).toBe(1);
  });
});
