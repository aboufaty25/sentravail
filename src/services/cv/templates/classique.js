// Classique: one column, refined serif, round photo at the top right (model 3).
const L = require('../layout');
const C = require('./common');

module.exports = {
  chrome() {},
  render(doc, cv, t, photo) {
    const W = L.PAGE.width;
    const flow = new L.Flow(doc, { x: 48, width: W - 96, top: 46, bottom: L.PAGE.height - 42, topNext: 42 });
    const photoSize = 72;
    const hasPhoto = photo && L.photo(doc, photo, flow.x + flow.width - photoSize, flow.y - 4, photoSize, { ring: t.color, ringWidth: 2 });
    const headW = flow.width - (hasPhoto ? photoSize + 16 : 0);
    const top = flow.y;
    flow.text(C.fullName(cv), { font: t.fonts.heading, size: 23, color: t.color, width: headW, lineGap: 0 });
    if (cv.title) { flow.space(2); flow.text(cv.title, { font: t.fonts.italic, size: 11, color: t.color, width: headW }); }
    flow.space(6);
    const contact = C.contactItems(cv).map(([, v]) => v).join('   •   ');
    if (contact) flow.text(contact, { font: t.fonts.regular, size: 8.2, color: t.muted, width: headW, lineGap: 2 });
    flow.y = Math.max(flow.y, hasPhoto ? top + photoSize - 2 : 0) + 10;
    doc.save().moveTo(flow.x, flow.y).lineTo(flow.x + flow.width, flow.y).lineWidth(1.2).strokeColor(t.color).stroke().restore();
    flow.space(14);
    const title = (f, key, label) => {
      f.ensure(38);
      f.text(label.toUpperCase(), { font: t.fonts.bold, size: 9.4, color: t.color, characterSpacing: 0.9 });
      f.space(2);
      doc.save().moveTo(f.x, f.y).lineTo(f.x + f.width, f.y).lineWidth(0.7).strokeColor(t.color).stroke().restore();
      f.space(8);
    };
    C.renderSections(flow, cv, ['summary', 'experiences', 'educations', 'skills', 'languages', 'certificates', 'qualities', 'interests', 'custom'], t, {
      title,
      sectionGap: 13,
      entries: { dateColor: t.muted, subColor: t.color },
      skills: { levelStyle: 'levelText', plainStyle: 'inline' },
      languages: { style: 'levelRight' },
      list: { style: 'inline' },
    });
  },
};
