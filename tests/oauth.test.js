// "Continuer avec Google / Apple". Providers are simulated: fetch() returns the ID token.
const crypto = require('crypto');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.GOOGLE_CLIENT_ID = 'google-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.APPLE_CLIENT_ID = 'com.sentravail.web';
process.env.APPLE_TEAM_ID = 'TEAM123456';
process.env.APPLE_KEY_ID = 'KEY1234567';
process.env.APPLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');

const { app, request, resetDb, closeDb, createUser } = require('./helpers');
const { User } = require('../src/models');
const oauth = require('../src/services/oauth');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
let nextClaims = null;
let lastTokenRequest = null;
const realFetch = global.fetch;

beforeAll(async () => {
  await resetDb();
  global.fetch = async (url, opts) => {
    lastTokenRequest = { url, body: new URLSearchParams(opts.body) };
    return { ok: true, status: 200, json: async () => ({ id_token: idToken(nextClaims) }) };
  };
});
afterAll(async () => { global.fetch = realFetch; await closeDb(); });

// Starts the flow like a browser and returns the agent + the state/nonce sent to the provider.
async function begin(provider, query = '') {
  const agent = request.agent(app);
  const res = await agent.get(`/auth/${provider}${query}`);
  expect(res.status).toBe(302);
  const url = new URL(res.headers.location);
  return { agent, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce'), url };
}
const google = (nonce, extra = {}) => ({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, nonce, sub: 'g-123', email: 'awa.ndiaye@gmail.com', email_verified: true, given_name: 'Awa', family_name: 'Ndiaye', ...extra });
async function csrfOf(agent, path) {
  return (await agent.get(path)).text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
}

test('buttons on the login and sign-up pages; redirect to Google with state and nonce', async () => {
  expect((await request(app).get('/connexion')).text).toContain('Continuer avec Google');
  expect((await request(app).get('/connexion')).text).toContain('Continuer avec Apple');
  expect((await request(app).get('/inscription')).text).toContain('S&#39;inscrire avec Google');
  const { url, state, nonce } = await begin('google', '?retour=/offres');
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/google/callback');
  expect(state).toMatch(/^[a-f0-9]{32}$/);
  expect(nonce).toMatch(/^[a-f0-9]{32}$/);
});

test('no buttons and no route when a provider is not configured', async () => {
  const env = require('../src/config/env');
  const saved = env.GOOGLE_CLIENT_ID;
  env.GOOGLE_CLIENT_ID = '';
  try {
    expect((await request(app).get('/connexion')).text).not.toContain('avec Google');
    expect((await request(app).get('/auth/google')).status).toBe(404);
  } finally { env.GOOGLE_CLIENT_ID = saved; }
});

test('new Google member chooses a profile (never admin), recruiter needs a company, then is logged in and sent back', async () => {
  const { agent, state, nonce } = await begin('google', '?retour=/offres');
  nextClaims = google(nonce);
  const cb = await agent.get(`/auth/google/callback?code=abc&state=${state}`);
  expect(cb.headers.location).toBe('/inscription/finaliser');
  expect(lastTokenRequest.body.get('client_secret')).toBe('google-secret');
  const page = await agent.get('/inscription/finaliser');
  expect(page.text).toContain('awa.ndiaye@gmail.com');
  expect(page.text).toContain('value="Awa"');
  const csrf = await csrfOf(agent, '/inscription/finaliser');
  const send = (body) => agent.post('/inscription/finaliser').type('form').send({ _csrf: csrf, firstName: 'Awa', lastName: 'Ndiaye', acceptTerms: 'on', ...body });
  expect((await send({ role: 'admin' })).status).toBe(422);
  const noCompany = await send({ role: 'recruiter' });
  expect(noCompany.status).toBe(422);
  expect(noCompany.text).toContain("Indiquez le nom de votre entreprise.");
  expect((await send({ role: 'candidate', acceptTerms: '' })).status).toBe(422);
  const ok = await send({ role: 'candidate' });
  expect(ok.status).toBe(302);
  expect(ok.headers.location).toBe('/offres');
  const user = await User.findOne({ where: { email: 'awa.ndiaye@gmail.com' } });
  expect(user.role).toBe('candidate');
  expect(user.googleId).toBe('g-123');
  expect((await agent.get('/mes-candidatures')).status).toBe(200); // logged in
  // Next time: straight in.
  const again = await begin('google');
  nextClaims = google(again.nonce);
  const res = await again.agent.get(`/auth/google/callback?code=abc&state=${again.state}`);
  expect(res.headers.location).toBe('/');
  expect(await User.count({ where: { email: 'awa.ndiaye@gmail.com' } })).toBe(1);
});

test('recruiter sign-up with Google: profile chosen on the sign-up page is preselected', async () => {
  const { agent, state, nonce } = await begin('google', '?role=recruiter');
  nextClaims = google(nonce, { sub: 'g-rec', email: 'rh@entreprise.sn' });
  await agent.get(`/auth/google/callback?code=abc&state=${state}`);
  const page = await agent.get('/inscription/finaliser');
  expect(page.text).toContain("role: 'recruiter'");
  const csrf = await csrfOf(agent, '/inscription/finaliser');
  await agent.post('/inscription/finaliser').type('form').send({ _csrf: csrf, firstName: 'Moussa', lastName: 'Ba', role: 'recruiter', companyName: 'Ba Industries', acceptTerms: 'on' });
  const user = await User.findOne({ where: { email: 'rh@entreprise.sn' } });
  expect(user.role).toBe('recruiter');
  expect(user.companyName).toBe('Ba Industries');
});

test('an existing account with the same verified email is linked, not duplicated', async () => {
  const existing = await createUser({ email: 'fatou@example.com', role: 'recruiter' });
  const { agent, state, nonce } = await begin('google');
  nextClaims = google(nonce, { sub: 'g-fatou', email: 'fatou@example.com' });
  const res = await agent.get(`/auth/google/callback?code=abc&state=${state}`);
  expect(res.headers.location).toBe('/');
  await existing.reload();
  expect(existing.googleId).toBe('g-fatou');
  expect(existing.role).toBe('recruiter');
});

test('refused: wrong state, wrong nonce, wrong audience, unverified email, banned account', async () => {
  let f = await begin('google');
  nextClaims = google(f.nonce, { sub: 'x1' });
  expect((await f.agent.get(`/auth/google/callback?code=abc&state=bad`)).headers.location).toBe('/connexion');
  f = await begin('google');
  nextClaims = google('other-nonce', { sub: 'x2' });
  expect((await f.agent.get(`/auth/google/callback?code=abc&state=${f.state}`)).headers.location).toBe('/connexion');
  f = await begin('google');
  nextClaims = google(f.nonce, { sub: 'x3', aud: 'someone-else' });
  expect((await f.agent.get(`/auth/google/callback?code=abc&state=${f.state}`)).headers.location).toBe('/connexion');
  f = await begin('google');
  nextClaims = google(f.nonce, { sub: 'x4', email: 'nv@example.com', email_verified: false });
  expect((await f.agent.get(`/auth/google/callback?code=abc&state=${f.state}`)).headers.location).toBe('/connexion');
  expect(await User.count({ where: { email: 'nv@example.com' } })).toBe(0);
  await createUser({ email: 'banni@example.com', isBanned: true });
  f = await begin('google');
  nextClaims = google(f.nonce, { sub: 'x5', email: 'banni@example.com' });
  const res = await f.agent.get(`/auth/google/callback?code=abc&state=${f.state}`);
  expect(res.headers.location).toBe('/connexion');
  expect((await f.agent.get('/connexion')).text).toContain('Ce compte a été suspendu');
});

test('Apple: form_post callback (no CSRF token), name sent once, ES256 client secret', async () => {
  const { agent, state, nonce, url } = await begin('apple');
  expect(url.searchParams.get('response_mode')).toBe('form_post');
  nextClaims = { iss: 'https://appleid.apple.com', aud: 'com.sentravail.web', exp: Math.floor(Date.now() / 1000) + 600, nonce, sub: 'a-001', email: 'xyz@privaterelay.appleid.com', email_verified: 'true' };
  const res = await agent.post('/auth/apple/callback').type('form').send({ code: 'c', state, user: JSON.stringify({ name: { firstName: 'Ibrahima', lastName: 'Sow' } }) });
  expect(res.headers.location).toBe('/inscription/finaliser');
  expect((await agent.get('/inscription/finaliser')).text).toContain('value="Ibrahima"');
  // Client secret: JWT signed with the .p8 key, verifiable with Apple's copy of the public key.
  const secret = lastTokenRequest.body.get('client_secret');
  const [h, p, sig] = secret.split('.');
  expect(JSON.parse(Buffer.from(h, 'base64url'))).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
  expect(JSON.parse(Buffer.from(p, 'base64url'))).toMatchObject({ iss: 'TEAM123456', sub: 'com.sentravail.web', aud: 'https://appleid.apple.com' });
  expect(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
  expect(oauth.enabledProviders()).toEqual(['google', 'apple']);
});
