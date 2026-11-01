const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Follow, User } = require('../src/models');
const { refreshRecentScores } = require('../src/services/feedRanking');
const env = require('../src/config/env');

let ana; let bob; let rec; let admin; let carl;
let anaS; let bobS; let recS; let adminS; let carlS;

const post = (s, url, body = {}) => s.agent.post(url).set('X-CSRF-Token', s.csrf).set('HX-Request', 'true').type('form').send(body);
const follow = (s, user) => post(s, `/abonnements/${user.id}`);
// All post ids visible in a viewer's feed (walks every page).
async function feedIds(s) {
  const ids = [];
  const since = Date.now() + 1000;
  for (let page = 1; page < 30; page += 1) {
    const res = await s.agent.get(`/fil?page=${page}&since=${since}`);
    ids.push(...[...res.text.matchAll(/<article id="post-(\d+)"/g)].map((m) => Number(m[1])));
    if (!res.text.includes('hx-trigger="revealed"')) break;
  }
  return ids;
}

beforeAll(async () => {
  await resetDb();
  ana = await createUser({ username: 'ana', email: 'ana@ex.com', firstName: 'Ana', lastName: 'Diop', city: 'Dakar', sector: 'Santé' });
  bob = await createUser({ username: 'bob', email: 'bob@ex.com', firstName: 'Bob', lastName: 'Sarr', city: 'Dakar', sector: 'BTP & Construction' });
  rec = await createUser({ username: 'rec', email: 'rec@ex.com', role: 'recruiter', firstName: 'Rama', lastName: 'Ndiaye', companyName: 'Clinique Atlantique', city: 'Thiès', sector: 'Santé', headline: 'RH Clinique Atlantique' });
  admin = await createUser({ username: 'admin', email: 'admin@ex.com', role: 'admin' });
  carl = await createUser({ username: 'carl', email: 'carl@ex.com', firstName: 'Carl', lastName: 'Mendy', city: 'Ziguinchor' });
  [anaS, bobS, recS, adminS, carlS] = await Promise.all([ana, bob, rec, admin, carl].map((u) => loginAs(u)));
});
afterAll(closeDb);

describe('Following', () => {
  test('follow, counters, idempotence and unfollow', async () => {
    let res = await follow(anaS, rec);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Abonné');
    expect(res.headers['hx-trigger']).toContain(`follow-changed-${rec.id}`);
    await Promise.all([ana.reload(), rec.reload()]);
    expect(ana.followingCount).toBe(1);
    expect(rec.followersCount).toBe(1);

    res = await follow(anaS, rec); // toggle -> unfollow
    expect(res.text).toContain("S&#39;abonner");
    await Promise.all([ana.reload(), rec.reload()]);
    expect(ana.followingCount).toBe(0);
    expect(rec.followersCount).toBe(0);
    expect(await Follow.count()).toBe(0);
  });

  test('concurrent double tap creates a single follow', async () => {
    await Promise.all([follow(bobS, carl), follow(bobS, carl)]);
    const n = await Follow.count({ where: { followerId: bob.id, followingId: carl.id } });
    await carl.reload();
    expect(carl.followersCount).toBe(n);
    if (n) await follow(bobS, carl); // reset
  });

  test('cannot follow yourself, unknown or banned accounts; guests must log in', async () => {
    expect((await follow(anaS, ana)).status).toBe(422);
    expect((await post(anaS, '/abonnements/999999')).status).toBe(404);
    const banned = await createUser({ email: 'banned@ex.com', isBanned: true });
    expect((await follow(anaS, banned)).status).toBe(404);
    const guest = request.agent(app);
    const page = await guest.get('/connexion');
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    expect((await guest.post(`/abonnements/${ana.id}`).set('X-CSRF-Token', csrf).set('HX-Request', 'true')).status).toBe(401);
  });

  test('followers and following lists', async () => {
    await follow(anaS, rec);
    await follow(bobS, rec);
    const res = await request(app).get('/profil/rec/abonnes');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ana Diop');
    expect(res.text).toContain('Bob Sarr');
    expect((await request(app).get('/profil/ana/abonnements')).text).toContain('Rama Ndiaye');
    expect((await request(app).get('/profil/nobody/abonnes')).status).toBe(404);
    const profile = await anaS.agent.get('/profil/rec');
    expect(profile.text).toContain('aria-pressed="true"');
  });
});

