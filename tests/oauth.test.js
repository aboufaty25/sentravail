// "Continuer avec Google / Apple". Providers are simulated: fetch() returns the ID token.
const crypto = require('crypto');

// Apple signs its ID tokens (RS256); the test plays Apple with its own key pair.
const apple = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const appleJwk = { ...apple.publicKey.export({ format: 'jwk' }), kid: 'apple-kid-1', alg: 'RS256', use: 'sig' };
process.env.GOOGLE_CLIENT_ID = 'google-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.APPLE_CLIENT_ID = 'com.sentravail.web';

const { app, request, resetDb, closeDb, createUser } = require('./helpers');
const { User } = require('../src/models');
const oauth = require('../src/services/oauth');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
function appleIdToken(claims, key = apple.privateKey, kid = 'apple-kid-1') {
  const data = `${b64({ alg: 'RS256', kid })}.${b64(claims)}`;
  return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`;
}
const appleClaims = (nonce, extra = {}) => ({ iss: 'https://appleid.apple.com', aud: 'com.sentravail.web', exp: Math.floor(Date.now() / 1000) + 600, nonce, sub: 'a-001', email: 'xyz@privaterelay.appleid.com', email_verified: 'true', ...extra });
let fetchedUrls = [];
let nextClaims = null;
let lastTokenRequest = null;
const realFetch = global.fetch;

beforeAll(async () => {
  await resetDb();
  global.fetch = async (url, opts = {}) => {
    fetchedUrls.push(url);
    if (url === 'https://appleid.apple.com/auth/keys') return { ok: true, status: 200, json: async () => ({ keys: [appleJwk] }) };
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

test('Apple: only the Services ID is needed; signed ID token posted back (no CSRF token, no secret), name sent once', async () => {
  const { agent, state, nonce, url } = await begin('apple');
  expect(url.searchParams.get('response_mode')).toBe('form_post');
  expect(url.searchParams.get('response_type')).toBe('code id_token');
  expect(url.searchParams.get('client_id')).toBe('com.sentravail.web');
  fetchedUrls = [];
  const res = await agent.post('/auth/apple/callback').type('form')
    .send({ code: 'c', id_token: appleIdToken(appleClaims(nonce)), state, user: JSON.stringify({ name: { firstName: 'Ibrahima', lastName: 'Sow' } }) });
  expect(res.headers.location).toBe('/inscription/finaliser');
  expect((await agent.get('/inscription/finaliser')).text).toContain('value="Ibrahima"');
  // Only Apple's public keys are fetched: no token exchange, no client secret.
  expect(fetchedUrls).toEqual(['https://appleid.apple.com/auth/keys']);
  expect(oauth.enabledProviders()).toEqual(['google', 'apple']);
  expect(oauth.diagnose('apple')).toBeNull();
});

test('Apple: forged, altered, foreign or replayed tokens are refused', async () => {
  const forger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cases = [
    (n) => appleIdToken(appleClaims(n), forger.privateKey), // not signed by Apple
    (n) => { const [h, , sig] = appleIdToken(appleClaims(n)).split('.'); return `${h}.${b64(appleClaims(n, { sub: 'someone-else' }))}.${sig}`; }, // altered
    (n) => appleIdToken(appleClaims(n, { aud: 'com.other.app' })), // another site's token
    () => appleIdToken(appleClaims('old-nonce')), // replayed
    (n) => appleIdToken(appleClaims(n, { exp: Math.floor(Date.now() / 1000) - 3600 })), // expired
    (n) => appleIdToken(appleClaims(n), apple.privateKey, 'unknown-kid'),
  ];
  for (const make of cases) {
    const { agent, state, nonce } = await begin('apple');
    const res = await agent.post('/auth/apple/callback').type('form').send({ code: 'c', id_token: make(nonce), state });
    expect(res.headers.location).toBe('/connexion');
  }
  expect(await User.count({ where: { appleId: 'someone-else' } })).toBe(0);
});

test('Apple off without APPLE_CLIENT_ID', () => {
  const env = require('../src/config/env');
  const saved = env.APPLE_CLIENT_ID;
  try {
    env.APPLE_CLIENT_ID = '';
    expect(oauth.diagnose('apple')).toBe('not configured');
    expect(oauth.enabledProviders()).toEqual(['google']);
  } finally { env.APPLE_CLIENT_ID = saved; }
});

test('www and non-www: the flow starts on the APP_URL host so the state cookie comes back', async () => {
  const res = await request(app).get('/auth/apple?retour=/offres').set('Host', 'www.localhost:3000');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('http://localhost:3000/auth/apple?retour=/offres');
});

test('a refused sign-in is recorded with a hint for the admin (no secrets), cleared after a success', async () => {
  const admin = await createUser({ email: 'boss@ex.com', role: 'admin' });
  const agentAdm = request.agent(app);
  const csrf = (await agentAdm.get('/connexion')).text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  await agentAdm.post('/connexion').type('form').send({ identifier: admin.email, password: 'password123', _csrf: csrf });

  const { agent, state, nonce } = await begin('apple');
  const res = await agent.post('/auth/apple/callback').type('form').send({ code: 'c', state, id_token: appleIdToken(appleClaims(nonce, { aud: 'com.sentravail.app' })) });
  expect(res.headers.location).toBe('/connexion');
  let page = (await agentAdm.get('/admin/google')).text;
  expect(page).toContain('Connexion avec Google et Apple');
  expect(page).toContain('bad audience');
  expect(page).toContain('Services ID');
  expect(page).toContain('http://localhost:3000/auth/apple/callback');
  expect(page).not.toContain('PRIVATE KEY');
  expect(page).not.toContain('google-secret');

  // Lost state cookie (e.g. www vs non-www) is explained too.
  await request(app).post('/auth/apple/callback').type('form').send({ code: 'c', state: 'x' });
  page = (await agentAdm.get('/admin/google')).text;
  expect(page).toContain('cookie de connexion a été perdu');

  const again = await begin('apple');
  await again.agent.post('/auth/apple/callback').type('form').send({ code: 'c', state: again.state, id_token: appleIdToken(appleClaims(again.nonce)) });
  await new Promise((r) => setTimeout(r, 50));
  page = (await agentAdm.get('/admin/google')).text;
  expect(page).not.toContain('bad audience');
});
