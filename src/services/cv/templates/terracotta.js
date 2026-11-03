// Terracotta: soft left column with round photo and pill titles, timeline in the main column (model 2).
const L = require('../layout');
const C = require('./common');

const SIDE_W = 188;

function pill(flow, label, t) {
  const doc = flow.doc;
  doc.font(t.fonts.bold).fontSize(8.6);
  const w = doc.widthOfString(label) + 20;
  flow.ensure(40);
  doc.save().roundedRect(flow.x, flow.y, w, 16, 8).fill(t.color).restore();
  doc.font(t.fonts.bold).fontSize(8.6).fillColor('#ffffff').text(label, flow.x + 10, flow.y + 4, { lineBreak: false });
  flow.space(24);
}

module.exports = {
  chrome(doc, t) {
    const H = L.PAGE.height;
    const W = L.PAGE.width;
    doc.save();
    doc.rect(0, 0, SIDE_W, H).fill(L.tint(t.color, 0.9));
    doc.circle(18, 10, 62).fill(L.tint(t.color, 0.72));
    doc.circle(W - 8, H - 70, 50).fill(L.tint(t.color, 0.8));
    doc.circle(W - 70, H + 26, 70).fill(L.tint(t.color, 0.84));
    doc.restore();
  },
  render(doc, cv, t, photo) {
    const W = L.PAGE.width;
    const H = L.PAGE.height;
    // Left column
    const side = new L.Flow(doc, { x: 20, width: SIDE_W - 40, top: 40, bottom: H - 36, topNext: 40 });
    if (photo) {
      const size = 106;
      if (L.photo(doc, photo, (SIDE_W - size) / 2, side.y, size, { ring: '#ffffff', ringWidth: 4 })) side.space(size + 16);
    } else {
      side.space(36); // clear of the decorative circle
    }
    side.text(C.fullName(cv), { font: t.fonts.heading, size: 16, color: t.color, align: 'center', lineGap: 0 });
    side.space(14);
    pill(side, 'Contact', t);
    C.contacts(side, cv, t, { size: 8, iconColor: t.color });
    side.space(10);
    C.renderSections(side, cv, ['skills', 'qualities', 'interests', 'languages'], t, {
      title: (flow, key, label) => pill(flow, label, t),
      sectionGap: 12,
      skills: { bulletColor: t.color, plainStyle: 'bullets', levelStyle: 'bars' },
      languages: { style: 'levelRight' },
      list: { bulletColor: t.color },
    });

    // Main column
    const main = new L.Flow(doc, { x: SIDE_W + 24, width: W - SIDE_W - 24 - 36, top: 44, bottom: H - 40, topNext: 40 });
    main.focus();
    main.text(cv.title || C.fullName(cv), { font: t.fonts.heading, size: 21, color: t.color, lineGap: 0 });
    main.space(10);
    if (cv.summary) {
      C.paragraph(main, cv.summary, t);
      main.space(14);
    }
    C.renderSections(main, cv, ['experiences', 'educations', 'certificates', 'custom'], t, {
      title: (flow, key, label) => pill(flow, label, t),
      entries: { layout: 'timeline', dateColor: t.color, subColor: t.color },
    });
  },
};
