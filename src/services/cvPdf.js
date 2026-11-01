const fs = require('fs/promises');
const path = require('path');
const PDFDocument = require('pdfkit');
const env = require('../config/env');

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const BRAND = '#1668e3';
const DARK = '#111827';
const MUTED = '#4b5563';

function formatMonth(value) {
  if (!value) return '';
  const [y, m] = value.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function period(item) {
  const start = formatMonth(item.start);
  const end = item.current ? "aujourd'hui" : formatMonth(item.end);
  if (start && end) return `${start} — ${end}`;
  return start || end || '';
}

// Loads the CV photo as a buffer (local upload or Cloudinary forced to JPEG). Never throws.
async function loadPhoto(url) {
  try {
    if (!url) return null;
    if (url.startsWith('/uploads/')) {
      const rel = url.slice('/uploads/'.length);
      if (rel.includes('..')) return null;
      return await fs.readFile(path.join(env.uploadDir, rel));
    }
    if (url.startsWith('https://res.cloudinary.com/')) {
      const res = await fetch(url.replace('/upload/', '/upload/c_fill,g_face,w_400,h_400,f_jpg/'), { signal: AbortSignal.timeout(8000) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    }
  } catch (_) {
    /* photo is optional */
  }
  return null;
}

function contactLine(p) {
  return [p.email, p.phone, p.city].filter(Boolean).join('   •   ');
}

// ---------- Classic: single column ----------
function renderClassic(doc, cv, photo) {
  const p = cv.personal;
  const left = 50;
  const width = doc.page.width - 100;
  let textLeft = left;
  if (photo) {
    try {
      doc.save().circle(left + 40, 90, 40).clip().image(photo, left, 50, { width: 80, height: 80 }).restore();
      textLeft = left + 100;
    } catch (_) { /* unsupported image */ }
  }
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(24).text(`${p.firstName} ${p.lastName}`, textLeft, 58, { width: width - (textLeft - left) });
  doc.fillColor(BRAND).font('Helvetica').fontSize(13).text(cv.title, { width: width - (textLeft - left) });
  doc.moveDown(0.3).fillColor(MUTED).fontSize(9.5).text(contactLine(p), { width: width - (textLeft - left) });
  doc.y = Math.max(doc.y, photo ? 140 : doc.y) + 10;

  const section = (title) => {
    doc.moveDown(0.8);
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(11.5).text(title.toUpperCase(), left, doc.y, { characterSpacing: 0.8 });
    const y = doc.y + 2;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.8).strokeColor('#d1d5db').stroke();
    doc.moveDown(0.5);
  };

  if (cv.summary) {
    section('Profil');
    doc.fillColor(DARK).font('Helvetica').fontSize(10.5).text(cv.summary, left, doc.y, { width, lineGap: 2 });
  }
  if (cv.experiences.length) {
    section('Expériences professionnelles');
    cv.experiences.forEach((e) => {
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(e.title, left, doc.y, { width, continued: !!e.company });
      if (e.company) doc.font('Helvetica').fillColor(MUTED).text(`  —  ${e.company}${e.city ? `, ${e.city}` : ''}`);
      const per = period(e);
      if (per) doc.fillColor(BRAND).fontSize(9.5).text(per, left, doc.y, { width });
      if (e.description) doc.moveDown(0.2).fillColor(DARK).fontSize(10).text(e.description, left, doc.y, { width, lineGap: 1.5 });
      doc.moveDown(0.6);
    });
  }
  if (cv.educations.length) {
    section('Formation');
    cv.educations.forEach((e) => {
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(e.degree, left, doc.y, { width });
      const sub = [e.school, e.city].filter(Boolean).join(', ');
      const per = period(e);
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text([sub, per].filter(Boolean).join('   •   '), left, doc.y, { width });
      doc.moveDown(0.5);
    });
  }
  if (cv.skills.length) {
    section('Compétences');
    doc.fillColor(DARK).font('Helvetica').fontSize(10.5).text(cv.skills.join('   •   '), left, doc.y, { width, lineGap: 2 });
  }
  if (cv.languages.length) {
    section('Langues');
    doc.fillColor(DARK).font('Helvetica').fontSize(10.5).text(cv.languages.map((l) => `${l.name} (${l.level.toLowerCase()})`).join('   •   '), left, doc.y, { width });
  }
}

// ---------- Modern: coloured sidebar ----------
function renderModern(doc, cv, photo) {
  const p = cv.personal;
  const sideW = 185;
  const pad = 22;
  const mainLeft = sideW + 28;
  const mainW = doc.page.width - mainLeft - 40;
  const drawSidebar = () => doc.save().rect(0, 0, sideW, doc.page.height).fill('#13479b').restore();
  drawSidebar();
  doc.on('pageAdded', () => {
    drawSidebar();
    // Text overflowing onto the new page continues in the main column, in body colour.
    doc.fillColor(DARK).font('Helvetica').fontSize(10);
    doc.x = mainLeft;
  });

  // Sidebar (first page)
  let y = 40;
  if (photo) {
    try {
      doc.save().circle(sideW / 2, y + 55, 55).clip().image(photo, sideW / 2 - 55, y, { width: 110, height: 110 }).restore();
      y += 130;
    } catch (_) { /* unsupported image */ }
  }
  const sideTitle = (t) => {
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10.5).text(t.toUpperCase(), pad, y, { width: sideW - pad * 2, characterSpacing: 0.8 });
    y = doc.y + 3;
    doc.moveTo(pad, y).lineTo(sideW - pad, y).lineWidth(0.6).strokeColor('#8fb4f0').stroke();
    y += 7;
  };
  const sideText = (t, opts = {}) => {
    doc.fillColor('#e5edff').font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 9.5).text(t, pad, y, { width: sideW - pad * 2, lineGap: 1.5 });
    y = doc.y + (opts.gap ?? 4);
  };
  sideTitle('Contact');
  [p.email, p.phone, p.city].filter(Boolean).forEach((t) => sideText(t));
  y += 10;
  if (cv.skills.length) {
    sideTitle('Compétences');
    cv.skills.forEach((s) => sideText(`•  ${s}`, { gap: 2 }));
    y += 10;
  }
  if (cv.languages.length) {
    sideTitle('Langues');
    cv.languages.forEach((l) => {
      sideText(l.name, { bold: true, gap: 0 });
      sideText(l.level, { size: 9, gap: 5 });
    });
  }

  // Main column
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(24).text(`${p.firstName} ${p.lastName}`, mainLeft, 45, { width: mainW });
  doc.fillColor(BRAND).font('Helvetica').fontSize(13).text(cv.title, mainLeft, doc.y, { width: mainW });
  const section = (title) => {
    doc.moveDown(1);
    doc.fillColor('#13479b').font('Helvetica-Bold').fontSize(12).text(title, mainLeft, doc.y, { width: mainW });
    const ly = doc.y + 2;
    doc.moveTo(mainLeft, ly).lineTo(mainLeft + 40, ly).lineWidth(2).strokeColor(BRAND).stroke();
    doc.moveDown(0.6);
  };
  if (cv.summary) {
    section('Profil');
    doc.fillColor(DARK).font('Helvetica').fontSize(10.5).text(cv.summary, mainLeft, doc.y, { width: mainW, lineGap: 2 });
  }
  if (cv.experiences.length) {
    section('Expériences');
    cv.experiences.forEach((e) => {
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(e.title, mainLeft, doc.y, { width: mainW });
      const sub = [e.company, e.city].filter(Boolean).join(', ');
      const per = period(e);
      if (sub || per) doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text([sub, per].filter(Boolean).join('   •   '), mainLeft, doc.y, { width: mainW });
      if (e.description) doc.moveDown(0.2).fillColor(DARK).fontSize(10).text(e.description, mainLeft, doc.y, { width: mainW, lineGap: 1.5 });
      doc.moveDown(0.6);
    });
  }
  if (cv.educations.length) {
    section('Formation');
    cv.educations.forEach((e) => {
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(e.degree, mainLeft, doc.y, { width: mainW });
      const sub = [e.school, e.city].filter(Boolean).join(', ');
      const per = period(e);
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text([sub, per].filter(Boolean).join('   •   '), mainLeft, doc.y, { width: mainW });
      doc.moveDown(0.5);
    });
  }
}

// Returns the PDF as a Buffer.
async function buildCvPdf(cv) {
  const photo = await loadPhoto(cv.personal.photoUrl);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 45, bottom: 45, left: cv.template === 'modern' ? 213 : 50, right: 40 },
    info: { Title: `CV — ${cv.personal.firstName} ${cv.personal.lastName}`, Author: `${cv.personal.firstName} ${cv.personal.lastName}`, Creator: 'SenTravail' },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  if (cv.template === 'modern') renderModern(doc, cv, photo);
  else renderClassic(doc, cv, photo);
  doc.end();
  return done;
}

module.exports = { buildCvPdf, formatMonth, period };
