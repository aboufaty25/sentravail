// TikTok's in-app browser: the "open in your browser" guide is rendered from the server.
const { app, request, resetDb, closeDb } = require('./helpers');
const { detectInApp } = require('../src/utils/inAppBrowser');

const TIKTOK_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.8.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/SN';
const TIKTOK_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 trill_340803 BytedanceWebview/d8a21c6';
const CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

beforeAll(resetDb);
afterAll(closeDb);

test('detects TikTok on iOS and Android, not regular browsers', () => {
  expect(detectInApp(TIKTOK_IOS)).toEqual({ id: 'tiktok', name: 'TikTok', os: 'ios' });
  expect(detectInApp(TIKTOK_ANDROID)).toEqual({ id: 'tiktok', name: 'TikTok', os: 'android' });
  expect(detectInApp(CHROME)).toBeNull();
  expect(detectInApp(SAFARI)).toBeNull();
  expect(detectInApp(undefined)).toBeNull();
});

test('the guide opens on site and auth pages inside TikTok only', async () => {
  for (const path of ['/', '/offres', '/connexion']) {
    const res = await request(app).get(path).set('User-Agent', TIKTOK_ANDROID);
    expect(res.text).toContain('x-data="inAppGuide()"');
    expect(res.text).toContain('Ouvrir dans le navigateur');
  }
  const android = await request(app).get('/').set('User-Agent', TIKTOK_ANDROID);
  expect(android.text).toContain('Ouvrir dans Chrome');
  const ios = await request(app).get('/').set('User-Agent', TIKTOK_IOS);
  expect(ios.text).toContain('x-data="inAppGuide()"');
  expect(ios.text).not.toContain('Ouvrir dans Chrome');
  expect(ios.text).toContain('Safari');
  for (const ua of [CHROME, SAFARI]) {
    expect((await request(app).get('/').set('User-Agent', ua)).text).not.toContain('inAppGuide');
  }
});
