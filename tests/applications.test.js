const fs = require('fs');
const path = require('path');
const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job, Application } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');
const cvStorage = require('../src/services/cvStorage');
const { outbox } = require('../src/services/mail');
const env = require('../src/config/env');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml....')]);
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let recruiter; let otherRecruiter; let candidate; let admin;
let rec; let other; let cand; let adm;
let job; let expiredJob;

async function makeJob(author, data = {}) {
  const post = await Post.create({ type: 'advice', title: 'Conseil', authorId: author.id, type: 'job' });
  return Job.create({
    postId: post.id, slug: buildSlug(data.title || 'Comptable', 'Dakar'), title: 'Comptable', companyName: 'Ba SA', location: 'Dakar',
    contractType: 'CDI', sector: 'Comptabilité', description: 'x'.repeat(40), applyEmail: 'jobs@ba.example', deadline: inDays(10), ...data,
  });
}

// Guest helper: agent with a CSRF token from any page.
async function guest() {
  const agent = request.agent(app);
  const page = await agent.get('/connexion');
  return { agent, csrf: page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1] };
}

const form = { firstName: 'Moustapha', lastName: 'Diallo', email: 'moustapha@example.com', phone: '76 555 44 33', message: 'Disponible immédiatement.' };

function apply(s, slug, fields = form, file = PDF, filename = 'mon cv.pdf') {
  let req = s.agent.post(`/offres/${slug}/postuler`).set('X-CSRF-Token', s.csrf).set('Accept', 'application/json');
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  if (file) req = req.attach('cv', file, { filename, contentType: filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' });
  return req;
}
const post = (s, url, body = {}) => s.agent.post(url).set('X-CSRF-Token', s.csrf).set('Accept', 'application/json').send(body);

beforeAll(async () => {
  await resetDb();
  fs.rmSync(env.cvDir, { recursive: true, force: true });
  recruiter = await createUser({ email: 'rec@ex.com', role: 'recruiter', companyName: 'Ba SA' });
  otherRecruiter = await createUser({ email: 'rec2@ex.com', role: 'recruiter' });
  candidate = await createUser({ email: 'cand@ex.com', firstName: 'Aïssatou', lastName: 'Fall', phone: '+221770000004' });
  admin = await createUser({ email: 'admin@ex.com', role: 'admin' });
  [rec, other, cand, adm] = await Promise.all([loginAs(recruiter), loginAs(otherRecruiter), loginAs(candidate), loginAs(admin)]);
  job = await makeJob(recruiter);
  expiredJob = await makeJob(recruiter, { title: 'Ancienne', deadline: inDays(-1) });
});
afterAll(closeDb);

describe('Guest application via mailto', () => {
  let g; let res;
  beforeAll(async () => {
    g = await guest();
    res = await apply(g, job.slug);
  });

  test('creates an application in "opened_mail" with a private CV', async () => {
    expect(res.status).toBe(201);
    const a = await Application.findByPk(res.body.id);
    expect(a.status).toBe('opened_mail');
    expect(a.candidateId).toBeNull();
    expect(a.recruiterId).toBe(recruiter.id);
    expect(a.phone).toBe('+221765554433');
    expect(a.jobTitle).toBe('Comptable');
    expect(a.cvKey).toMatch(/^\d{4}\/\d{2}\/[a-f0-9]{24}\.pdf$/);
    expect(a.cvName).toBe('mon cv.pdf');
    // stored outside any public folder
    expect(fs.existsSync(path.join(env.cvDir, a.cvKey))).toBe(true);
    expect(env.cvDir.includes(`${path.sep}public${path.sep}`)).toBe(false);
  });

  test('returns a mailto link: recipient, subject, body with candidate info and signed CV link', async () => {
    const { mailto } = res.body;
    expect(mailto.startsWith('mailto:jobs@ba.example?subject=')).toBe(true);
    const params = new URLSearchParams(mailto.split('?')[1]);
    expect(params.get('subject')).toBe('Candidature — Comptable — via SenTravail');
    const body = params.get('body');
    expect(body).toContain('Moustapha Diallo');
    expect(body).toContain('moustapha@example.com');
    expect(body).toContain('+221765554433');
    expect(body).toContain('Disponible immédiatement.');
    expect(body).toContain(`valable ${env.CV_LINK_DAYS} jours`);
    expect(body).toMatch(/http:\/\/localhost:3000\/cv\/telecharger\?k=/);
    expect(mailto.length).toBeLessThan(2000);
  });

  test('the signed CV link downloads the file; tampered, expired or traversal links fail', async () => {
    const body = new URLSearchParams(res.body.mailto.split('?')[1]).get('body');
    const link = body.match(/http:\/\/localhost:3000(\/cv\/telecharger\?\S+)/)[1];
    const ok = await request(app).get(link);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/application\/pdf/);
    expect(ok.headers['content-disposition']).toContain('attachment');
    expect(ok.headers['cache-control']).toContain('no-store');

    expect((await request(app).get(link.replace(/s=[^&]+/, 's=xxxx'))).status).toBe(403);
    expect((await request(app).get(link.replace(/n=[^&]+/, 'n=autre.pdf'))).status).toBe(403);
    const q = new URLSearchParams(link.split('?')[1]);
    q.set('k', '../../etc/passwd');
    expect((await request(app).get(`/cv/telecharger?${q}`)).status).toBe(403);

    const a = await Application.findByPk(res.body.id);
    const expired = cvStorage.signedPath(a.cvKey, a.cvName, -1);
    expect((await request(app).get(expired)).status).toBe(403);
  });

  test('CV files are never served statically', async () => {
    const a = await Application.findByPk(res.body.id);
    expect((await request(app).get(`/uploads/${a.cvKey}`)).status).toBe(404);
    expect((await request(app).get(`/storage/cvs/${a.cvKey}`)).status).toBe(404);
  });

  test('another visitor cannot confirm it; the applicant can ("Oui, c\'est envoyé")', async () => {
    const stranger = await guest();
    expect((await post(stranger, `/candidatures/${res.body.id}/confirmer`)).status).toBe(404);
    const ok = await post(g, `/candidatures/${res.body.id}/confirmer`);
    expect(ok.status).toBe(200);
    const a = await Application.findByPk(res.body.id);
    expect(a.status).toBe('confirmed_sent');
    expect(a.sentVia).toBe('mailto');
    expect(a.sentAt).not.toBeNull();
  });

  test('applying again to the same offer with the same email is refused once sent', async () => {
    const again = await apply(await guest(), job.slug);
    expect(again.status).toBe(409);
  });

  test('"Non, réessayer" can rebuild the mailto link for an unconfirmed application', async () => {
    const g2 = await guest();
    const r = await apply(g2, job.slug, { ...form, email: 'autre@example.com' });
    const again = await post(g2, `/candidatures/${r.body.id}/mailto`);
    expect(again.status).toBe(200);
    expect(again.body.mailto).toContain('mailto:jobs@ba.example');
  });
});

describe('Fallback: send via SenTravail', () => {
  test('server sends the application with the CV attached + a receipt to the candidate', async () => {
    const g = await guest();
    const r = await apply(g, job.slug, { ...form, email: 'serveur@example.com' });
    const before = outbox.length;
    const sent = await post(g, `/candidatures/${r.body.id}/envoyer`);
    expect(sent.status).toBe(200);
    const [toRecruiter, receipt] = outbox.slice(before);
    expect(toRecruiter.to).toBe('jobs@ba.example');
    expect(toRecruiter.replyTo).toContain('serveur@example.com');
    expect(toRecruiter.subject).toBe('Candidature — Comptable — via SenTravail');
    expect(toRecruiter.attachments).toHaveLength(1);
    expect(toRecruiter.attachments[0].filename).toBe('mon cv.pdf');
    const content = toRecruiter.attachments[0].content;
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'base64'); // jsonTransport serializes to base64
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(toRecruiter.text).toContain('Mon CV est joint');
    expect(receipt.to).toBe('serveur@example.com');
    const a = await Application.findByPk(r.body.id);
    expect(a.status).toBe('confirmed_sent');
    expect(a.sentVia).toBe('server');

    // cannot be sent twice
    const count = outbox.length;
    await post(g, `/candidatures/${r.body.id}/envoyer`);
    expect(outbox.length).toBe(count);
  });
});

