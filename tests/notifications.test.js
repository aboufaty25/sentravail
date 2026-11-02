const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Job, Notification, Application, Follow, Comment } = require('../src/models');
const { buildSlug } = require('../src/services/jobs');
const notifications = require('../src/services/notifications');
const { outbox } = require('../src/services/mail');
const { sessionMiddleware } = require('../src/config/session');
const { initSocket, closeSocket } = require('../src/config/socket');

let ana; let bob; let carl; let rec; let admin;
let anaS; let bobS; let carlS; let recS; let adminS;

const hx = (s, url, body = {}) => s.agent.post(url).set('X-CSRF-Token', s.csrf).set('HX-Request', 'true').type('form').send(body);
const notifs = (userId, where = {}) => Notification.findAll({ where: { userId, ...where }, order: [['id', 'ASC']] });

beforeAll(async () => {
  await resetDb();
  ana = await createUser({ username: 'ana', email: 'ana@ex.com', firstName: 'Ana', lastName: 'Diop' });
  bob = await createUser({ username: 'bob', email: 'bob@ex.com', firstName: 'Bob', lastName: 'Sarr' });
  carl = await createUser({ username: 'carl', email: 'carl@ex.com', firstName: 'Carl', lastName: 'Mendy' });
  rec = await createUser({ username: 'rec', email: 'rec@ex.com', role: 'recruiter', firstName: 'Rama', lastName: 'Ndiaye' });
  admin = await createUser({ username: 'admin', email: 'admin@ex.com', role: 'admin' });
  [anaS, bobS, carlS, recS, adminS] = await Promise.all([ana, bob, carl, rec, admin].map((u) => loginAs(u)));
});
afterEach(() => notifications.flush());
afterAll(async () => {
  await closeSocket();
  await closeDb();
});

describe('Social notifications', () => {
  let post;
  beforeAll(async () => { post = await Post.create({ type: 'advice', title: 'Ma nouvelle certification', authorId: ana.id, text: 'Ma nouvelle certification' }); });

  test('reactions notify the author once and group several people', async () => {
    await hx(bobS, `/publications/${post.id}/reaction`, { type: 'like' });
    await hx(bobS, `/publications/${post.id}/reaction`, { type: 'love' }); // change: no new notification
    let list = await notifs(ana.id, { type: 'like' });
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(1);
    await hx(carlS, `/publications/${post.id}/reaction`, { type: 'like' });
    list = await notifs(ana.id, { type: 'like' });
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(2);
    const full = await Notification.findByPk(list[0].id, { include: ['actor'] });
    expect(notifications.describe(full)).toBe('Carl Mendy et 1 autre personne ont réagi à votre publication « Ma nouvelle certification »');
    expect(notifications.linkFor(full)).toBe(`/publications/${post.id}`);
  });

  test('no notification for your own actions', async () => {
    await hx(anaS, `/publications/${post.id}/reaction`, { type: 'like' });
    await hx(anaS, `/publications/${post.id}/commentaires`, { text: 'Merci à tous' });
    expect(await Notification.count({ where: { userId: ana.id, actorId: ana.id } })).toBe(0);
  });

  test('comments notify the author; replies notify the parent comment author', async () => {
    await hx(bobS, `/publications/${post.id}/commentaires`, { text: 'Bravo !' });
    const parent = await Comment.findOne({ where: { authorId: bob.id, postId: post.id } });
    await hx(carlS, `/publications/${post.id}/commentaires`, { text: 'Bien dit Bob', parentCommentId: String(parent.id) });
    expect(await notifs(ana.id, { type: 'comment' })).toHaveLength(1);
    const replies = await notifs(bob.id, { type: 'reply' });
    expect(replies).toHaveLength(1);
    expect(replies[0].data.snippet).toBe('Bien dit Bob');
  });

  test('follow and share notify', async () => {
    await hx(bobS, `/abonnements/${ana.id}`);
    expect(await notifs(ana.id, { type: 'follow' })).toHaveLength(1);
    await carlS.agent.post(`/publications/${post.id}/partager`).set('X-CSRF-Token', carlS.csrf).send({});
    expect(await notifs(ana.id, { type: 'share' })).toHaveLength(1);
  });

  test('banned recipients get nothing', async () => {
    const banned = await createUser({ email: 'banned@ex.com', isBanned: true });
    const n = await notifications.notify({ userId: banned.id, actorId: bob.id, type: 'follow' });
    expect(n).toBeNull();
  });
});

