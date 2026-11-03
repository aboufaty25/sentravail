// ATS: recruitment managed directly on SenTravail (applyMode = 'platform').
const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job, Application, Notification } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');
const notifications = require('../src/services/notifications');
const { outbox } = require('../src/services/mail');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let recruiter; let candidate; let rec; let other; let cand; let job;

async function guest() {
  const agent = request.agent(app);
  const page = await agent.get('/connexion');
  return { agent, csrf: page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1] };
}
const form = { firstName: 'Awa', lastName: 'Ndiaye', email: 'awa@example.com', phone: '77 111 22 33', message: 'Motivée.' };
function apply(s, fields = form) {
  let req = s.agent.post(`/offres/${job.slug}/postuler`).set('X-CSRF-Token', s.csrf).set('Accept', 'application/json');
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('cv', PDF, { filename: 'cv.pdf', contentType: 'application/pdf' });
}
const move = (s, id, body) => s.agent.post(`/candidatures/${id}/statut`).type('form').send({ _csrf: s.csrf, ...body });

beforeAll(async () => {
  await resetDb();
  recruiter = await createUser({ email: 'rec@ex.com', role: 'recruiter', companyName: 'Ba SA' });
  candidate = await createUser({ email: 'cand@ex.com', firstName: 'Fatou', lastName: 'Sow', phone: '+221770000009' });
  const otherRec = await createUser({ email: 'rec2@ex.com', role: 'recruiter' });
  [rec, other, cand] = await Promise.all([loginAs(recruiter), loginAs(otherRec), loginAs(candidate)]);
  const post = await Post.create({ type: 'job', authorId: recruiter.id });
  job = await Job.create({
    postId: post.id, slug: buildSlug('Assistant RH', 'Dakar'), title: 'Assistant RH', companyName: 'Ba SA', location: 'Dakar',
    contractType: 'CDI', sector: 'Comptabilité', description: 'x'.repeat(40), applyMode: 'platform', deadline: inDays(10),
  });
});
afterEach(() => notifications.flush());
afterAll(closeDb);

test('recruiter form offers "Sur SenTravail" and selects it by default', async () => {
  const page = await rec.agent.get('/offres/nouvelle');
  expect(page.text).toContain('value="platform"');
  expect(page.text).toContain("mode: 'platform'");
  const res = await rec.agent.post(`/offres/nouvelle?_csrf=${rec.csrf}`)
    .field('title', 'Comptable').field('companyName', 'Ba SA').field('location', 'Dakar').field('contractType', 'CDI')
    .field('sector', 'Comptabilité').field('description', 'y'.repeat(40)).field('applyMode', 'platform');
  expect(res.status).toBe(302);
  const created = await Job.findOne({ order: [['id', 'DESC']] });
  expect(created.applyMode).toBe('platform');
  expect(created.applyEmail).toBeNull();
});

test('applying on the platform: received at once, no mailto, recruiter notified in-app and by email', async () => {
  const before = outbox.length;
  const g = await guest();
  const res = await apply(g);
  expect(res.status).toBe(201);
  expect(res.body.sent).toBe(true);
  expect(res.body.mailto).toBeUndefined();
  const a = await Application.findByPk(res.body.id);
  expect(a.status).toBe('confirmed_sent');
  expect(a.sentVia).toBe('platform');
  await notifications.flush();
  expect(await Notification.count({ where: { userId: recruiter.id, type: 'application' } })).toBe(1);
  expect(outbox.slice(before).some((m) => m.to === 'rec@ex.com' && m.subject === 'Nouvelle candidature : Assistant RH')).toBe(true);
  // Same person cannot apply twice.
  expect((await apply(g)).status).toBe(409);
});

