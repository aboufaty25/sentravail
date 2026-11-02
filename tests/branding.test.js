const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const branding = require('../src/services/branding');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);

let adm; let rec;
beforeAll(async () => {
  await resetDb();
  await branding.load();
  [adm, rec] = await Promise.all([loginAs(await createUser({ role: 'admin' })), loginAs(await createUser({ role: 'recruiter' }))]);
});
afterAll(closeDb);

const upload = (s, asset, file = PNG, name = 'logo.png', extra = {}) => {
  let req = s.agent.post(`/admin/apparence/${asset}?_csrf=${s.csrf}`);
  for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
  return file ? req.attach('image', file, { filename: name, contentType: name.endsWith('.png') ? 'image/png' : 'image/jpeg' }) : req;
};

test('only admins can change the branding (server-side)', async () => {
  expect((await rec.agent.get('/admin/apparence')).status).toBe(403);
  expect((await upload(rec, 'logo')).status).toBe(403);
  expect((await request(app).get('/admin/apparence')).status).toBe(302);
  expect(branding.current().customLogo).toBe(false);
});

test('defaults: original logo, icons and share image', async () => {
  const home = await request(app).get('/');
  expect(home.text).toContain('<link rel="icon" href="/icons/logo.svg" type="image/svg+xml">');
  expect(home.text).toContain('content="http://localhost:3000/icons/og-default.jpg"');
  const manifest = await request(app).get('/manifest.webmanifest');
  expect(manifest.status).toBe(200);
  expect(manifest.headers['content-type']).toContain('application/manifest+json');
  expect(manifest.body.icons[0].src).toBe('/icons/icon-192.png');
});

test('admin uploads a logo: shown in the header and on the login page, then resets it', async () => {
  const page = await adm.agent.get('/admin/apparence');
  expect(page.status).toBe(200);
  expect(page.text).toContain('Logo du site');
  const res = await upload(adm, 'logo');
  expect(res.status).toBe(302);
  const { logo, customLogo } = branding.current();
  expect(customLogo).toBe(true);
  expect(logo).toMatch(/^\/uploads\/branding\//);
  expect((await request(app).get('/')).text).toContain(`<img src="${logo}" alt="SenTravail"`);
  expect((await request(app).get('/connexion')).text).toContain(`<img src="${logo}" alt="SenTravail"`);
  expect((await upload(adm, 'logo', null, null, { action: 'reset' })).status).toBe(302);
  expect(branding.current().customLogo).toBe(false);
  expect((await request(app).get('/')).text).not.toContain(logo);
});

test('app icon must be PNG; updates favicon and manifest', async () => {
  const bad = await upload(adm, 'icon', JPG, 'icon.jpg');
  expect(bad.status).toBe(422);
  expect(bad.text).toContain("L&#39;icône doit être une image PNG carrée.");
  const ok = await adm.agent.post(`/admin/apparence/icon?_csrf=${adm.csrf}`)
    .attach('image', PNG, { filename: 'i-512.png', contentType: 'image/png' })
    .attach('icon192', PNG, { filename: 'i-192.png', contentType: 'image/png' });
  expect(ok.status).toBe(302);
  const b = branding.current();
  expect(b.customIcon).toBe(true);
  expect(b.icon192).not.toBe(b.icon512);
  expect((await request(app).get('/')).text).toContain(`<link rel="icon" href="${b.icon192}" type="image/png">`);
  const manifest = (await request(app).get('/manifest.webmanifest')).body;
  expect(manifest.icons.map((i) => i.src)).toEqual([b.icon192, b.icon512, b.icon512]);
});

test('default share image is used for pages without their own image', async () => {
  expect((await upload(adm, 'share', JPG, 'share.jpg')).status).toBe(302);
  const { shareImage } = branding.current();
  expect(shareImage).toMatch(/^http:\/\/localhost:3000\/uploads\/branding\//);
  const home = await request(app).get('/');
  expect(home.text).toContain(`<meta property="og:image" content="${shareImage}">`);
  expect(home.text).toContain('<meta name="twitter:card" content="summary_large_image">');
});

test('missing file and unknown asset', async () => {
  expect((await upload(adm, 'logo', null, null, { note: '' })).status).toBe(422);
  expect((await upload(adm, 'favicon')).status).toBe(404);
});