describe('Notifications page', () => {
  test('badge count, opening the tab clears the badge but keeps items unread', async () => {
    const home = await anaS.agent.get('/');
    const badge = home.text.match(/data-notif-badge[^>]*>(\d+)</);
    expect(Number(badge[1])).toBeGreaterThanOrEqual(4);
    const page = await anaS.agent.get('/notifications');
    expect(page.text).toContain('ont réagi à votre publication');
    expect(page.text).toContain('ont commenté votre publication'); // Bob's comment + Carl's reply, grouped
    expect(page.text).toContain("s&#39;est abonné(e) à vous");
    expect(await Notification.count({ where: { userId: ana.id, seen: false } })).toBe(0);
    expect(await Notification.count({ where: { userId: ana.id, read: false } })).toBeGreaterThan(0);
    const after = await anaS.agent.get('/');
    expect(after.text).toMatch(/data-notif-badge class="[^"]*hidden/);
  });

  test('opening a notification marks it read and redirects to its target; others cannot open it', async () => {
    const n = (await notifs(ana.id, { type: 'follow' }))[0];
    expect((await bobS.agent.get(`/notifications/${n.id}`)).headers.location).toBe('/notifications');
    const res = await anaS.agent.get(`/notifications/${n.id}`);
    expect(res.headers.location).toBe('/profil/bob');
    await n.reload();
    expect(n.read).toBe(true);
  });

  test('mark all as read', async () => {
    await anaS.agent.post('/notifications/tout-lire').type('form').send({ _csrf: anaS.csrf });
    expect(await Notification.count({ where: { userId: ana.id, read: false } })).toBe(0);
  });

  test('requires login', async () => {
    expect((await request(app).get('/notifications')).status).toBe(302);
  });
});

