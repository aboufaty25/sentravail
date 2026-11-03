// Section renderers shared by the CV templates. A template chooses the variants and draws
// its own section titles; the content always flows with page breaks handled by Flow.
const L = require('../layout');
const { SECTION_LABELS, LANGUAGE_SCORE, SKILL_LEVELS } = require('../../../config/cvTemplates');
const { hasContent } = require('../normalize');

// Keys of this column, in the order chosen by the person, with content only.
function sectionsFor(cv, keys) {
  return cv.sectionOrder.filter((k) => keys.includes(k) && hasContent(cv, k));
}
const labelOf = (cv, key) => (key === 'custom' ? cv.custom.title || SECTION_LABELS.custom : SECTION_LABELS[key]);

const BODY = 9.2;

// ---------- Entries (experience / education) ----------
function entryParts(item, kind) {
  if (kind === 'experiences') return { title: item.title || 'Poste', sub: [item.company, item.city].filter(Boolean).join(', '), date: L.period(item), lines: L.bullets(item.description) };
  return { title: item.degree || 'Formation', sub: [item.school, item.city].filter(Boolean).join(', '), date: L.period(item), lines: L.bullets(item.description) };
}

function entries(flow, items, kind, t, o = {}) {
  const layout = o.layout || 'standard';
  const titleSize = o.titleSize || 10;
  const dateSize = o.dateSize || 8.4;
  const doc = flow.doc;
  let lastDot = null;
  items.forEach((item, i) => {
    const e = entryParts(item, kind);
    let x = flow.x;
    let width = flow.width;
    let dateCol = 0;
    if (layout === 'timeline') { x += 16; width -= 16; }
    if (layout === 'dateLeft') { dateCol = o.dateColumn || 118; x += dateCol; width -= dateCol; }
    doc.font(o.dateFont || t.fonts.semibold).fontSize(dateSize);
    const dateW = layout === 'dateLeft' || !e.date ? 0 : doc.widthOfString(e.date) + 8;
    const titleH = flow.measure(e.title, { font: t.fonts.bold, size: titleSize, width: width - dateW });
    const subH = e.sub ? flow.measure(e.sub, { font: t.fonts.italic, size: BODY, width }) + 1 : 0;
    const firstH = e.lines.length ? flow.measure(e.lines[0], { font: t.fonts.regular, size: BODY, width: width - 10 }) + 3 : 0;
    flow.ensure(titleH + subH + firstH + 4); // header kept with its first line
    const top = flow.y;
    if (layout === 'timeline') {
      const cx = flow.x + 4;
      const cy = top + titleSize * 0.6;
      if (lastDot && lastDot.page === flow.page) doc.save().moveTo(cx, lastDot.y).lineTo(cx, cy).lineWidth(1.4).strokeColor(o.lineColor || t.color).stroke().restore();
      doc.save().circle(cx, cy, 3).fill(t.color).circle(cx, cy, 1.3).fill('#ffffff').restore();
      lastDot = { page: flow.page, y: cy };
    }
    if (layout === 'dateLeft' && e.date) {
      doc.font(o.dateFont || t.fonts.bold).fontSize(dateSize + 0.6).fillColor(o.dateColor || t.dark).text(e.date, flow.x, top + 0.5, { width: dateCol - 10 });
    }
    flow.text(e.title, { font: t.fonts.bold, size: titleSize, color: o.titleColor || t.dark, x, width: width - dateW });
    if (dateW) doc.font(o.dateFont || t.fonts.semibold).fontSize(dateSize).fillColor(o.dateColor || t.color).text(e.date, x + width - dateW + 8, top + (titleSize - dateSize) / 2 + 0.5, { width: dateW - 8, align: 'right', lineBreak: false });
    if (e.sub) {
      flow.text(e.sub, { font: o.subFont || t.fonts.italic, size: BODY, color: o.subColor || t.color, x, width });
      flow.space(1);
    }
    flow.space(2);
    e.lines.forEach((line) => L.bulletLine(flow, line, { font: t.fonts.regular, size: BODY, color: t.text, bulletColor: o.bulletColor || t.text, x: x + 2, width: width - 2, shape: o.bulletShape || 'dot' }));
    if (i < items.length - 1) flow.space(o.entryGap || 7);
  });
}

