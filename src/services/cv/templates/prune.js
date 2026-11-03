// Prune: big uppercase name, photo at the top right, titles as colored labels (model 6).
const L = require('../layout');
const C = require('./common');

module.exports = {
  chrome() {},
  render(doc, cv, t, photo) {
    const W = L.PAGE.width;
    const flow = new L.Flow(doc, { x: 40, width: W - 80, top: 42, bottom: L.PAGE.height - 40, topNext: 42 });
    const photoSize = 84;
    const hasPhoto = photo && L.photo(doc, photo, flow.x + flow.width - photoSize, flow.y, photoSize, { shape: 'square', radius: 3 });
    const headW = flow.width - (hasPhoto ? photoSize + 18 : 0);
    const top = flow.y;
    flow.space(hasPhoto ? 18 : 4);
    flow.text(C.fullName(cv).toUpperCase(), { font: t.fonts.heading, size: 28, color: t.color, width: headW, lineGap: 0 });
    if (cv.title) { flow.space(4); flow.text(cv.title, { font: t.fonts.semibold, size: 12, color: t.dark, width: headW }); }
    flow.y = Math.max(flow.y, hasPhoto ? top + photoSize : 0) + 14;
    doc.save().rect(flow.x, flow.y, flow.width, 4).fill(t.color).restore();
    flow.space(18);
    const label = (f, key, text) => {
      f.ensure(44);
      doc.font(t.fonts.semibold).fontSize(12);
      const w = doc.widthOfString(text.toUpperCase()) + 16;
      doc.save().rect(f.x, f.y, Math.min(w, f.width), 20).fill(t.color).restore();
      doc.font(t.fonts.semibold).fontSize(12).fillColor('#ffffff').text(text.toUpperCase(), f.x + 8, f.y + 3.6, { lineBreak: false });
      f.space(28);
    };
    const contact = C.contactItems(cv).map(([, v]) => v);
    if (contact.length) {
      label(flow, 'contact', 'Informations personnelles');
      contact.forEach((v) => flow.text(v, { font: t.fonts.regular, size: 9.2, color: t.text }));
      flow.space(14);
    }
    C.renderSections(flow, cv, cv.sectionOrder, t, {
      title: label,
      sectionGap: 14,
      entries: { dateColor: t.dark, dateFont: t.fonts.regular, subColor: t.muted, subFont: t.fonts.regular },
      skills: { levelStyle: 'dots', plainStyle: 'squares2' },
      languages: { style: 'dots' },
      list: { style: 'squares2' },
    });
  },
};