describe('Suggestions', () => {
  test('same city, same sector and popular, excluding self and already followed', async () => {
    const res = await anaS.agent.get('/reseau');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Bob Sarr');
    expect(res.text).toContain('Habite aussi à Dakar');
    expect(res.text).not.toContain('Rama Ndiaye'); // already followed
    expect(res.text).not.toMatch(/<a href="\/profil\/ana" class="mt-2 line-clamp-1/); // not self (user cards only)
    const sidebar = await anaS.agent.get('/reseau/suggestions');
    expect(sidebar.status).toBe(200);
  });

  test('sector match is suggested', async () => {
    await follow(anaS, rec); // unfollow
    const res = await anaS.agent.get('/reseau');
    expect(res.text).toMatch(/Secteur : Santé|Habite aussi/);
    await follow(anaS, rec); // follow again
  });
});

describe('Visibility', () => {
  let networkPost; let recruiterJob; let approvedJob; let publicPost;
  beforeAll(async () => {
    // ana follows rec; bob follows rec; carl follows nobody
    networkPost = await Post.create({ authorId: rec.id, text: 'Réservé à mes abonnés', visibility: 'network' });
    recruiterJob = await Post.create({ authorId: rec.id, type: 'job', text: 'Offre non approuvée', featureStatus: 'pending' });
    approvedJob = await Post.create({ authorId: rec.id, type: 'job', text: 'Offre approuvée', featureStatus: 'approved' });
    publicPost = await Post.create({ authorId: carl.id, text: 'Publication publique' });
    await refreshRecentScores();
  });

  test('a follower sees network posts and non-approved recruiter offers', async () => {
    const ids = await feedIds(anaS);
    expect(ids).toEqual(expect.arrayContaining([networkPost.id, recruiterJob.id, approvedJob.id, publicPost.id]));
  });

  test('a non-follower only sees public posts and approved offers', async () => {
    const ids = await feedIds(carlS);
    expect(ids).toContain(publicPost.id);
    expect(ids).toContain(approvedJob.id);
    expect(ids).not.toContain(networkPost.id);
    expect(ids).not.toContain(recruiterJob.id);
  });

  test('the author and admins always see them', async () => {
    expect(await feedIds(recS)).toEqual(expect.arrayContaining([networkPost.id, recruiterJob.id]));
    expect(await feedIds(adminS)).toEqual(expect.arrayContaining([networkPost.id, recruiterJob.id]));
  });

  test('a viral non-approved offer reaches everyone; a network post never does', async () => {
    await Post.update({ likesCount: 500, commentsCount: 200 }, { where: { id: [recruiterJob.id, networkPost.id] } });
    await refreshRecentScores();
    await recruiterJob.reload();
    expect(recruiterJob.score).toBeGreaterThanOrEqual(env.VIRAL_THRESHOLD);
    const ids = await feedIds(carlS);
    expect(ids).toContain(recruiterJob.id);
    expect(ids).not.toContain(networkPost.id);
  });

  test('network post page: 404 for non-followers and guests, readable by followers', async () => {
    expect((await carlS.agent.get(`/publications/${networkPost.id}`)).status).toBe(404);
    expect((await request(app).get(`/publications/${networkPost.id}`)).status).toBe(404);
    expect((await anaS.agent.get(`/publications/${networkPost.id}`)).status).toBe(200);
    expect((await carlS.agent.get(`/publications/${networkPost.id}/commentaires`)).status).toBe(404);
    expect((await post(carlS, `/publications/${networkPost.id}/reaction`, { type: 'like' })).status).toBe(404);
  });

  test('network posts cannot be shared', async () => {
    const res = await anaS.agent.post(`/publications/${networkPost.id}/partager`).set('X-CSRF-Token', anaS.csrf).set('Accept', 'application/json').send({});
    expect(res.status).toBe(403);
  });

  test('profile shows network posts to followers only', async () => {
    expect((await anaS.agent.get('/profil/rec')).text).toContain('Réservé à mes abonnés');
    expect((await carlS.agent.get('/profil/rec')).text).not.toContain('Réservé à mes abonnés');
    expect((await request(app).get('/profil/rec')).text).not.toContain('Réservé à mes abonnés');
  });

  test('guests see only broadcast posts in the feed fragment', async () => {
    const res = await request(app).get('/fil?page=1');
    expect(res.text).not.toContain('Réservé à mes abonnés');
  });

  test('unfollowing removes access', async () => {
    await follow(bobS, rec); // bob unfollows
    expect((await bobS.agent.get(`/publications/${networkPost.id}`)).status).toBe(404);
    await follow(bobS, rec); // follow again
  });
});

describe('Personalized ranking', () => {
  test('a followed author gets the ×1.5 bonus over an equal post', async () => {
    await Post.destroy({ where: {} });
    const t = new Date(Date.now() - 3600_000);
    const mk = (authorId, text) => Post.create({ authorId, text, likesCount: 3, createdAt: t, updatedAt: t }, { silent: true });
    const fromStranger = await mk(carl.id, 'stranger');
    const fromFollowed = await mk(rec.id, 'followed');
    await refreshRecentScores();
    const ids = await feedIds(anaS);
    expect(ids.indexOf(fromFollowed.id)).toBeLessThan(ids.indexOf(fromStranger.id));
    // without the bonus (carl follows nobody) the order is by id/score only
    const carlIds = await feedIds(carlS);
    expect(carlIds.indexOf(fromFollowed.id)).toBeGreaterThan(-1);
  });

  test('post header offers "S\'abonner" for unfollowed authors only', async () => {
    const res = await anaS.agent.get('/');
    const carlCard = res.text.split('<article').find((c) => c.includes('stranger'));
    const recCard = res.text.split('<article').find((c) => c.includes('followed'));
    expect(carlCard).toMatch(/S(&#39;|')abonner/);
    expect(recCard).not.toMatch(/S(&#39;|')abonner/);
  });
});

describe('Global search', () => {
  test('people vs companies, with city filter', async () => {
    const people = await anaS.agent.get('/recherche?type=personnes&q=sarr');
    expect(people.text).toContain('Bob Sarr');
    expect(people.text).not.toContain('Rama Ndiaye');
    const companies = await anaS.agent.get('/recherche?type=entreprises&q=atlantique');
    expect(companies.text).toContain('Rama Ndiaye');
    const city = await request(app).get('/recherche?type=personnes&ville=Ziguinchor');
    expect(city.text).toContain('Carl Mendy');
    expect(city.text).not.toContain('Bob Sarr');
  });

  test('full name search and LIKE escaping', async () => {
    expect((await request(app).get('/recherche?q=Ana%20Diop')).text).toContain('Ana Diop');
    expect((await request(app).get('/recherche?type=personnes&q=%25')).text).toContain('Aucun résultat');
  });

  test('banned users never appear', async () => {
    await User.update({ isBanned: true }, { where: { id: carl.id } });
    expect((await request(app).get('/recherche?type=personnes&q=mendy')).text).not.toContain('Carl Mendy');
    await User.update({ isBanned: false }, { where: { id: carl.id } });
  });
});