// ---------- Skills / languages ----------
function skills(flow, cv, t, o = {}) {
  const color = o.color || t.text;
  const style = cv.showLevels && cv.skills.some((s) => s.level > 0) ? o.levelStyle || 'bars' : o.plainStyle || 'bullets';
  if (style === 'bullets') return cv.skills.forEach((s) => L.bulletLine(flow, s.name, { font: t.fonts.regular, size: BODY, color, bulletColor: o.bulletColor || color, x: flow.x, width: flow.width, shape: o.bulletShape || 'dot' }));
  if (style === 'squares2') return twoColumns(flow, cv.skills.map((s) => s.name), t, o);
  if (style === 'inline') return flow.text(cv.skills.map((s) => s.name).join('  •  '), { font: t.fonts.regular, size: BODY, color });
  cv.skills.forEach((s) => {
    const doc = flow.doc;
    if (style === 'levelText') {
      const word = SKILL_LEVELS[s.level] || '';
      flow.ensure(14);
      doc.font(t.fonts.regular).fontSize(BODY).fillColor(color).text(s.name, flow.x, flow.y, { width: flow.width - 70, lineBreak: false, ellipsis: true });
      if (word) doc.font(t.fonts.italic).fontSize(8).fillColor(t.muted).text(word, flow.x + flow.width - 68, flow.y + 1, { width: 68, align: 'right', lineBreak: false });
      flow.space(14);
    } else if (style === 'dots') {
      flow.ensure(15);
      doc.font(t.fonts.regular).fontSize(BODY).fillColor(color).text(s.name, flow.x, flow.y, { width: flow.width - 70, lineBreak: false, ellipsis: true });
      if (s.level) L.dots(doc, flow.x + flow.width - 63, flow.y + 2, { value: s.level, color: o.accent || t.color, track: o.track || t.track, r: 2.6, gap: 2.6 });
      flow.space(15);
    } else { // bars
      flow.text(s.name, { font: t.fonts.regular, size: BODY - 0.2, color });
      if (s.level) { flow.ensure(8); L.bar(doc, flow.x, flow.y + 1.5, flow.width, s.level / 5, { color: o.accent || t.color, track: o.track || t.track }); flow.space(8); }
      flow.space(3);
    }
  });
}

function languages(flow, cv, t, o = {}) {
  const color = o.color || t.text;
  const style = cv.showLevels ? o.style || 'bars' : 'levelRight';
  const doc = flow.doc;
  cv.languages.forEach((l) => {
    const score = LANGUAGE_SCORE[l.level] || 3;
    if (style === 'bars') {
      flow.ensure(26);
      doc.font(t.fonts.semibold).fontSize(BODY).fillColor(color).text(l.name, flow.x, flow.y, { width: flow.width - 70, lineBreak: false });
      doc.font(t.fonts.regular).fontSize(7.8).fillColor(o.levelColor || t.muted).text(l.level, flow.x + flow.width - 80, flow.y + 1, { width: 80, align: 'right', lineBreak: false });
      flow.space(13);
      L.bar(doc, flow.x, flow.y, flow.width, score / 5, { color: o.accent || t.color, track: o.track || t.track });
      flow.space(10);
    } else if (style === 'dots') {
      flow.ensure(15);
      doc.font(t.fonts.regular).fontSize(BODY).fillColor(color).text(l.name, flow.x, flow.y, { width: flow.width - 70, lineBreak: false });
      L.dots(doc, flow.x + flow.width - 63, flow.y + 2, { value: score, color: o.accent || t.color, track: o.track || t.track, r: 2.6, gap: 2.6 });
      flow.space(15);
    } else { // levelRight
      flow.ensure(14);
      doc.font(t.fonts.regular).fontSize(BODY).fillColor(color).text(l.name, flow.x, flow.y, { width: flow.width - 90, lineBreak: false });
      doc.font(t.fonts.italic).fontSize(8.2).fillColor(o.levelColor || t.muted).text(l.level, flow.x + flow.width - 90, flow.y + 0.5, { width: 90, align: 'right', lineBreak: false });
      flow.space(14);
    }
  });
}

// Two columns of short items with colored squares (qualities, interests…).
function twoColumns(flow, items, t, o = {}) {
  const colW = (flow.width - 12) / 2;
  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2);
    const h = Math.max(...pair.map((it) => flow.measure(it, { font: t.fonts.regular, size: BODY, width: colW - 14 })));
    flow.ensure(h + 6);
    pair.forEach((it, j) => {
      const x = flow.x + j * (colW + 12);
      flow.doc.save().rect(x, flow.y + 2.6, 5.5, 5.5).fill(o.accent || t.color).restore();
      flow.doc.font(t.fonts.regular).fontSize(BODY).fillColor(o.color || t.text).text(it, x + 12, flow.y, { width: colW - 14 });
    });
    flow.space(h + 6);
  }
}