test('recruiter board: stages, moving a candidate, interview scheduling and private notes', async () => {
  const res = await apply(cand, { ...form, firstName: 'Fatou', lastName: 'Sow', email: 'cand@ex.com' });
  const id = res.body.id;
  const board = await rec.agent.get(`/mes-offres/${job.slug}/candidatures`);
  expect(board.status).toBe(200);
  expect(board.text).toContain('Présélection');
  expect(board.text).toContain('Entretien');
  expect(board.text).toContain(`href="/candidatures/${id}"`);
  // Only the owner (or admin) can move it.
  expect((await move(other, id, { status: 'shortlisted' })).status).toBe(403);
  expect((await move(cand, id, { status: 'hired' })).status).toBe(403);
  expect((await move(rec, id, { status: 'confirmed_sent' })).status).toBe(422);
  // Move from the board: back to the board.
  const moved = await move(rec, id, { status: 'shortlisted', retour: `/mes-offres/${job.slug}/candidatures` });
  expect(moved.status).toBe(302);
  expect(moved.headers.location).toBe(`/mes-offres/${job.slug}/candidatures`);
  expect((await move(rec, id, { status: 'shortlisted', retour: 'https://evil.example' })).headers.location).toBe(`/candidatures/${id}`);
  // Interview with date and place: candidate gets the details by email.
  const before = outbox.length;
  expect((await move(rec, id, { status: 'interview', interviewAt: '2026-12-03T10:30', interviewPlace: 'Immeuble Ba, Plateau, Dakar' })).status).toBe(302);
  let a = await Application.findByPk(id);
  expect(a.status).toBe('interview');
  expect(new Date(a.interviewAt).toISOString()).toBe('2026-12-03T10:30:00.000Z');
  await notifications.flush();
  const mail = outbox.slice(before).find((m) => m.to === 'cand@ex.com');
  expect(mail.subject).toBe('Entretien pour le poste « Assistant RH »');
  expect(mail.text).toContain('10:30');
  expect(mail.text).toContain('Immeuble Ba, Plateau, Dakar');
  // Private note: saved, never shown to the candidate.
  await rec.agent.post(`/candidatures/${id}/note`).type('form').send({ _csrf: rec.csrf, note: 'Très bon profil, dispo en janvier' });
  a = await a.reload();
  expect(a.recruiterNote).toBe('Très bon profil, dispo en janvier');
  expect((await other.agent.post(`/candidatures/${id}/note`).type('form').send({ _csrf: other.csrf, note: 'x' })).status).toBe(403);
  // Candidate dashboard: stepper, interview details, no private note.
  const mine = await cand.agent.get('/mes-candidatures');
  expect(mine.text).toContain('Avancement de la candidature');
  expect(mine.text).toContain('Immeuble Ba, Plateau, Dakar');
  expect(mine.text).toContain('aria-current=step');
  expect(mine.text).not.toContain('Très bon profil');
  // Offer then hired.
  await move(rec, id, { status: 'offer' });
  await move(rec, id, { status: 'hired' });
  expect((await Application.findByPk(id)).status).toBe('hired');
  const done = await cand.agent.get('/mes-candidatures');
  expect(done.text).toContain('Partager la bonne nouvelle');
  // Recruiter dashboard summary.
  const dash = await rec.agent.get('/mes-offres');
  expect(dash.text).toContain('Tableau de recrutement');
  expect(dash.text).toContain('1 embauche');
});

describe('Admin view of recruitment', () => {
  let adm;
  beforeAll(async () => { adm = await loginAs(await createUser({ email: 'admin-ats@ex.com', role: 'admin' })); });

  test('dashboard shows platform-wide recruitment figures', async () => {
    const page = await adm.agent.get('/admin');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Recrutement sur la plateforme');
    expect(page.text).toContain('Assistant RH'); // most applied-to offer
    expect(page.text).toMatch(/Via SenTravail<\/p><p class="text-2xl font-bold">[1-9]/);
  });

  test('all applications, admin only, with stage, mode and text filters', async () => {
    expect((await cand.agent.get('/admin/candidatures')).status).toBe(403);
    expect((await rec.agent.get('/admin/candidatures')).status).toBe(403);
    const all = await adm.agent.get('/admin/candidatures');
    expect(all.status).toBe(200);
    expect(all.text).toContain('Fatou Sow');
    expect(all.text).toContain('Awa Ndiaye');
    const hired = await adm.agent.get('/admin/candidatures?statut=hired');
    expect(hired.text).toContain('Fatou Sow');
    expect(hired.text).not.toContain('Awa Ndiaye');
    expect((await adm.agent.get('/admin/candidatures?q=ndiaye')).text).not.toContain('Fatou Sow');
    expect((await adm.agent.get('/admin/candidatures?mode=email')).text).toContain('Aucune candidature ne correspond');
    // The admin can open any application and any board.
    const a = await Application.findOne({ where: { email: 'cand@ex.com' } });
    expect((await adm.agent.get(`/candidatures/${a.id}`)).status).toBe(200);
    expect((await adm.agent.get(`/mes-offres/${job.slug}/candidatures`)).status).toBe(200);
  });

  test('recruiters reach their board from the menu', async () => {
    expect((await rec.agent.get('/menu')).text).toContain('Tableau de recrutement');
  });
});
