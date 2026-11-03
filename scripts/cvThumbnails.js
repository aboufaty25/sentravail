// Regenerates the template thumbnails shown in the CV builder (public/img/cv/<template>.jpg)
// from the real PDFs. Development only: needs Playwright and the app running on APP_URL.
//   npm run cv:thumbs
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright'); // eslint-disable-line import/no-extraneous-dependencies
const env = require('../src/config/env');
const { buildCvPdf } = require('../src/services/cv');
const { TEMPLATES } = require('../src/config/cvTemplates');
const sample = require('../src/config/cvSample');

const OUT = path.join(__dirname, '..', 'public', 'img', 'cv');
// Neutral illustrated portrait (no real person).
const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<rect width="400" height="400" fill="#d9c2b0"/><circle cx="200" cy="165" r="78" fill="#7a4b33"/>
<path d="M88 400c8-92 56-140 112-140s104 48 112 140z" fill="#2f3e5c"/><path d="M118 150c0-60 40-96 82-96s82 36 82 96c-20-30-50-44-82-44s-62 14-82 44z" fill="#1e1410"/></svg>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1300 }, deviceScaleFactor: 1 });
  await page.setContent(AVATAR_SVG);
  const avatar = await page.locator('svg').screenshot({ type: 'jpeg', quality: 90 });
  await page.route(`${env.APP_URL}/__thumbs`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body style="margin:0"><canvas id="c"></canvas><script type="module">
    import * as pdfjs from '/vendor/pdfjs/pdf.min.mjs';
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    window.draw = async (b64) => { const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise; const p = await pdf.getPage(1);
      const v = p.getViewport({ scale: 0.75 }); const c = document.getElementById('c'); c.width = v.width; c.height = v.height;
      await p.render({ canvasContext: c.getContext('2d'), viewport: v }).promise; };
    window.ready = true;</script></body>` }));
  await page.goto(`${env.APP_URL}/__thumbs`);
  await page.waitForFunction(() => window.ready);
  for (const key of Object.keys(TEMPLATES)) {
    const pdf = await buildCvPdf({ ...sample, template: key, color: TEMPLATES[key].color, font: TEMPLATES[key].font }, { photo: avatar });
    await page.evaluate((b64) => window.draw(b64), pdf.toString('base64'));
    await page.locator('#c').screenshot({ path: path.join(OUT, `${key}.jpg`), type: 'jpeg', quality: 80 });
    console.log(`public/img/cv/${key}.jpg`);
  }
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
