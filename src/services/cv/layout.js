// Layout toolkit for CV templates (PDFKit, A4, points).
// A Flow is a column that fills pages from top to bottom: before drawing a block it
// reserves its height and, if the block does not fit, continues on the next page
// (created on demand; page backgrounds are drawn by the template's chrome callback).
// Blocks are kept small (a line, an entry header, one bullet), so nothing is ever cut.
const path = require('path');

const PAGE = { width: 595.28, height: 841.89 };

// ---------- Fonts (embedded and subset: only the characters used are stored) ----------
const fontFile = (pkg, file) => path.join(path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files', file);
const FONT_FILES = {
  'Inter-Regular': fontFile('inter', 'inter-latin-400-normal.woff'),
  'Inter-Medium': fontFile('inter', 'inter-latin-500-normal.woff'),
  'Inter-SemiBold': fontFile('inter', 'inter-latin-600-normal.woff'),
  'Inter-Bold': fontFile('inter', 'inter-latin-700-normal.woff'),
  'Inter-Italic': fontFile('inter', 'inter-latin-400-italic.woff'),
  'Lora-Regular': fontFile('lora', 'lora-latin-400-normal.woff'),
  'Lora-Bold': fontFile('lora', 'lora-latin-700-normal.woff'),
  'Lora-Italic': fontFile('lora', 'lora-latin-400-italic.woff'),
};

// WOFF (zlib-compressed tables) → plain TrueType, done once: parsing a WOFF for every CV
// costs ~90 ms per font, a TTF a few ms.
function woffToTtf(woff) {
  const zlib = require('zlib');
  const numTables = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const e = 44 + i * 20;
    const tag = woff.toString('latin1', e, e + 4);
    const offset = woff.readUInt32BE(e + 4);
    const compLength = woff.readUInt32BE(e + 8);
    const origLength = woff.readUInt32BE(e + 12);
    const checksum = woff.readUInt32BE(e + 16);
    const raw = woff.subarray(offset, offset + compLength);
    tables.push({ tag, checksum, data: compLength < origLength ? zlib.inflateSync(raw) : raw });
  }
  let pow = 1;
  let log = 0;
  while (pow * 2 <= numTables) { pow *= 2; log += 1; }
  const header = Buffer.alloc(12 + 16 * numTables);
  header.writeUInt32BE(woff.readUInt32BE(4), 0); // flavor = sfnt version
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(pow * 16, 6);
  header.writeUInt16BE(log, 8);
  header.writeUInt16BE(numTables * 16 - pow * 16, 10);
  let offset = header.length;
  const parts = [header];
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    header.write(t.tag, r, 'latin1');
    header.writeUInt32BE(t.checksum, r + 4);
    header.writeUInt32BE(offset, r + 8);
    header.writeUInt32BE(t.data.length, r + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    parts.push(t.data, Buffer.alloc(pad));
    offset += t.data.length + pad;
  });
  return Buffer.concat(parts);
}

const fontCache = {};
function registerFonts(doc) {
  for (const [name, file] of Object.entries(FONT_FILES)) {
    if (!fontCache[name]) fontCache[name] = woffToTtf(require('fs').readFileSync(file));
    doc.registerFont(name, fontCache[name]);
  }
}

// Font roles for a font choice: 'sans' (Inter), 'serif' (Lora), 'mixed' (Lora titles, Inter text).
function fontSet(choice) {
  const sans = { regular: 'Inter-Regular', medium: 'Inter-Medium', semibold: 'Inter-SemiBold', bold: 'Inter-Bold', italic: 'Inter-Italic' };
  const serif = { regular: 'Lora-Regular', medium: 'Lora-Regular', semibold: 'Lora-Bold', bold: 'Lora-Bold', italic: 'Lora-Italic' };
  if (choice === 'serif') return { ...serif, heading: 'Lora-Bold', headingRegular: 'Lora-Regular' };
  if (choice === 'mixed') return { ...sans, heading: 'Lora-Bold', headingRegular: 'Lora-Regular' };
  return { ...sans, heading: 'Inter-Bold', headingRegular: 'Inter-SemiBold' };
}

