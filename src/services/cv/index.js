// CV PDF generation: normalizes the data, picks the template and returns a Buffer.
const fs = require('fs/promises');
const path = require('path');
const PDFDocument = require('pdfkit');
const env = require('../../config/env');
const L = require('./layout');
const { normalizeCv } = require('./normalize');

const TEMPLATE_IMPL = {
  rubis: require('./templates/rubis'),
  terracotta: require('./templates/terracotta'),
  classique: require('./templates/classique'),
  emeraude: require('./templates/emeraude'),
  encadre: require('./templates/encadre'),
  prune: require('./templates/prune'),
  horizon: require('./templates/horizon'),
};

// Loads the CV photo (local upload, or Cloudinary forced to JPEG). Never throws.
async function loadPhoto(url) {
  try {
    if (!url) return null;
    if (url.startsWith('/uploads/')) {
      const rel = url.slice('/uploads/'.length);
      if (rel.includes('..')) return null;
      return await fs.readFile(path.join(env.uploadDir, rel));
    }
    if (url.startsWith('https://res.cloudinary.com/')) {
      const res = await fetch(url.replace('/upload/', '/upload/c_fill,g_face,w_500,h_500,f_jpg/'), { signal: AbortSignal.timeout(8000) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    }
  } catch (_) { /* the photo is optional */ }
  return null;
}

function theme(cv) {
  return { color: cv.color, fonts: L.fontSet(cv.font), dark: '#111827', text: '#374151', muted: '#6b7280', track: L.tint(cv.color, 0.8) };
}

// options.photo: image buffer to use instead of personal.photoUrl (template thumbnails).
async function buildCvPdf(input, options = {}) {
  const cv = normalizeCv(input);
  const impl = TEMPLATE_IMPL[cv.template];
  const t = theme(cv);
  const photo = cv.showPhoto ? options.photo || (await loadPhoto(cv.personal.photoUrl)) : null;
  const name = `${cv.personal.firstName} ${cv.personal.lastName}`.trim() || 'CV';
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `CV — ${name}`, Author: name, Subject: cv.title, Creator: 'SenTravail' } });
  L.registerFonts(doc);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  // Page background ("chrome") is drawn as soon as a page exists, before any content.
  impl.chrome(doc, t, 0);
  doc.on('pageAdded', () => impl.chrome(doc, t, doc.bufferedPageRange().count - 1));
  impl.render(doc, cv, t, photo);
  doc.flushPages();
  doc.end();
  return done;
}

module.exports = { buildCvPdf, loadPhoto, TEMPLATE_IMPL };