describe('Jobs and applications', () => {
  let post; let job;
  beforeAll(async () => {
    await Follow.create({ followerId: carl.id, followingId: rec.id });
    let req = recS.agent.post(`/offres/nouvelle?_csrf=${recS.csrf}`);
    const data = { title: 'Comptable', companyName: 'Ndiaye SA', location: 'Dakar', contractType: 'CDI', sector: 'Comptabilité', description: 'Tenue de la comptabilité générale et des déclarations fiscales.', applyEmail: 'jobs@ndiaye.sn', requestFeatured: 'on' };
    for (const [k, v] of Object.entries(data)) req = req.field(k, v);
    await req;
    job = await Job.findOne({ where: { title: 'Comptable' } });
    post = await Post.findByPk(job.postId);
  });

  test('a new offer notifies the recruiter followers', async () => {
    const list = await notifs(carl.id, { type: 'new_job_from_followed' });
    expect(list).toHaveLength(1);
    expect(list[0].data.url).toBe(`/offres/${job.slug}`);
    expect(await notifs(ana.id, { type: 'new_job_from_followed' })).toHaveLength(0);
  });

  test('a confirmed application notifies the recruiter (in-app); unconfirmed does not', async () => {
    let req = anaS.agent.post(`/offres/${job.slug}/postuler`).set('X-CSRF-Token', anaS.csrf).set('Accept', 'application/json');
    for (const [k, v] of Object.entries({ firstName: 'Ana', lastName: 'Diop', email: 'ana@ex.com', phone: '770000001' })) req = req.field(k, v);
    const res = await req.attach('cv', Buffer.from('%PDF-1.4 test cv'), { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(await notifs(rec.id, { type: 'application' })).toHaveLength(0);
    await anaS.agent.post(`/candidatures/${res.body.id}/confirmer`).set('X-CSRF-Token', anaS.csrf).set('Accept', 'application/json');
    const list = await notifs(rec.id, { type: 'application' });
    expect(list).toHaveLength(1);
    expect(list[0].applicationId).toBe(res.body.id);
  });

  test('status decisions notify the candidate in-app and by email', async () => {
    const appRow = await Application.findOne({ where: { candidateId: ana.id } });
    const before = outbox.length;
    await recS.agent.post(`/candidatures/${appRow.id}/statut`).type('form').send({ _csrf: recS.csrf, status: 'shortlisted' });
    await notifications.flush();
    const list = await notifs(ana.id, { type: 'application_status' });
    expect(list[list.length - 1].data.statusLabel).toBe('Présélectionné(e)');
    const mail = outbox.slice(before).find((m) => m.to === 'ana@ex.com');
    expect(mail.subject).toContain('Bonne nouvelle');
    expect(mail.html).toContain('href="http://localhost:3000/mes-candidatures"');
  });

  test('guest candidates are emailed about decisions', async () => {
    const guestApp = await Application.create({ jobPostId: post.id, jobTitle: 'Comptable', companyName: 'Ndiaye SA', recruiterId: rec.id, firstName: 'Invité', lastName: 'Ba', email: 'guest@ex.com', phone: '+221770000009', cvKey: '2026/01/aaaaaaaaaaaaaaaaaaaaaaaa.pdf', status: 'confirmed_sent' });
    const before = outbox.length;
    await recS.agent.post(`/candidatures/${guestApp.id}/statut`).type('form').send({ _csrf: recS.csrf, status: 'rejected' });
    await notifications.flush();
    expect(outbox.slice(before).some((m) => m.to === 'guest@ex.com' && m.subject.includes('Votre candidature'))).toBe(true);
  });

  test('users can turn emails off (in-app stays)', async () => {
    await anaS.agent.post('/parametres/notifications').type('form').send({ _csrf: anaS.csrf });
    await ana.reload();
    expect(ana.emailNotifications).toBe(false);
    const appRow = await Application.findOne({ where: { candidateId: ana.id } });
    const before = outbox.length;
    await recS.agent.post(`/candidatures/${appRow.id}/statut`).type('form').send({ _csrf: recS.csrf, status: 'rejected' });
    await notifications.flush();
    expect(outbox.slice(before).filter((m) => m.to === 'ana@ex.com')).toHaveLength(0);
    expect((await notifs(ana.id, { type: 'application_status' })).length).toBeGreaterThanOrEqual(2);
  });

  test('featuring approval and rejection notify the recruiter with an email', async () => {
    let before = outbox.length;
    await adminS.agent.post(`/admin/offres/${post.id}/approuver`).type('form').send({ _csrf: adminS.csrf, days: 5 });
    await notifications.flush();
    expect(await notifs(rec.id, { type: 'job_approved' })).toHaveLength(1);
    expect(outbox.slice(before).some((m) => m.to === 'rec@ex.com' && m.subject.includes('est à la une'))).toBe(true);

    before = outbox.length;
    await adminS.agent.post(`/admin/offres/${post.id}/refuser`).type('form').send({ _csrf: adminS.csrf, reason: 'Doublon' });
    await notifications.flush();
    const rejected = await notifs(rec.id, { type: 'job_rejected' });
    expect(rejected[0].data.reason).toBe('Doublon');
    expect(outbox.slice(before).some((m) => m.to === 'rec@ex.com' && m.text.includes('Motif : Doublon'))).toBe(true);
  });

  test('email content is escaped', async () => {
    await notifications.sendEmail({ to: 'x@ex.com', subject: 's', title: '<b>t</b>', lines: ['<script>alert(1)</script>'] });
    const mail = outbox[outbox.length - 1];
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('Real time (Socket.io)', () => {
  let server; let port;
  beforeAll(async () => {
    server = http.createServer(app);
    initSocket(server, sessionMiddleware());
    await new Promise((r) => server.listen(0, r));
    port = server.address().port;
  });
  afterAll(async () => {
    await closeSocket();
    await new Promise((r) => server.close(r));
  });

  async function sessionCookie(email) {
    const page = await request(app).get('/connexion');
    const cookie = page.headers['set-cookie'][0].split(';')[0];
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const res = await request(app).post('/connexion').set('Cookie', cookie).type('form').send({ _csrf: csrf, identifier: email, password: 'password123' });
    return res.headers['set-cookie'][0].split(';')[0];
  }

  test('a logged-in user receives notifications pushed to their room', async () => {
    const cookie = await sessionCookie('bob@ex.com');
    const socket = ioClient(`http://localhost:${port}`, { extraHeaders: { Cookie: cookie }, transports: ['polling'], reconnection: false });
    await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
    const received = new Promise((resolve) => socket.on('notification', resolve));
    await notifications.notify({ userId: bob.id, actorId: carl.id, type: 'follow' });
    const payload = await received;
    expect(payload.text).toBe("Carl Mendy s'est abonné(e) à vous");
    expect(payload.url).toBe('/profil/carl');
    expect(payload.unseen).toBeGreaterThan(0);
    socket.close();
  });

  test('anonymous sockets are disconnected', async () => {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['polling'], reconnection: false });
    const disconnected = await new Promise((resolve) => {
      socket.on('disconnect', () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });
    expect(disconnected).toBe(true);
    socket.close();
  });
});
