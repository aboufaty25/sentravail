// Job description written with the rich text editor: sanitized HTML, rendering, rules.
const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Job } = require('../src/models');
const rich = require('../src/utils/richDescription');

const base = { title: 'Assistant comptable', companyName: 'Ba Services', location: 'Dakar', contractType: 'CDI', sector: 'Comptabilité', applyMode: 'email', applyEmail: 'rh@ba.example' };
const HTML = '<h2>Missions</h2><ul><li><strong>Saisie</strong> des pièces comptables</li><li>Rapprochements <em>bancaires</em></li></ul><h3>Profil recherché</h3><p>Bac+2 en comptabilité, 2 ans d’expérience.</p>';

let rec; let verified;
beforeAll(async () => {
  await resetDb();
  rec = await loginAs(await createUser({ email: 'rec@ex.com', role: 'recruiter' }));
  verified = await loginAs(await createUser({ email: 'ver@ex.com', role: 'recruiter', isVerified: true }));
});
afterAll(closeDb);

const publish = (s, data) => {
  let req = s.agent.post(`/offres/nouvelle?_csrf=${s.csrf}`);
  for (const [k, v] of Object.entries({ ...base, ...data })) req = req.field(k, v);
  return req;
};

describe('sanitizer', () => {
  test('keeps structure, drops everything dangerous or foreign', () => {
    const dirty = '<h1 style="color:red">Titre</h1><p onclick="x()">Texte <b>gras</b> <i>it</i> <span style="font-weight:700">span</span></p>'
      + '<script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">bad</a><a href="https://ba.sn">ok</a><iframe src="https://evil"></iframe><p></p>';
    const out = rich.sanitize(dirty);
    expect(out).toBe('<h2>Titre</h2><p>Texte <strong>gras</strong> <em>it</em> span</p><a href="https://ba.sn" target="_blank" rel="nofollow ugc noopener">ok</a>');
    expect(rich.sanitize('<p>a <a href="https://x.sn">lien</a></p>', { links: false })).toBe('<p>a lien</p>');
  });

  test('plain text, length and links of a description', () => {
    expect(rich.toText(HTML)).toContain('• Saisie des pièces comptables');
    expect(rich.isRich('Texte simple\nsur deux lignes')).toBe(false);
    expect(rich.toHtml('Ligne 1\nLigne 2\n\n<b>Para</b>')).toBe('<p>Ligne 1<br>Ligne 2</p><p>&lt;b&gt;Para&lt;/b&gt;</p>');
    expect(rich.hrefs('<a href="https://a.sn/x?a=1&amp;b=2">x</a>')).toEqual(['https://a.sn/x?a=1&b=2']);
  });
});

test('an offer written with the editor is stored sanitized and shown formatted', async () => {
  const res = await publish(rec, { title: 'Assistant comptable riche', description: `${HTML}<script>alert(1)</script><p onmouseover="x()">Fin</p>` });
  expect(res.status).toBe(302);
  const job = await Job.findOne({ where: { title: 'Assistant comptable riche' } });
  expect(job.description).not.toContain('<script');
  expect(job.description).not.toContain('onmouseover');
  expect(job.description).toContain('<h2>Missions</h2>');
  const page = (await request(app).get(`/offres/${job.slug}`)).text;
  expect(page).toContain('<div class="rich-text"><h2>Missions</h2><ul><li><strong>Saisie</strong>');
  // Feed card and meta description: plain text excerpt, no tags.
  expect(page).toMatch(/<meta name="description" content="CDI · Dakar · Ba Services\. Missions • Saisie/);
  const feed = (await request(app).get('/offres')).text;
  expect(feed).not.toContain('&lt;h2&gt;');
  // Google for Jobs: HTML description.
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  expect(ld.description).toContain('<h2>Missions</h2>');
});

test('the visible text decides the 30 / 8000 limits, not the tags', async () => {
  const short = await publish(rec, { title: 'Trop court', description: '<p><strong><em>Court</em></strong></p>' });
  expect(short.status).toBe(422);
  expect(short.text).toContain('30 caractères minimum');
  const long = await publish(rec, { title: 'Trop long', description: `<p>${'a'.repeat(8001)}</p>` });
  expect(long.status).toBe(422);
  expect(long.text).toContain('8000 caractères maximum');
});

test('links behind a text are still links (unverified accounts) and banned terms are found in the text', async () => {
  const hidden = await publish(rec, { title: 'Lien caché', description: '<p>Envoyez votre dossier en cliquant <a href="https://arnaque.example">ici</a> pour la suite du recrutement.</p>' });
  expect(hidden.status).toBe(422);
  expect(await Job.count({ where: { title: 'Lien caché' } })).toBe(0);
  const ok = await publish(verified, { title: 'Lien autorisé', description: '<p>Présentation complète de l’entreprise sur <a href="https://ba.sn">notre site</a>, merci.</p>' });
  expect(ok.status).toBe(302);
  const scam = await publish(rec, { title: 'Frais', description: '<p>Des <strong>frais de dossier</strong> de 10 000 FCFA sont demandés aux candidats retenus.</p>' });
  expect(scam.status).toBe(302);
  const job = await Job.findOne({ where: { title: 'Frais' }, include: ['post'] });
  expect(job.post.status).toBe('pending_approval');
});

test('the form shows the editor (toolbar), with the plain field as fallback; old plain offers still display', async () => {
  const form = (await rec.agent.get('/offres/nouvelle')).text;
  expect(form).toContain('x-data="richEditor(');
  expect(form).toContain('aria-label="Mise en forme"');
  expect(form).toContain('<textarea id="f-description" name="description"');
  expect(form).not.toContain('aria-label="Insérer un lien"'); // unverified: no link button…
  expect((await verified.agent.get('/offres/nouvelle')).text).toContain('aria-label="Insérer un lien"');

  const plain = await publish(rec, { title: 'Offre texte simple', description: 'Première ligne de la description\nDeuxième ligne avec <b> littéral.' });
  expect(plain.status).toBe(302);
  const job = await Job.findOne({ where: { title: 'Offre texte simple' } });
  const page = (await request(app).get(`/offres/${job.slug}`)).text;
  expect(page).toContain('Deuxième ligne avec &lt;b&gt; littéral.');
});