function list(flow, items, t, o = {}) {
  const style = o.style || 'bullets';
  if (style === 'inline') return flow.text(items.join('  •  '), { font: t.fonts.regular, size: BODY, color: o.color || t.text });
  if (style === 'squares2') return twoColumns(flow, items, t, o);
  return items.forEach((it) => L.bulletLine(flow, it, { font: t.fonts.regular, size: BODY, color: o.color || t.text, bulletColor: o.bulletColor || o.color || t.text, shape: o.bulletShape || 'dot' }));
}

function certificates(flow, cv, t, o = {}) {
  cv.certificates.forEach((c) => {
    const doc = flow.doc;
    const yearW = c.year ? 46 : 0;
    flow.text(c.name, { font: t.fonts.semibold, size: BODY, color: o.color || t.text, width: flow.width - yearW, advance: false });
    if (c.year) doc.font(t.fonts.regular).fontSize(8.6).fillColor(o.yearColor || t.muted).text(c.year, flow.x + flow.width - yearW, flow.y, { width: yearW, align: 'right', lineBreak: false });
    flow.space(flow.measure(c.name, { font: t.fonts.semibold, size: BODY, width: flow.width - yearW }) + 5);
  });
}

function paragraph(flow, text, t, o = {}) {
  String(text).split(/\n{2,}/).forEach((para, i) => {
    if (i) flow.space(4);
    para.split(/\n/).forEach((line) => flow.text(line, { font: t.fonts.regular, size: o.size || BODY + 0.2, color: o.color || t.text, lineGap: 2 }));
  });
}

// Approximate height of a short section, so it is kept on one page when possible.
function compactHeight(cv, key) {
  const rows = { skills: cv.skills.length, languages: cv.languages.length * 1.6, certificates: cv.certificates.length, qualities: Math.ceil(cv.qualities.length / 2) * 1.3, interests: Math.ceil(cv.interests.length / 2) * 1.3 }[key];
  return rows === undefined ? 0 : Math.min(rows * 16, 220);
}

// Renders the given section keys (in the person's order) with the template's options.
function renderSections(flow, cv, keys, t, o) {
  sectionsFor(cv, keys).forEach((key, i) => {
    if (i) flow.space(o.sectionGap || 14);
    const keep = compactHeight(cv, key);
    if (keep) flow.ensure(keep + 36); // short lists are not split across pages
    o.title(flow, key, labelOf(cv, key));
    switch (key) {
      case 'summary': paragraph(flow, cv.summary, t, o.paragraph); break;
      case 'experiences': entries(flow, cv.experiences, 'experiences', t, o.entries); break;
      case 'educations': entries(flow, cv.educations, 'educations', t, o.entries); break;
      case 'skills': skills(flow, cv, t, o.skills); break;
      case 'languages': languages(flow, cv, t, o.languages); break;
      case 'qualities': list(flow, cv.qualities, t, o.list); break;
      case 'interests': list(flow, cv.interests, t, o.list); break;
      case 'certificates': certificates(flow, cv, t, o.certificates); break;
      case 'custom': paragraph(flow, cv.custom.text, t, o.paragraph); break;
      default:
    }
  });
}

// Contact lines with icons (email, phone, address, nationality, website, license).
function contactItems(cv) {
  const p = cv.personal;
  return [['mail', p.email], ['phone', p.phone], ['pin', p.address], ['flag', p.nationality ? `Nationalité : ${p.nationality}` : ''], ['link', p.website], ['car', p.license ? `Permis ${p.license.replace(/^permis\s*/i, '')}` : '']].filter(([, v]) => v);
}

function contacts(flow, cv, t, o = {}) {
  contactItems(cv).forEach(([ic, value]) => {
    const w = flow.width - 16;
    const h = flow.measure(value, { font: t.fonts.regular, size: o.size || 8.6, width: w });
    flow.ensure(h + 5);
    L.icon(flow.doc, ic, flow.x, flow.y + 0.6, 9, o.iconColor || t.color);
    flow.text(value, { font: t.fonts.regular, size: o.size || 8.6, color: o.color || t.text, x: flow.x + 16, width: w });
    flow.space(5);
  });
}

function fullName(cv) {
  const n = `${cv.personal.firstName} ${cv.personal.lastName}`.trim();
  return n || 'Prénom Nom';
}

module.exports = { compactHeight, BODY, sectionsFor, labelOf, entries, skills, languages, list, twoColumns, certificates, paragraph, renderSections, contactItems, contacts, fullName };