// ---------- Colors ----------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}
// t = 0 → color, t = 1 → white
function tint(hex, t) {
  return rgbToHex(hexToRgb(hex).map((v) => v + (255 - v) * t));
}
function shade(hex, t) {
  return rgbToHex(hexToRgb(hex).map((v) => v * (1 - t)));
}

// ---------- Flow ----------
class Flow {
  constructor(doc, { x, width, top, bottom, topNext, startPage = 0 }) {
    Object.assign(this, { doc, x, width, top, bottom, topNext: topNext ?? top });
    this.page = startPage;
    this.y = top;
  }

  // Makes this flow's page the current PDFKit page (another flow may have moved it).
  focus() {
    while (this.doc.bufferedPageRange().count <= this.page) this.doc.addPage();
    this.doc.switchToPage(this.page);
    return this;
  }

  next() {
    this.page += 1;
    this.y = this.topNext;
    return this.focus();
  }

  // Reserves h points; moves to the next page if needed (unless already at the top).
  ensure(h) {
    if (this.y + h > this.bottom && this.y > this.topNext + 1) this.next();
    else this.focus();
    return this;
  }

  space(h) {
    this.y += h;
    return this;
  }

  // Height of a text block with the given font settings.
  measure(text, { font, size, width = this.width, lineGap = 1.5, characterSpacing = 0 }) {
    this.doc.font(font).fontSize(size);
    return this.doc.heightOfString(String(text || ' '), { width, lineGap, characterSpacing });
  }

  // Draws text at the current y (after ensure); returns its height.
  text(text, { font, size, color, x = this.x, width = this.width, align = 'left', lineGap = 1.5, characterSpacing = 0, keep = 0, advance = true }) {
    const value = String(text || '');
    const h = this.measure(value, { font, size, width, lineGap, characterSpacing });
    this.ensure(h + keep);
    this.doc.font(font).fontSize(size).fillColor(color).text(value, x, this.y, { width, align, lineGap, characterSpacing, lineBreak: true });
    if (advance) this.y += h;
    return h;
  }
}

// ---------- Small helpers ----------
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function formatMonth(value) {
  if (!value) return '';
  const [y, m] = String(value).split('-');
  return m ? `${MONTHS[Number(m) - 1]} ${y}` : y;
}
function period(item, { present = 'Aujourd\'hui', sep = ' – ' } = {}) {
  const start = formatMonth(item.start);
  const end = item.current ? present : formatMonth(item.end);
  if (start && end) return `${start}${sep}${end}`;
  return start || end || '';
}
// Description → bullet lines ("- ", "• ", "* " prefixes removed).
function bullets(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*·▪]\s*/, '').trim())
    .filter(Boolean);
}

// Bulleted line: small round/square bullet + wrapped text.
function bulletLine(flow, text, { font, size, color, bulletColor = color, indent = 10, shape = 'dot', x = flow.x, width = flow.width, gap = 2 }) {
  const textWidth = width - indent;
  const h = flow.measure(text, { font, size, width: textWidth });
  flow.ensure(h + gap);
  const doc = flow.doc;
  const cy = flow.y + size * 0.62;
  doc.save().fillColor(bulletColor);
  if (shape === 'square') doc.rect(x + 1, cy - 2.2, 4.2, 4.2).fill();
  else doc.circle(x + 2.6, cy, 1.5).fill();
  doc.restore();
  flow.text(text, { font, size, color, x: x + indent, width: textWidth });
  flow.space(gap);
}

// Level bar (fraction 0..1).
function bar(doc, x, y, width, fraction, { color, track, height = 3.2, radius = 1.6 }) {
  doc.save().roundedRect(x, y, width, height, radius).fill(track);
  if (fraction > 0) doc.roundedRect(x, y, Math.max(height, width * fraction), height, radius).fill(color);
  doc.restore();
}

// Dot rating (filled / empty), e.g. ●●●○○.
function dots(doc, x, y, { value, max = 5, color, track, r = 2.6, gap = 3 }) {
  for (let i = 0; i < max; i += 1) {
    doc.save().circle(x + r + i * (2 * r + gap), y + r, r).fill(i < value ? color : track).restore();
  }
  return max * (2 * r + gap) - gap;
}

