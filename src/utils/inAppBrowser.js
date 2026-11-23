// In-app browsers that break the site (file pickers for the CV, Google/Apple sign-in, downloads).
// Detected from the User-Agent so the "open in your browser" guide is in the page from the start.
// HTML pages are sent with "Cache-Control: private", so a per-visitor page is safe.
const IN_APP = [
  // TikTok: "BytedanceWebview", "musical_ly_…", "TikTok 3x.x", "trill_…" (Asian app).
  { id: 'tiktok', name: 'TikTok', re: /bytedancewebview|musical_ly|\btiktok\b|\btrill_\d/i },
];

function detectInApp(userAgent) {
  const ua = String(userAgent || '');
  const app = IN_APP.find((a) => a.re.test(ua));
  if (!app) return null;
  const os = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : 'other';
  return { id: app.id, name: app.name, os };
}

module.exports = { detectInApp };