describe('Anti-spam for anonymous applications', () => {
  test('the invisible honeypot field rejects bots without storing anything', async () => {
    const before = await Application.count();
    const res = await apply(await guest(), job.slug, { ...form, email: 'bot@example.com', website: 'http://spam.example' });
    expect(res.status).toBe(400);
    expect(await Application.count()).toBe(before);
  });

  test('the modal carries the honeypot, hidden from people', async () => {
    const page = await request(app).get(`/offres/${job.slug}`);
    expect(page.text).toMatch(/aria-hidden="true">\s*<label for="ap-website">/);
  });
});

describe('Validation and rules', () => {
  test.each([
    [{ ...form, email: 'nope' }, 'email'],
    [{ ...form, phone: '12' }, 'phone'],
    [{ ...form, firstName: 'A' }, 'firstName'],
    [{ ...form, message: 'x'.repeat(1001) }, 'message'],
  ])('rejects invalid field %#', async (fields, key) => {
    const res = await apply(await guest(), job.slug, fields);
    expect(res.status).toBe(422);
    expect(res.body.errors[key]).toBeTruthy();
  });

  test('requires a CV', async () => {
    const res = await apply(await guest(), job.slug, form, null);
    expect(res.status).toBe(422);
    expect(res.body.errors.cv).toMatch(/Ajoutez votre CV/);
  });

  test('accepts DOCX, rejects fake or oversized files', async () => {
    expect((await apply(await guest(), job.slug, { ...form, email: 'docx@example.com' }, DOCX, 'cv.docx')).status).toBe(201);
    const fake = await apply(await guest(), job.slug, { ...form, email: 'fake@example.com' }, Buffer.from('MZ\x90\x00 not a pdf at all'), 'cv.pdf');
    expect(fake.status).toBe(422);
    const big = await apply(await guest(), job.slug, { ...form, email: 'big@example.com' }, Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), 'cv.pdf');
    expect(big.status).toBe(422);
    expect(big.body.error).toMatch(/5 Mo/);
  });

  test('expired or unknown offers cannot receive applications', async () => {
    expect((await apply(await guest(), expiredJob.slug)).status).toBe(410);
    expect((await apply(await guest(), 'inconnue-abc123')).status).toBe(404);
  });

  test('a recruiter cannot apply to their own offer', async () => {
    expect((await apply(rec, job.slug)).status).toBe(403);
  });

  test('requires CSRF', async () => {
    const g = await guest();
    const res = await g.agent.post(`/offres/${job.slug}/postuler`).set('Accept', 'application/json').field('firstName', 'x');
    expect(res.status).toBe(403);
  });
});