// Photo: circle or rounded square, cover-cropped. Silently skipped if the image is unusable.
function photo(doc, buffer, x, y, size, { shape = 'circle', ring = null, ringWidth = 3, radius = 6 } = {}) {
  if (!buffer) return false;
  try {
    const img = doc.openImage(buffer);
    const scale = Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    doc.save();
    if (shape === 'circle') doc.circle(x + size / 2, y + size / 2, size / 2).clip();
    else doc.roundedRect(x, y, size, size, radius).clip();
    doc.image(img, x + (size - w) / 2, y + (size - h) / 2, { width: w, height: h });
    doc.restore();
    if (ring) {
      doc.save().lineWidth(ringWidth).strokeColor(ring);
      if (shape === 'circle') doc.circle(x + size / 2, y + size / 2, size / 2 + ringWidth / 2).stroke();
      else doc.roundedRect(x - ringWidth / 2, y - ringWidth / 2, size + ringWidth, size + ringWidth, radius).stroke();
      doc.restore();
    }
    return true;
  } catch (_) {
    return false;
  }
}

// Tiny vector icons (no icon font needed), drawn in a size×size box.
function icon(doc, name, x, y, size, color) {
  const s = size / 12;
  doc.save().translate(x, y).scale(s).lineWidth(1.2).strokeColor(color).fillColor(color).lineJoin('round').lineCap('round');
  switch (name) {
    case 'mail':
      doc.roundedRect(1, 2.5, 10, 7, 1).stroke().moveTo(1.5, 3.2).lineTo(6, 6.6).lineTo(10.5, 3.2).stroke();
      break;
    case 'phone':
      doc.roundedRect(3.5, 1, 5, 10, 1.2).stroke().moveTo(5.3, 9).lineTo(6.7, 9).stroke();
      break;
    case 'pin':
      doc.path('M6 11 C6 11 2.2 7.2 2.2 4.8 A3.8 3.8 0 0 1 9.8 4.8 C9.8 7.2 6 11 6 11 Z').stroke().circle(6, 4.8, 1.3).fill();
      break;
    case 'globe':
      doc.circle(6, 6, 4.8).stroke().ellipse(6, 6, 2, 4.8).stroke().moveTo(1.4, 6).lineTo(10.6, 6).stroke();
      break;
    case 'flag':
      doc.moveTo(2.5, 11).lineTo(2.5, 1.2).stroke().path('M2.5 1.5 L10 1.5 L8.3 4 L10 6.5 L2.5 6.5 Z').fill();
      break;
    case 'car':
      doc.roundedRect(1, 5, 10, 4, 1).stroke().path('M2.6 5 L3.8 2.4 L8.2 2.4 L9.4 5').stroke().circle(3.6, 9.4, 1).fill().circle(8.4, 9.4, 1).fill();
      break;
    case 'link':
      doc.roundedRect(1, 4, 6, 4, 2).stroke().roundedRect(5, 4, 6, 4, 2).stroke();
      break;
    case 'user':
      doc.circle(6, 3.8, 2.4).stroke().path('M1.8 11 C2.3 7.8 4 6.8 6 6.8 C8 6.8 9.7 7.8 10.2 11').stroke();
      break;
    case 'briefcase':
      doc.roundedRect(1, 3.6, 10, 7, 1).stroke().path('M4.2 3.6 L4.2 2 L7.8 2 L7.8 3.6').stroke();
      break;
    case 'cap':
      doc.path('M6 2 L11.4 4.6 L6 7.2 L0.6 4.6 Z').fill().path('M3 6 L3 8.6 C4.6 10 7.4 10 9 8.6 L9 6').stroke();
      break;
    case 'star':
      doc.path('M6 1 L7.5 4.4 L11.2 4.7 L8.4 7.1 L9.2 10.8 L6 8.9 L2.8 10.8 L3.6 7.1 L0.8 4.7 L4.5 4.4 Z').fill();
      break;
    case 'award':
      doc.circle(6, 4.6, 3.4).stroke().path('M4 7.4 L3.2 11 L6 9.6 L8.8 11 L8 7.4').stroke();
      break;
    default:
      doc.circle(6, 6, 2).fill();
  }
  doc.restore();
}

module.exports = { woffToTtf, PAGE, FONT_FILES, registerFonts, fontSet, tint, shade, Flow, formatMonth, period, bullets, bulletLine, bar, dots, photo, icon };
