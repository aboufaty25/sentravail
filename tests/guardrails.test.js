const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Comment, Notification, BannedTerm, User, Job, Report } = require('../src/models');
const moderation = require('../src/services/moderation');
const { normalizeNinea, normalizeRccm, isFreeEmailDomain } = require('../src/services/verification');
const notifications = require('../src/services/notifications');
const { outbox } = require('../src/services/mail');
const { buildSlug } = require('../src/services/jobs');

const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const publish = (s, slug, fields) => {
  let req = s.agent.post(`/publier/${slug}?_csrf=${s.csrf}`);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, String(v));
  return req;
};
const hired = (title, text = '') => ({ title, text });
const form = (s, url, body = {}) => s.agent.post(url).type('form').send({ _csrf: s.csrf, ...body });

let admin; let adminS;
beforeAll(async () => {
  await resetDb();
  admin = await createUser({ email: 'admin@ex.com', role: 'admin' });
  adminS = await loginAs(admin);
});
afterEach(() => notifications.flush());
afterAll(closeDb);

describe('Anti-scam filter (unit)', () => {
  test('matches whole words and phrases, ignoring case and accents', async () => {
    expect(await moderation.findBannedTerms('Envoyez les FRAIS DE DOSSIER par wave')).toEqual(expect.arrayContaining(['frais de dossier', 'Wave']));
    expect(await moderation.findBannedTerms('Un DEPOT de garantie est demandé')).toEqual(['dépôt']);
    expect(await moderation.findBannedTerms('Paiement via orange money')).toEqual(expect.arrayContaining(['paiement', 'Orange Money']));
    expect(await moderation.findBannedTerms('Nous payons nos salariés. Waves. Repayer.')).toEqual([]);
  });

  test('external links are detected, email addresses are not', () => {
    expect(moderation.hasExternalLink('Écrivez à rh@entreprise.sn')).toBe(false);
    expect(moderation.hasExternalLink('Postulez sur https://bit.ly/abc')).toBe(true);
    expect(moderation.hasExternalLink('Voir www.exemple.com')).toBe(true);
    expect(moderation.hasExternalLink('Infos sur offres-dakar.sn/postuler')).toBe(true);
    expect(moderation.hasExternalLink('Je suis à Dakar. Merci.')).toBe(false);
  });
});

