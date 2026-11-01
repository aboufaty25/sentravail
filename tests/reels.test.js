const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, request, resetDb, closeDb, createUser, loginAs } = require('./helpers');
const { Post, Follow } = require('../src/models');
const { probeMp4 } = require('../src/services/video');
const env = require('../src/config/env');

// ---------- Minimal ISO-BMFF builder (headers only, enough for the duration probe) ----------
const box = (type, ...payloads) => {
  const body = Buffer.concat(payloads);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const ftyp = () => box('ftyp', Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isomiso2avc1mp41'));
function mvhd(seconds, version = 0) {
  const timescale = 1000;
  if (version === 1) {
    const b = Buffer.alloc(4 + 8 + 8 + 4 + 8 + 80);
    b[0] = 1;
    b.writeUInt32BE(timescale, 20);
    b.writeBigUInt64BE(BigInt(Math.round(seconds * timescale)), 24);
    return box('mvhd', b);
  }
  const b = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 80);
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(Math.round(seconds * timescale), 16);
  return box('mvhd', b);
}
const mp4 = (seconds, { version = 0, moovAtEnd = false, padding = 1024 } = {}) => {
  const moov = box('moov', mvhd(seconds, version));
  const mdat = box('mdat', Buffer.alloc(padding));
  return moovAtEnd ? Buffer.concat([ftyp(), mdat, moov]) : Buffer.concat([ftyp(), moov, mdat]);
};
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

const tmpFile = (buf) => {
  const p = path.join(os.tmpdir(), `probe-${Math.random().toString(36).slice(2)}.mp4`);
  fs.writeFileSync(p, buf);
  return p;
};

let ana; let bob; let carl; let anaS; let bobS; let carlS;
beforeAll(async () => {
  await resetDb();
  ana = await createUser({ username: 'ana', email: 'ana@ex.com', firstName: 'Ana' });
  bob = await createUser({ username: 'bob', email: 'bob@ex.com', role: 'recruiter', firstName: 'Bob' });
  carl = await createUser({ username: 'carl', email: 'carl@ex.com', firstName: 'Carl' });
  [anaS, bobS, carlS] = await Promise.all([ana, bob, carl].map((u) => loginAs(u)));
});
afterAll(closeDb);

const upload = (s, video, { thumb = JPEG, fields = {} } = {}) => {
  let req = s.agent.post('/reels').set('X-CSRF-Token', s.csrf).set('Accept', 'application/json');
  for (const [k, v] of Object.entries({ text: 'Mon réel', visibility: 'public', ...fields })) req = req.field(k, v);
  if (video) req = req.attach('video', video, { filename: 'clip.mp4', contentType: 'video/mp4' });
  if (thumb) req = req.attach('thumbnail', thumb, { filename: 'thumb.jpg', contentType: 'image/jpeg' });
  return req;
};
const fileOf = (url) => path.join(env.uploadDir, url.replace('/uploads/', ''));
const tmpCount = () => (fs.existsSync(env.uploadTmpDir) ? fs.readdirSync(env.uploadTmpDir).length : 0);

describe('MP4/MOV duration probe', () => {
  test.each([
    ['version 0 header', mp4(12), 12],
    ['version 1 (64-bit) header', mp4(29.5, { version: 1 }), 29.5],
    ['moov at the end (not fast-start)', mp4(8, { moovAtEnd: true }), 8],
  ])('%s', async (_, buf, expected) => {
    const info = await probeMp4(tmpFile(buf));
    expect(info.ok).toBe(true);
    expect(info.duration).toBeCloseTo(expected, 2);
  });

  test('rejects files without moov/mvhd or with an unknown first box', async () => {
    expect((await probeMp4(tmpFile(Buffer.concat([ftyp(), box('mdat', Buffer.alloc(100))])))).ok).toBe(false);
    expect((await probeMp4(tmpFile(Buffer.from('<html>not a video</html>'.repeat(5))))).ok).toBe(false);
    expect((await probeMp4(tmpFile(Buffer.from([0, 0, 0, 1])))).ok).toBe(false);
  });
});

describe('Publishing reels', () => {
  test('a valid 12 s reel is stored on disk with its thumbnail; temp files are cleaned', async () => {
    const res = await upload(anaS, mp4(12));
    expect(res.status).toBe(201);
    expect(res.body.redirect).toBe(`/reels?r=${res.body.id}`);
    const post = await Post.findByPk(res.body.id);
    expect(post.type).toBe('reel');
    expect(post.videoUrl).toMatch(/^\/uploads\/reels\/\d{4}\/\d{2}\/[a-f0-9]{24}\.mp4$/);
    expect(post.thumbnailUrl).toMatch(/^\/uploads\/reel-thumbs\//);
    expect(fs.existsSync(fileOf(post.videoUrl))).toBe(true);
    expect(tmpCount()).toBe(0);
    const served = await request(app).get(post.videoUrl).set('Range', 'bytes=0-99');
    expect(served.status).toBe(206); // range requests: streaming / seeking on mobile
  });

  test('server refuses videos longer than 30 s, even if the browser check is bypassed', async () => {
    const before = await Post.count();
    const res = await upload(anaS, mp4(45));
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('45 secondes');
    expect(await Post.count()).toBe(before);
    expect(tmpCount()).toBe(0);
  });

  test('accepts the encoder tolerance just above 30 s', async () => {
    expect((await upload(anaS, mp4(30.4))).status).toBe(201);
  });

  test('refuses fake videos, wrong types and missing video', async () => {
    expect((await upload(anaS, Buffer.from('not a video '.repeat(50)))).status).toBe(422);
    const wrongType = await anaS.agent.post('/reels').set('X-CSRF-Token', anaS.csrf).set('Accept', 'application/json')
      .attach('video', mp4(5), { filename: 'clip.avi', contentType: 'video/x-msvideo' });
    expect(wrongType.status).toBe(422);
    expect((await upload(anaS, null)).status).toBe(422);
    expect(tmpCount()).toBe(0);
  });

  test('refuses files over 40 MB', async () => {
    const res = await upload(anaS, mp4(10, { padding: 41 * 1024 * 1024 }), { thumb: null });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/40 Mo/);
    expect(tmpCount()).toBe(0);
  }, 30000);

  test('a broken thumbnail does not block the reel', async () => {
    const res = await upload(anaS, mp4(6), { thumb: Buffer.from('not an image at all, sorry') });
    expect(res.status).toBe(201);
    expect((await Post.findByPk(res.body.id)).thumbnailUrl).toBeNull();
  });

  test('recruiters can publish; guests and missing CSRF cannot', async () => {
    expect((await upload(bobS, mp4(10))).status).toBe(201);
    const guest = request.agent(app);
    const page = await guest.get('/connexion');
    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const res = await guest.post('/reels').set('X-CSRF-Token', csrf).set('HX-Request', 'true').attach('video', mp4(5), { filename: 'a.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(401);
    const noCsrf = await anaS.agent.post('/reels').set('Accept', 'application/json').attach('video', mp4(5), { filename: 'a.mp4', contentType: 'video/mp4' });
    expect(noCsrf.status).toBe(403);
    expect((await request(app).get('/reels/nouveau')).status).toBe(302);
  });

  test('deleting a reel removes its files', async () => {
    const res = await upload(anaS, mp4(7));
    const post = await Post.findByPk(res.body.id);
    await anaS.agent.post(`/publications/${post.id}/supprimer`).set('X-CSRF-Token', anaS.csrf).set('HX-Request', 'true');
    expect(fs.existsSync(fileOf(post.videoUrl))).toBe(false);
    expect(fs.existsSync(fileOf(post.thumbnailUrl))).toBe(false);
  });
});

describe('Reels viewer', () => {
  let publicReel; let networkReel;
  beforeAll(async () => {
    await Post.destroy({ where: {} });
    publicReel = await Post.findByPk((await upload(anaS, mp4(9), { fields: { text: 'Réel public' } })).body.id);
    networkReel = await Post.findByPk((await upload(bobS, mp4(9), { fields: { text: 'Réel réseau', visibility: 'network' } })).body.id);
    await Post.create({ authorId: ana.id, text: 'Pas un réel' });
  });

  test('lists reels only, with network rules applied', async () => {
    const guest = await request(app).get('/reels');
    expect(guest.status).toBe(200);
    expect(guest.text).toContain(`data-reel="${publicReel.id}"`);
    expect(guest.text).not.toContain(`data-reel="${networkReel.id}"`);
    expect(guest.text).not.toContain('Pas un réel');
    expect(guest.text).not.toContain('adsbygoogle');

    expect((await carlS.agent.get('/reels')).text).not.toContain(`data-reel="${networkReel.id}"`);
    await Follow.create({ followerId: carl.id, followingId: bob.id });
    expect((await carlS.agent.get('/reels')).text).toContain(`data-reel="${networkReel.id}"`);
  });

  test('?r= opens a given reel first; videos are lazy (data-src, preload none)', async () => {
    const res = await carlS.agent.get(`/reels?r=${networkReel.id}`);
    const first = res.text.match(/data-reel="(\d+)"/)[1];
    expect(Number(first)).toBe(networkReel.id);
    expect(res.text).toMatch(/data-src="\/uploads\/reels\/[^"]+" [^>]*preload="none"|preload="none"[^>]*data-src/s);
    // a hidden reel cannot be forced open
    const guest = await request(app).get(`/reels?r=${networkReel.id}`);
    expect(guest.text).not.toContain(`data-reel="${networkReel.id}"`);
  });

  test('like toggles on reels only', async () => {
    let res = await carlS.agent.post(`/reels/${publicReel.id}/jaime`).set('X-CSRF-Token', carlS.csrf).set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('aria-pressed="true"');
    await publicReel.reload();
    expect(publicReel.likesCount).toBe(1);
    res = await carlS.agent.post(`/reels/${publicReel.id}/jaime`).set('X-CSRF-Token', carlS.csrf).set('HX-Request', 'true');
    expect(res.text).toContain('aria-pressed="false"');
    const text = await Post.findOne({ where: { text: 'Pas un réel' } });
    expect((await carlS.agent.post(`/reels/${text.id}/jaime`).set('X-CSRF-Token', carlS.csrf).set('HX-Request', 'true')).status).toBe(404);
  });

  test('views count once per session and never for the author', async () => {
    const view = (s) => s.agent.post(`/reels/${publicReel.id}/vue`).set('X-CSRF-Token', s.csrf);
    await view(carlS);
    await view(carlS);
    await view(anaS); // author
    await publicReel.reload();
    expect(publicReel.viewsCount).toBe(1);
  });

  test('comments in the reel viewer update the reel counter (no feed block)', async () => {
    const list = await carlS.agent.get(`/publications/${publicReel.id}/commentaires?ctx=reel`);
    expect(list.text).toContain('name="ctx" value="reel"');
    const res = await carlS.agent.post(`/publications/${publicReel.id}/commentaires`).set('X-CSRF-Token', carlS.csrf).set('HX-Request', 'true').type('form').send({ text: 'Bravo', ctx: 'reel' });
    expect(res.text).toContain(`id="reel-comments-${publicReel.id}" hx-swap-oob="true"`);
    expect(res.text).not.toContain(`id="social-${publicReel.id}"`);
  });

  test('reels appear in the feed and on the profile', async () => {
    const feed = await carlS.agent.get('/');
    expect(feed.text).toContain('data-feed-video');
    expect(feed.text).toContain('a publié un réel');
    const profile = await request(app).get('/profil/ana?onglet=reels');
    expect(profile.text).toContain(`/reels?r=${publicReel.id}`);
  });

  test('pagination endpoint', async () => {
    const res = await request(app).get('/reels/suite?page=2');
    expect(res.status).toBe(200);
  });
});
