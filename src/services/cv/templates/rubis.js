// Rubis: white main column, full-height colored column on the right (model 1).
const L = require('../layout');
const C = require('./common');

const SIDE_X = 372;

module.exports = {
  chrome(doc, t) {
    doc.save().rect(SIDE_X, 0, L.PAGE.width - SIDE_X, L.PAGE.height).fill(t.color).restore();
  },
  render(doc, cv, t, photo) {
    const W = L.PAGE.width;
    const main = new L.Flow(doc, { x: 38, width: SIDE_X - 38 - 26, top: 44, bottom: L.PAGE.height - 40, topNext: 40 });
    main.text(C.fullName(cv).toUpperCase(), { font: t.fonts.heading, size: 25, color: t.color, lineGap: 0 });
    if (cv.title) { main.space(3); main.text(cv.title, { font: t.fonts.semibold, size: 12, color: t.dark }); }
    main.space(8);
    doc.save().moveTo(main.x, main.y).lineTo(main.x + main.width, main.y).lineWidth(0.8).strokeColor(t.dark).stroke().restore();
    main.space(16);
    const title = (flow, key, label) => {
      flow.ensure(40);
      flow.text(label.toUpperCase(), { font: t.fonts.bold, size: 10.2, color: t.color, characterSpacing: 0.3 });
      flow.space(3);
      doc.save().moveTo(flow.x, flow.y).lineTo(flow.x + flow.width, flow.y).lineWidth(0.9).strokeColor(t.color).stroke().restore();
      flow.space(8);
    };
    C.renderSections(main, cv, ['summary', 'experiences', 'educations', 'certificates', 'custom'], t, { title, entries: { dateColor: t.color, subColor: t.muted }, list: {} });

    // Right column (white on color)
    const side = new L.Flow(doc, { x: SIDE_X + 22, width: W - SIDE_X - 44, top: 42, bottom: L.PAGE.height - 36, topNext: 40 });
    side.focus();
    const white = '#ffffff';
    const soft = L.tint(t.color, 0.82);
    if (photo) {
      const size = 104;
      if (L.photo(doc, photo, side.x + (side.width - size) / 2, side.y, size, { ring: white, ringWidth: 3 })) side.space(size + 18);
    }
    const sTheme = { ...t, text: white, muted: soft, dark: white };
    C.contacts(side, cv, sTheme, { iconColor: white, color: white, size: 8.4 });
    side.space(12);
    const sideTitle = (flow, key, label) => {
      flow.ensure(36);
      flow.text(label.toUpperCase(), { font: t.fonts.bold, size: 10, color: white, characterSpacing: 0.4 });
      flow.space(6);
    };
    C.renderSections(side, cv, ['skills', 'qualities', 'interests', 'languages'], sTheme, {
      title: sideTitle,
      sectionGap: 16,
      skills: { color: white, bulletColor: white, accent: white, track: L.shade(t.color, 0.28), levelStyle: 'bars' },
      languages: { color: white, accent: white, track: L.shade(t.color, 0.28), levelColor: soft },
      list: { color: white, bulletColor: white },
    });
  },
};