describe('Trust levels', () => {
  test('a new account goes to moderation until 3 publications are approved', async () => {
    const u = await createUser({ email: 'new@ex.com', approvedPostsCount: 0, firstName: 'Nouveau' });
    const s = await loginAs(u);
    const res = await publish(s, 'recrute', hired('Caissier'));
    expect(res.status).toBe(302);
    const p = await Post.findOne({ where: { authorId: u.id }, order: [['id', 'DESC']] });
    expect([p.status, p.moderationReason]).toEqual(['pending_approval', 'new_account']);
    // hidden from others, visible to the author with a banner
    expect((await request(app).get(`/publications/${p.id}`)).status).toBe(404);
    expect((await s.agent.get(`/publications/${p.id}`)).text).toContain('En attente de validation');
    expect((await request(app).get('/fil?page=1')).text).not.toContain('Caissier');

    // admin approves 3 publications -> the 4th is published directly
    for (let i = 0; i < 3; i += 1) {
      const post = i === 0 ? p : await Post.create({ type: 'hired', title: `Poste ${i}`, authorId: u.id, status: 'pending_approval', moderationReason: 'new_account' });
      expect((await form(adminS, `/admin/moderation/publications/${post.id}`, { action: 'approve' })).status).toBe(302);
    }
    await u.reload();
    expect(u.approvedPostsCount).toBe(3);
    await notifications.flush();
    expect(await Notification.count({ where: { userId: u.id, type: 'post_approved' } })).toBe(3);
    await publish(s, 'recrute', hired('Vendeur'));
    expect((await Post.findOne({ where: { authorId: u.id, title: 'Vendeur' } })).status).toBe('published');
  });

  test('verified accounts and admins publish directly', async () => {
    const v = await createUser({ email: 'verified@ex.com', approvedPostsCount: 0, isVerified: true });
    await publish(await loginAs(v), 'recrute', hired('Comptable'));
    expect((await Post.findOne({ where: { authorId: v.id } })).status).toBe('published');
  });

  test('rejection notifies the author with the reason', async () => {
    const u = await createUser({ email: 'rej@ex.com', approvedPostsCount: 0 });
    await publish(await loginAs(u), 'recrute', hired('Poste douteux'));
    const p = await Post.findOne({ where: { authorId: u.id } });
    await form(adminS, `/admin/moderation/publications/${p.id}`, { action: 'reject', reason: 'Information non vérifiable' });
    await p.reload();
    expect(p.status).toBe('rejected');
    await notifications.flush();
    const n = await Notification.findOne({ where: { userId: u.id, type: 'post_rejected' } });
    expect(n.data.reason).toBe('Information non vérifiable');
  });

  test('a recruiter offer from a new account is held and followers are notified only on approval', async () => {
    const rec = await createUser({ email: 'newrec@ex.com', role: 'recruiter', approvedPostsCount: 0 });
    const follower = await createUser({ email: 'fol@ex.com' });
    await require('../src/models').Follow.create({ followerId: follower.id, followingId: rec.id });
    const rs = await loginAs(rec);
    let req = rs.agent.post(`/offres/nouvelle?_csrf=${rs.csrf}`);
    for (const [k, v] of Object.entries({ title: 'Magasinier', companyName: 'Dépôt Ba', location: 'Dakar', contractType: 'CDI', sector: 'Logistique & Transport', description: 'Gestion des entrées et sorties de stock.', applyEmail: 'rh@ba.sn' })) req = req.field(k, v);
    await req;
    const job = await Job.findOne({ where: { title: 'Magasinier' } });
    const post = await Post.findByPk(job.postId);
    expect(post.status).toBe('pending_approval');
    expect(post.moderationReason).toBe('filter'); // "Dépôt" in the company name
    expect((await request(app).get(`/offres/${job.slug}`)).status).toBe(404);
    expect(await Notification.count({ where: { userId: follower.id, type: 'new_job_from_followed' } })).toBe(0);
    await form(adminS, `/admin/moderation/publications/${post.id}`, { action: 'approve' });
    await notifications.flush();
    expect(await Notification.count({ where: { userId: follower.id, type: 'new_job_from_followed' } })).toBe(1);
    expect((await request(app).get(`/offres/${job.slug}`)).status).toBe(200);
  });
});

