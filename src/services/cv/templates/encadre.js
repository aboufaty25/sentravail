// Encadré: centered name, every section in a frame with a colored header band (model 5).
const L = require('../layout');
const C = require('./common');

// Draws a framed section; the frame follows the content across pages.
function framed(flow, label, t, body) {
  const doc = flow.doc;
  const pad = 10;
  flow.ensure(54);
  const startPage = flow.page;
  const startY = flow.y;
  doc.save().rect(flow.x, flow.y, flow.width, 21).fill(t.color).restore();
  doc.font(t.fonts.bold).fontSize(12).fillColor('#ffffff').text(label, flow.x + 8, flow.y + 4.5, { width: flow.width - 16, lineBreak: false });
  flow.space(21 + pad);
  const x0 = flow.x;
  const w0 = flow.width;
  flow.x = x0 + pad + 4;
  flow.width = w0 - 2 * pad - 8;
  body(flow);
  flow.x = x0;
  flow.width = w0;
  flow.space(pad);
  // Frame segments, page by page.
  for (let p = startPage; p <= flow.page; p += 1) {
    doc.switchToPage(p);
    const top = p === startPage ? startY : flow.topNext - 6;
    const bottom = p === flow.page ? flow.y : flow.bottom + 4;
    doc.save().rect(x0, top, w0, bottom - top).lineWidth(0.9).strokeColor(t.color).stroke().restore();
  }
  doc.switchToPage(flow.page);
}

module.exports = {
  chrome() {},
  render(doc, cv, t, photo) {
    const W = L.PAGE.width;
    const flow = new L.Flow(doc, { x: 40, width: W - 80, top: 44, bottom: L.PAGE.height - 40, topNext: 46 });
    flow.text(C.fullName(cv), { font: t.fonts.heading, size: 26, color: t.dark, align: 'center', lineGap: 0 });
    if (cv.title) { flow.space(3); flow.text(cv.title, { font: t.fonts.medium, size: 12, color: t.color, align: 'center' }); }
    flow.space(18);
    const p = cv.personal;
    const rows = [['Adresse e-mail', p.email], ['Téléphone', p.phone], ['Adresse', p.address], ['Nationalité', p.nationality], ['Site internet', p.website], ['Permis', p.license]].filter(([, v]) => v);
    if (rows.length || photo) {
      framed(flow, 'Informations personnelles', t, (f) => {
        const photoSize = 78;
        const top = f.y;
        const hasPhoto = photo && L.photo(doc, photo, f.x + f.width - photoSize, f.y, photoSize, { shape: 'square', radius: 2 });
        const w = f.width - (hasPhoto ? photoSize + 12 : 0);
        rows.forEach(([k, v]) => {
          const h = f.measure(v, { font: t.fonts.regular, size: 9.2, width: w - 150 });
          f.ensure(h + 6);
          doc.font(t.fonts.bold).fontSize(9.2).fillColor(t.dark).text(k, f.x, f.y, { width: 140, lineBreak: false });
          doc.font(t.fonts.regular).fontSize(9.2).fillColor(t.text).text(v, f.x + 150, f.y, { width: w - 150 });
          f.space(h + 6);
        });
        if (hasPhoto) f.y = Math.max(f.y, top + photoSize + 2);
      });
      flow.space(14);
    }
    const keys = C.sectionsFor(cv, cv.sectionOrder);
    keys.forEach((key, i) => {
      if (i) flow.space(14);
      const keep = C.compactHeight(cv, key);
      if (keep) flow.ensure(keep + 50); // short sections stay in one frame
      framed(flow, C.labelOf(cv, key), t, (f) => {
        C.renderSections(f, cv, [key], t, {
          title: () => {},
          entries: { layout: 'dateLeft', dateColumn: 128, subColor: t.color, subFont: t.fonts.regular },
          skills: { levelStyle: 'dots', plainStyle: 'squares2' },
          languages: { style: 'dots' },
          list: { style: 'squares2' },
        });
      });
    });
  },
};