describe('Logged-in candidate', () => {
  test('first uploaded CV is saved on the profile and reused next time', async () => {
    const r1 = await apply(cand, job.slug, { ...form, email: 'cand@ex.com' });
    expect(r1.status).toBe(201);
    const a1 = await Application.findByPk(r1.body.id);
    expect(a1.candidateId).toBe(candidate.id);
    await candidate.reload();
    expect(candidate.cvUrl).toBe(a1.cvKey);

    const job2 = await makeJob(recruiter, { title: 'Auditeur' });
    const r2 = await apply(cand, job2.slug, { ...form, email: 'cand@ex.com', cvSource: 'profile' }, null);
    expect(r2.status).toBe(201);
    expect((await Application.findByPk(r2.body.id)).cvKey).toBe(candidate.cvUrl);
  });

  test('a pending application is updated rather than duplicated', async () => {
    const job3 = await makeJob(recruiter, { title: 'Caissier' });
    const r1 = await apply(cand, job3.slug, { ...form, message: 'v1' });
    const r2 = await apply(cand, job3.slug, { ...form, message: 'v2' });
    expect(r2.body.id).toBe(r1.body.id);
    expect(await Application.count({ where: { jobPostId: job3.postId, candidateId: candidate.id } })).toBe(1);
  });

  test('the job page reopens the confirmation step for a pending application', async () => {
    const job4 = await makeJob(recruiter, { title: 'Magasinier' });
    const r = await apply(cand, job4.slug);
    const page = await cand.agent.get(`/offres/${job4.slug}`);
    expect(page.text).toContain(`pendingId: ${r.body.id}`);
  });

  test('Mes candidatures lists own applications only', async () => {
    const page = await cand.agent.get('/mes-candidatures');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Auditeur');
    expect(page.text).toContain('Terminer ma candidature');
    expect(page.text).not.toContain('moustapha@example.com');
  });

  test('applications survive the deletion of the offer', async () => {
    const job5 = await makeJob(recruiter, { title: 'Temporaire' });
    const r = await apply(cand, job5.slug);
    await Post.destroy({ where: { id: job5.postId } });
    const a = await Application.findByPk(r.body.id);
    expect(a).not.toBeNull();
    expect(a.jobPostId).toBeNull();
    expect((await cand.agent.get('/mes-candidatures')).text).toContain('offre retirée');
  });
});