describe('Filter on publications and comments', () => {
  let trusted; let ts;
  beforeAll(async () => {
    trusted = await createUser({ email: 'trusted@ex.com' });
    ts = await loginAs(trusted);
  });

  test('a publication with a banned term is blocked even for trusted accounts', async () => {
    await publish(ts, 'recrute', hired('Agent commercial', 'Contactez-moi pour un investissement rentable'));
    const p = await Post.findOne({ where: { title: 'Agent commercial' } });
    expect([p.status, p.moderationReason]).toEqual(['pending_approval', 'filter']);
    expect(p.moderationNote).toContain('investissement');
    const queue = await adminS.agent.get('/admin/moderation/filtre');
    expect(queue.text).toContain('Agent commercial');
    expect(queue.text).toContain('Termes détectés : investissement');
  });

  test('comments: 500 characters max; banned terms held for review, visible only to the author', async () => {
    const host = await Post.create({ type: 'advice', title: 'Conseil', text: 'x', authorId: admin.id });
    const hx = (body) => ts.agent.post(`/publications/${host.id}/commentaires`).set('X-CSRF-Token', ts.csrf).set('HX-Request', 'true').type('form').send(body);
    expect((await hx({ text: 'x'.repeat(501) })).status).toBe(422);
    const res = await hx({ text: 'Envoyez le paiement par Wave pour réserver le poste' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('En attente de vérification');
    const c = await Comment.findOne({ where: { postId: host.id } });
    expect(c.status).toBe('pending_approval');
    await host.reload();
    expect(host.commentsCount).toBe(0);
    expect((await request(app).get(`/publications/${host.id}/commentaires`)).text).not.toContain('Wave');
    expect((await ts.agent.get(`/publications/${host.id}/commentaires`)).text).toContain('Wave');
    await form(adminS, `/admin/moderation/commentaires/${c.id}`, { action: 'approve' });
    await host.reload();
    expect(host.commentsCount).toBe(1);
    expect((await request(app).get(`/publications/${host.id}/commentaires`)).text).toContain('Wave');
  });

  test('the term list is editable from the admin and applies immediately', async () => {
    await form(adminS, '/admin/filtre', { action: 'add', term: 'Western Union' });
    expect(await moderation.findBannedTerms('payez par western union')).toContain('Western Union');
    const t = await BannedTerm.findOne({ where: { term: 'Western Union' } });
    await form(adminS, '/admin/filtre', { action: 'toggle', id: t.id });
    expect(await moderation.findBannedTerms('payez par western union')).toEqual([]);
    expect((await form(ts, '/admin/filtre', { action: 'add', term: 'test' })).status).toBe(403);
  });
});

describe('Limits', () => {
  test('one "Je cherche un emploi" per day and per user', async () => {
    const u = await createUser({ email: 'seeker@ex.com' });
    const s = await loginAs(u);
    const data = { title: 'Chauffeur', city: 'Dakar', experienceYears: 2, availability: 'Immédiatement', text: 'Permis C, 2 ans de livraison en ville.' };
    expect((await publish(s, 'recherche-emploi', data)).status).toBe(302);
    const second = await publish(s, 'recherche-emploi', data);
    expect(second.status).toBe(429);
    expect(second.text).toContain('déjà publié une recherche d’emploi aujourd’hui');
  });

  test('external links are refused for non-verified accounts, allowed for verified ones', async () => {
    const u = await createUser({ email: 'links@ex.com' });
    const res = await publish(await loginAs(u), 'recrute', hired('Développeur', 'Mon portfolio : https://monsite.com'));
    expect(res.status).toBe(422);
    expect(res.text).toContain('Les liens externes sont réservés aux comptes vérifiés');
    const v = await createUser({ email: 'links-v@ex.com', isVerified: true });
    expect((await publish(await loginAs(v), 'recrute', hired('Développeur', 'Mon portfolio : https://monsite.com'))).status).toBe(302);
  });
});

describe('Reports', () => {
  test('3 reports hide a comment until the admin decides', async () => {
    const host = await Post.create({ type: 'advice', title: 'Conseil', text: 'x', authorId: admin.id, commentsCount: 1 });
    const author = await createUser({ email: 'troll@ex.com' });
    const c = await Comment.create({ postId: host.id, authorId: author.id, text: 'insulte' });
    for (let i = 0; i < 3; i += 1) {
      const r = await loginAs(await createUser({ email: `rep${i}@ex.com` }));
      await r.agent.post('/signalements').set('X-CSRF-Token', r.csrf).send({ targetType: 'comment', targetId: c.id, reason: 'harassment' });
    }
    await c.reload();
    expect([c.status, c.moderationReason]).toEqual(['pending_approval', 'reports']);
    await host.reload();
    expect(host.commentsCount).toBe(0);
    await form(adminS, `/admin/signalements/comment/${c.id}`, { action: 'dismiss' });
    await c.reload();
    expect(c.status).toBe('published');
    expect(await Report.count({ where: { targetId: c.id, status: 'open' } })).toBe(0);
  });
});

describe('Recruiter verification', () => {
  test('NINEA / RCCM formats and free email domains', () => {
    expect(normalizeNinea('004562312 2V2')).toBe('0045623122V2');
    expect(normalizeNinea('12345')).toBeNull();
    expect(normalizeRccm('sn dkr 2020 b 12345')).toBe('SN-DKR-2020-B-12345');
    expect(normalizeRccm('ABC')).toBeNull();
    expect(isFreeEmailDomain('a@gmail.com')).toBe(true);
    expect(isFreeEmailDomain('a@yahoo.co.uk')).toBe(true);
    expect(isFreeEmailDomain('rh@teranga-digital.sn')).toBe(false);
  });

  test('request with NINEA, then admin approval grants the badge', async () => {
    const rec = await createUser({ email: 'nin@ex.com', role: 'recruiter', companyName: 'Ndiaye SA' });
    const rs = await loginAs(rec);
    expect((await form(rs, '/parametres/verification', { method: 'ninea', value: '12' })).status).toBe(422);
    await form(rs, '/parametres/verification', { method: 'ninea', value: '004562312 2V2' });
    await rec.reload();
    expect([rec.verificationStatus, rec.verificationValue]).toEqual(['pending', '0045623122V2']);
    expect((await adminS.agent.get('/admin/verifications')).text).toContain('0045623122V2');
    await form(adminS, `/admin/verifications/${rec.id}`, { action: 'approve' });
    await rec.reload();
    expect(rec.isVerified).toBe(true);
    await notifications.flush();
    expect(await Notification.count({ where: { userId: rec.id, type: 'verification_approved' } })).toBe(1);
  });

  test('professional email: free providers refused, ownership confirmed by link before approval', async () => {
    const rec = await createUser({ email: 'mail@ex.com', role: 'recruiter' });
    const rs = await loginAs(rec);
    const free = await form(rs, '/parametres/verification', { method: 'email', value: 'patron@gmail.com' });
    expect(free.status).toBe(422);
    expect(free.text).toContain('Gmail, Yahoo, Hotmail');
    await form(rs, '/parametres/verification', { method: 'email', value: 'rh@teranga-digital.sn' });
    await notifications.flush();
    const mail = outbox.filter((m) => m.to === 'rh@teranga-digital.sn').pop();
    const token = mail.text.match(/verification\/confirmer\/([a-f0-9]{64})/)[1];
    // admin cannot approve before confirmation
    await form(adminS, `/admin/verifications/${rec.id}`, { action: 'approve' });
    await rec.reload();
    expect(rec.isVerified).toBe(false);
    await request(app).get(`/verification/confirmer/${token}`);
    await rec.reload();
    expect(rec.verificationEmailConfirmed).toBe(true);
    await form(adminS, `/admin/verifications/${rec.id}`, { action: 'approve' });
    await rec.reload();
    expect(rec.isVerified).toBe(true);
  });

  test('candidates cannot request the recruiter badge', async () => {
    const c = await createUser({ email: 'cand-v@ex.com' });
    expect((await form(await loginAs(c), '/parametres/verification', { method: 'ninea', value: '004562312' })).status).toBe(403);
  });
});

describe('Anti-scam message', () => {
  test('shown on every job page and in the apply modal', async () => {
    const rec = await createUser({ email: 'r9@ex.com', role: 'recruiter' });
    const post = await Post.create({ type: 'job', authorId: rec.id });
    const job = await Job.create({ postId: post.id, slug: buildSlug('Vendeur', 'Dakar'), title: 'Vendeur', companyName: 'Boutique', location: 'Dakar', contractType: 'CDD', sector: 'Commerce & Vente', description: 'x'.repeat(40), applyEmail: 'a@b.sn', deadline: inDays(5) });
    const page = await request(app).get(`/offres/${job.slug}`);
    const count = (page.text.match(/Un vrai recruteur ne demande jamais d('|&#39;)argent/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2); // job page + apply modal
  });
});

describe('Admin queue access', () => {
  test('moderation pages are admin-only', async () => {
    const u = await createUser({ email: 'nope@ex.com' });
    const s = await loginAs(u);
    for (const url of ['/admin/moderation', '/admin/moderation/filtre', '/admin/verifications', '/admin/filtre']) {
      expect((await s.agent.get(url)).status).toBe(403);
      expect((await adminS.agent.get(url)).status).toBe(200);
    }
  });
});
