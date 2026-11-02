const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Reaction, Comment, Save, CommentLike } = require('../src/models');
const { refreshRecentScores } = require('../src/services/feedRanking');

// Minimal valid PNG (1×1).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

let alice; let bob; let admin;
let aliceSession; let bobSession; let adminSession;

beforeAll(async () => {
  await resetDb();
  alice = await createUser({ username: 'alice', email: 'alice@ex.com', firstName: 'Alice' });
  bob = await createUser({ username: 'bob', email: 'bob@ex.com', firstName: 'Bob' });
  admin = await createUser({ username: 'admin', email: 'admin@ex.com', role: 'admin' });
  aliceSession = await loginAs(alice);
  bobSession = await loginAs(bob);
  adminSession = await loginAs(admin);
});
afterAll(closeDb);

const post = (s, path, body = {}) => s.agent.post(path).set('X-CSRF-Token', s.csrf).set('HX-Request', 'true').type('form').send(body);

describe('Creating posts', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/publier').send({ text: 'x' });
    expect(res.status).toBe(403); // no CSRF session at all
    const guest = request.agent(app);
    expect((await guest.get('/publier')).status).toBe(302);
  });

  test('creates a text post and redirects to the feed with it pinned', async () => {
    const res = await aliceSession.agent.post('/publier').set('X-CSRF-Token', aliceSession.csrf).set('Accept', 'application/json')
      .field('text', 'Bonjour SenTravail').field('visibility', 'public');
    expect(res.status).toBe(201);
    expect(res.body.redirect).toBe(`/?nouveau=${res.body.id}`);
    const p = await Post.findByPk(res.body.id);
    expect(p.type).toBe('text');
    expect(p.authorId).toBe(alice.id);
    expect(p.score).toBeCloseTo(1 / 2 ** 1.5, 2);

    const home = await aliceSession.agent.get(res.body.redirect);
    expect(home.text.indexOf(`id="post-${p.id}"`)).toBeGreaterThan(-1);
  });

  test('rejects an empty post', async () => {
    const res = await aliceSession.agent.post('/publier').set('X-CSRF-Token', aliceSession.csrf).set('Accept', 'application/json').field('text', '   ');
    expect(res.status).toBe(422);
    expect(res.body.errors.text).toMatch(/Écrivez quelque chose/);
  });

  test('rejects a too long post', async () => {
    const res = await aliceSession.agent.post('/publier').set('X-CSRF-Token', aliceSession.csrf).set('Accept', 'application/json').field('text', 'a'.repeat(5001));
    expect(res.status).toBe(422);
  });

  test('uploads photos (validated by content, not by name)', async () => {
    const res = await aliceSession.agent.post('/publier').set('X-CSRF-Token', aliceSession.csrf).set('Accept', 'application/json')
      .field('text', 'Avec photo').attach('photos', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    const p = await Post.findByPk(res.body.id);
    expect(p.type).toBe('photo');
    expect(p.mediaUrls).toHaveLength(1);
    expect(p.mediaUrls[0]).toMatch(/^\/uploads\/posts\/\d{4}\/\d{2}\/[a-f0-9]{24}\.png$/);
    const img = await request(app).get(p.mediaUrls[0]);
    expect(img.status).toBe(200);
  });

  test('rejects a fake image (wrong magic bytes)', async () => {
    const res = await aliceSession.agent.post('/publier').set('X-CSRF-Token', aliceSession.csrf).set('Accept', 'application/json')
      .attach('photos', Buffer.from('<?php echo "hack"; ?>          '), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(422);
  });

  test('rejects non-image types, more than one image and images over 2 MB', async () => {
    const pdf = await aliceSession.agent.post('/publier').set('X-CSRF-Token', aliceSession.csrf).set('Accept', 'application/json')
      .attach('photos', Buffer.from('%PDF-1.4'), { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(422);
    let req = aliceSession.agent.post('/publier').set('X-CSRF-Token', aliceSession.csrf).set('Accept', 'application/json');
    for (let i = 0; i < 2; i++) req = req.attach('photos', PNG, { filename: `${i}.png`, contentType: 'image/png' });
    const many = await req;
    expect(many.status).toBe(422);
    expect(many.body.error).toMatch(/Une seule image/);
    const big = await aliceSession.agent.post('/publier').set('X-CSRF-Token', aliceSession.csrf).set('Accept', 'application/json')
      .attach('photos', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), { filename: 'big.png', contentType: 'image/png' });
    expect(big.status).toBe(422);
    expect(big.body.error).toMatch(/2 Mo/);
  });

  test('requires CSRF on multipart', async () => {
    const res = await aliceSession.agent.post('/publier').set('Accept', 'application/json').field('text', 'no token');
    expect(res.status).toBe(403);
  });
});

describe('Deleting posts', () => {
  test('only the author or an admin can delete', async () => {
    const p1 = await Post.create({ authorId: alice.id, text: 'à supprimer' });
    expect((await post(bobSession, `/publications/${p1.id}/supprimer`)).status).toBe(403);
    expect(await Post.findByPk(p1.id)).not.toBeNull();
    expect((await post(aliceSession, `/publications/${p1.id}/supprimer`)).status).toBe(200);
    expect(await Post.findByPk(p1.id)).toBeNull();

    const p2 = await Post.create({ authorId: bob.id, text: 'modération' });
    expect((await post(adminSession, `/publications/${p2.id}/supprimer`)).status).toBe(200);
    expect(await Post.findByPk(p2.id)).toBeNull();
  });

  test('deleting a post removes its reactions, comments and saves', async () => {
    const p = await Post.create({ authorId: alice.id, text: 'cascade' });
    await post(bobSession, `/publications/${p.id}/reaction`, { type: 'like' });
    await post(bobSession, `/publications/${p.id}/commentaires`, { text: 'hello' });
    await post(bobSession, `/publications/${p.id}/enregistrer`);
    await post(aliceSession, `/publications/${p.id}/supprimer`);
    expect(await Reaction.count({ where: { postId: p.id } })).toBe(0);
    expect(await Comment.count({ where: { postId: p.id } })).toBe(0);
    expect(await Save.count({ where: { postId: p.id } })).toBe(0);
  });
});

describe('Reactions', () => {
  let p;
  beforeAll(async () => { p = await Post.create({ authorId: alice.id, text: 'réagissez' }); });

  test('like, change reaction type, then remove — one reaction per user', async () => {
    let res = await post(bobSession, `/publications/${p.id}/reaction`, { type: 'like' });
    expect(res.status).toBe(200);
    expect(res.text).toContain(`id="social-${p.id}"`);
    await p.reload();
    expect(p.likesCount).toBe(1);

    res = await post(bobSession, `/publications/${p.id}/reaction`, { type: 'bravo' });
    expect(res.text).toContain('Bravo');
    await p.reload();
    expect(p.likesCount).toBe(1);
    expect(await Reaction.count({ where: { postId: p.id } })).toBe(1);
    expect((await Reaction.findOne({ where: { postId: p.id } })).type).toBe('bravo');

    await post(bobSession, `/publications/${p.id}/reaction`, { type: 'bravo' });
    await p.reload();
    expect(p.likesCount).toBe(0);
    expect(await Reaction.count({ where: { postId: p.id } })).toBe(0);
  });

  test('unknown reaction type falls back to like', async () => {
    await post(aliceSession, `/publications/${p.id}/reaction`, { type: 'hack' });
    expect((await Reaction.findOne({ where: { postId: p.id, userId: alice.id } })).type).toBe('like');
  });

  test('concurrent double tap does not double count', async () => {
    const q = await Post.create({ authorId: alice.id, text: 'double tap' });
    await Promise.all([post(bobSession, `/publications/${q.id}/reaction`, { type: 'like' }), post(bobSession, `/publications/${q.id}/reaction`, { type: 'like' })]);
    await q.reload();
    const n = await Reaction.count({ where: { postId: q.id } });
    expect(q.likesCount).toBe(n);
    expect(n).toBeLessThanOrEqual(1);
  });

  test('interactions raise the score', async () => {
    const q = await Post.create({ authorId: alice.id, text: 'score' });
    await refreshRecentScores();
    await q.reload();
    const before = q.score;
    await post(bobSession, `/publications/${q.id}/reaction`, { type: 'like' });
    await post(bobSession, `/publications/${q.id}/commentaires`, { text: 'top' });
    await q.reload();
    expect(q.score).toBeGreaterThan(before);
  });

  test('guests cannot react', async () => {
    const guest = request.agent(app);
    const page = await guest.get('/connexion');
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const res = await guest.post(`/publications/${p.id}/reaction`).set('X-CSRF-Token', csrf).set('HX-Request', 'true');
    expect(res.status).toBe(401);
  });

  test('reacting to a missing post is a 404', async () => {
    expect((await post(bobSession, '/publications/999999/reaction', { type: 'like' })).status).toBe(404);
  });
});

describe('Comments and replies', () => {
  let p;
  beforeAll(async () => { p = await Post.create({ authorId: alice.id, text: 'commentez' }); });

  test('comment, reply, reply-to-reply flattened to one level', async () => {
    let res = await post(bobSession, `/publications/${p.id}/commentaires`, { text: 'Premier !' });
    expect(res.status).toBe(200);
    expect(res.text).toContain(`hx-swap-oob="beforeend:#comment-list-${p.id}"`);
    const c1 = await Comment.findOne({ where: { postId: p.id, text: 'Premier !' } });

    res = await post(aliceSession, `/publications/${p.id}/commentaires`, { text: 'Merci', parentCommentId: String(c1.id) });
    expect(res.text).toContain(`beforeend:#replies-${c1.id}`);
    const r1 = await Comment.findOne({ where: { text: 'Merci' } });
    expect(r1.parentCommentId).toBe(c1.id);

    await post(bobSession, `/publications/${p.id}/commentaires`, { text: 'Re-réponse', parentCommentId: String(r1.id) });
    const r2 = await Comment.findOne({ where: { text: 'Re-réponse' } });
    expect(r2.parentCommentId).toBe(c1.id);

    await p.reload();
    expect(p.commentsCount).toBe(3);

    const list = await request(app).get(`/publications/${p.id}/commentaires`);
    expect(list.status).toBe(200);
    expect(list.text).toContain('Premier !');
    expect(list.text).toContain(`id="replies-${c1.id}"`);
  });

  test('cannot reply to a comment of another post', async () => {
    const other = await Post.create({ authorId: bob.id, text: 'autre' });
    const c = await Comment.create({ postId: other.id, authorId: bob.id, text: 'ailleurs' });
    const res = await post(bobSession, `/publications/${p.id}/commentaires`, { text: 'x', parentCommentId: String(c.id) });
    expect(res.status).toBe(404);
  });

  test('empty comment is refused with a toast', async () => {
    const res = await post(bobSession, `/publications/${p.id}/commentaires`, { text: '  ' });
    expect(res.status).toBe(422);
    expect(res.headers['hx-trigger']).toContain('toast');
  });

  test('comment text is escaped', async () => {
    await post(bobSession, `/publications/${p.id}/commentaires`, { text: '<img src=x onerror=alert(1)>' });
    const list = await request(app).get(`/publications/${p.id}/commentaires`);
    expect(list.text).not.toContain('<img src=x');
    expect(list.text).toContain('&lt;img src=x');
  });

  test('delete rights: comment author, post author, admin — not others', async () => {
    const carol = await createUser({ email: 'carol@ex.com' });
    const carolSession = await loginAs(carol);
    const c = await Comment.create({ postId: p.id, authorId: bob.id, text: 'à modérer' });
    await Post.increment('commentsCount', { where: { id: p.id } });

    expect((await post(carolSession, `/commentaires/${c.id}/supprimer`)).status).toBe(403);
    expect((await post(aliceSession, `/commentaires/${c.id}/supprimer`)).status).toBe(200); // post author
    expect(await Comment.findByPk(c.id)).toBeNull();

    const c2 = await Comment.create({ postId: p.id, authorId: bob.id, text: 'admin' });
    expect((await post(adminSession, `/commentaires/${c2.id}/supprimer`)).status).toBe(200);
  });

  test('deleting a comment also removes its replies from the count', async () => {
    const q = await Post.create({ authorId: alice.id, text: 'compteur' });
    await post(bobSession, `/publications/${q.id}/commentaires`, { text: 'parent' });
    const parent = await Comment.findOne({ where: { postId: q.id } });
    await post(aliceSession, `/publications/${q.id}/commentaires`, { text: 'r1', parentCommentId: String(parent.id) });
    await post(aliceSession, `/publications/${q.id}/commentaires`, { text: 'r2', parentCommentId: String(parent.id) });
    await q.reload();
    expect(q.commentsCount).toBe(3);
    await post(bobSession, `/commentaires/${parent.id}/supprimer`);
    await q.reload();
    expect(q.commentsCount).toBe(0);
    expect(await Comment.count({ where: { postId: q.id } })).toBe(0);
  });

  test('comment likes toggle', async () => {
    const c = await Comment.create({ postId: p.id, authorId: alice.id, text: 'like me' });
    let res = await post(bobSession, `/commentaires/${c.id}/jaime`);
    expect(res.text).toContain('aria-pressed="true"');
    await c.reload();
    expect(c.likesCount).toBe(1);
    res = await post(bobSession, `/commentaires/${c.id}/jaime`);
    await c.reload();
    expect(c.likesCount).toBe(0);
    expect(await CommentLike.count({ where: { commentId: c.id } })).toBe(0);
  });
});

describe('Saves and shares', () => {
  test('save toggles and appears in Enregistrements', async () => {
    const p = await Post.create({ authorId: alice.id, text: 'à garder' });
    await post(bobSession, `/publications/${p.id}/enregistrer`);
    await p.reload();
    expect(p.savesCount).toBe(1);
    const page = await bobSession.agent.get('/enregistrements');
    expect(page.text).toContain('à garder');
    await post(bobSession, `/publications/${p.id}/enregistrer`);
    await p.reload();
    expect(p.savesCount).toBe(0);
  });

  test('share creates a post and counts on the original; sharing a share targets the original', async () => {
    const original = await Post.create({ authorId: alice.id, text: 'original' });
    const res = await bobSession.agent.post(`/publications/${original.id}/partager`).set('X-CSRF-Token', bobSession.csrf).send({ text: 'à lire' });
    expect(res.status).toBe(201);
    const share = await Post.findByPk(res.body.id);
    expect(share.sharedPostId).toBe(original.id);
    expect(share.authorId).toBe(bob.id);

    const res2 = await adminSession.agent.post(`/publications/${share.id}/partager`).set('X-CSRF-Token', adminSession.csrf).send({});
    expect((await Post.findByPk(res2.body.id)).sharedPostId).toBe(original.id);
    await original.reload();
    expect(original.sharesCount).toBe(2);

    // deleting a share decrements the original; deleting the original keeps shares
    await post(bobSession, `/publications/${share.id}/supprimer`);
    await original.reload();
    expect(original.sharesCount).toBe(1);
    await post(aliceSession, `/publications/${original.id}/supprimer`);
    const remaining = await Post.findByPk(res2.body.id);
    expect(remaining).not.toBeNull();
    const page = await adminSession.agent.get(`/publications/${remaining.id}`);
    expect(page.text).toContain("n'est plus disponible");
  });
});

describe('Feed', () => {
  beforeAll(async () => {
    await Post.destroy({ where: {} });
    const mk = (text, h, likes = 0) =>
      Post.create({ authorId: alice.id, text, likesCount: likes, createdAt: new Date(Date.now() - h * 3_600_000), updatedAt: new Date() }, { silent: true });
    await mk('vieux populaire', 30, 200);
    await mk('récent', 1);
    await mk('moyen', 5, 3);
    await mk('ancien vide', 100);
    await mk('frais populaire', 2, 20);
    await Post.create({ authorId: bob.id, text: 'en attente', status: 'pending_approval' });
    await refreshRecentScores(365);
  });

  test('is ordered by score and paginated (page size 3) without duplicates', async () => {
    // Viewed by Alice: Bob's pending post must not appear.
    // Scores: frais 21/4^1.5=2.63 · vieux 201/32^1.5=1.11 · moyen 4/7^1.5=0.22 · récent 1/3^1.5=0.19 · ancien ≈0.001
    const p1 = await aliceSession.agent.get('/');
    const since = p1.text.match(/since=(\d+)/)[1];
    const p2 = await aliceSession.agent.get(`/fil?page=2&since=${since}`);
    const texts = (html) => [...html.matchAll(/<p x-ref="t"[^>]*>([^<]+)<\/p>/g)].map((m) => m[1]);
    const all = [...texts(p1.text), ...texts(p2.text)];
    expect(all).toEqual(['frais populaire', 'vieux populaire', 'moyen', 'récent', 'ancien vide']);
    expect(p1.text).toContain('hx-trigger="revealed"');
    expect(p2.text).not.toContain('hx-trigger="revealed"');
    expect(p2.text).toContain('Vous êtes à jour');
  });

  test('posts created after the first page do not shift later pages', async () => {
    const p1 = await bobSession.agent.get('/');
    const since = p1.text.match(/since=(\d+)/)[1];
    await Post.create({ authorId: alice.id, text: 'tout nouveau', score: 99 });
    const p2 = await bobSession.agent.get(`/fil?page=2&since=${since}`);
    expect(p2.text).not.toContain('tout nouveau');
  });

  test('pending posts are hidden from others but visible to their author', async () => {
    expect((await aliceSession.agent.get('/fil?page=1')).text).not.toContain('en attente');
    const mine = await bobSession.agent.get(`/fil?page=1&since=${Date.now()}`);
    const p2 = await bobSession.agent.get(`/fil?page=2&since=${Date.now()}`);
    expect(mine.text + p2.text + (await bobSession.agent.get(`/fil?page=3&since=${Date.now()}`)).text).toContain('en attente');
  });

  test('posts of banned users disappear', async () => {
    const mallory = await createUser({ email: 'mallory@ex.com' });
    const p = await Post.create({ authorId: mallory.id, text: 'spam spam', score: 1000 });
    expect((await bobSession.agent.get('/')).text).toContain('spam spam');
    await mallory.update({ isBanned: true });
    expect((await bobSession.agent.get('/')).text).not.toContain('spam spam');
    expect((await request(app).get(`/publications/${p.id}`)).status).toBe(404);
  });

  test('a public post page is readable by guests and counts a view', async () => {
    const p = await Post.create({ authorId: alice.id, text: 'public' });
    const res = await request(app).get(`/publications/${p.id}`);
    expect(res.status).toBe(200);
    await p.reload();
    expect(p.viewsCount).toBe(1);
    await aliceSession.agent.get(`/publications/${p.id}`); // author views don't count
    await p.reload();
    expect(p.viewsCount).toBe(1);
  });
});