describe('Recruiter side', () => {
  let appId;
  beforeAll(async () => {
    const g = await guest();
    const r = await apply(g, job.slug, { ...form, email: 'review@example.com' });
    await post(g, `/candidatures/${r.body.id}/confirmer`);
    appId = r.body.id;
  });

  test('owner sees received applications with counts; others cannot', async () => {
    const list = await rec.agent.get(`/mes-offres/${job.slug}/candidatures`);
    expect(list.status).toBe(200);
    expect(list.text).toContain('review@example.com');
    expect((await other.agent.get(`/mes-offres/${job.slug}/candidatures`)).status).toBe(403);
    expect((await cand.agent.get(`/mes-offres/${job.slug}/candidatures`)).status).toBe(403);
    expect((await adm.agent.get(`/mes-offres/${job.slug}/candidatures`)).status).toBe(200);
    const mine = await rec.agent.get('/mes-offres');
    expect(mine.text).toMatch(/\d+ candidatures?/);
  });

  test('opening an application marks it viewed', async () => {
    expect((await other.agent.get(`/candidatures/${appId}`)).status).toBe(403);
    const page = await rec.agent.get(`/candidatures/${appId}`);
    expect(page.status).toBe(200);
    expect((await Application.findByPk(appId)).status).toBe('viewed');
    const cvHref = page.text.match(/href="(\/cv\/telecharger\?[^"]+)"/)[1].replace(/&amp;/g, '&');
    expect((await request(app).get(cvHref)).status).toBe(200);
  });

  test('status changes are owner/admin only and validated', async () => {
    const set = (s, status) => s.agent.post(`/candidatures/${appId}/statut`).type('form').send({ _csrf: s.csrf, status });
    expect((await set(other, 'rejected')).status).toBe(403);
    expect((await set(cand, 'shortlisted')).status).toBe(403);
    expect((await set(rec, 'opened_mail')).status).toBe(422);
    expect((await set(rec, 'shortlisted')).status).toBe(302);
    expect((await Application.findByPk(appId)).status).toBe('shortlisted');
    expect((await set(adm, 'rejected')).status).toBe(302);
    expect((await Application.findByPk(appId)).status).toBe('rejected');
  });
});

describe('My CV page', () => {
  test('upload, download via signed link, and remove', async () => {
    const u = await createUser({ email: 'cvpage@ex.com' });
    const s = await loginAs(u);
    const up = await s.agent.post(`/cv/importer?_csrf=${s.csrf}`).attach('cv', PDF, { filename: 'CV Awa.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(302);
    await u.reload();
    expect(u.cvName).toBe('CV Awa.pdf');
    const page = await s.agent.get('/cv');
    const href = page.text.match(/href="(\/cv\/telecharger\?[^"]+)"/)[1].replace(/&amp;/g, '&');
    expect((await request(app).get(href)).status).toBe(200);
    await s.agent.post('/cv/retirer').type('form').send({ _csrf: s.csrf });
    await u.reload();
    expect(u.cvUrl).toBeNull();
  });
});
