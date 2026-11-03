// Émeraude: main column with icon titles, light colored column on the right with photo and bars (model 4).
const L = require('../layout');
const C = require('./common');

const SIDE_X = 398;
const ICONS = { summary: 'user', experiences: 'briefcase', educations: 'cap', certificates: 'award', custom: 'star' };

module.exports = {
  chrome(doc, t) {
    doc.save().rect(SIDE_X, 0, L.PAGE.width - SIDE_X, L.PAGE.height).fill(L.tint(t.color, 0.9)).restore();
  },
  render(doc, cv, t, photo) {
    const W = L.PAGE.width;
    const H = L.PAGE.height;
    const main = new L.Flow(doc, { x: 36, width: SIDE_X - 36 - 26, top: 44, bottom: H - 40, topNext: 40 });
    main.text(C.fullName(cv), { font: t.fonts.heading, size: 24, color: t.color, lineGap: 0 });
    if (cv.title) { main.space(3); main.text(cv.title, { font: t.fonts.medium, size: 12, color: t.dark }); }
    main.space(18);
    const title = (flow, key, label) => {
      flow.ensure(40);
      L.icon(doc, ICONS[key] || 'star', flow.x, flow.y + 0.5, 10, t.color);
      flow.text(label.toUpperCase(), { font: t.fonts.bold, size: 9.6, color: t.color, x: flow.x + 16, width: flow.width - 16, characterSpacing: 0.6 });
      flow.space(3);
      doc.save().rect(flow.x, flow.y, 30, 2).fill(t.color).restore();
      flow.space(9);
    };
    C.renderSections(main, cv, ['summary', 'experiences', 'educations', 'certificates', 'custom'], t, { title, entries: { dateColor: t.color, subColor: t.muted } });

    const side = new L.Flow(doc, { x: SIDE_X + 18, width: W - SIDE_X - 36, top: 40, bottom: H - 36, topNext: 40 });
    side.focus();
    if (photo) {
      const size = 92;
      if (L.photo(doc, photo, side.x + (side.width - size) / 2, side.y, size, { ring: '#ffffff', ringWidth: 3 })) side.space(size + 16);
    }
    const sideTitle = (flow, key, label) => {
      flow.ensure(34);
      flow.text(label.toUpperCase(), { font: t.fonts.bold, size: 8, color: t.color, characterSpacing: 0.8 });
      flow.space(6);
    };
    sideTitle(side, 'contact', 'Informations');
    C.contacts(side, cv, t, { size: 8.2 });
    side.space(10);
    C.renderSections(side, cv, ['skills', 'languages', 'qualities', 'interests'], t, {
      title: sideTitle,
      sectionGap: 14,
      skills: { levelStyle: 'bars', track: L.tint(t.color, 0.72) },
      languages: { style: 'bars', track: L.tint(t.color, 0.72) },
      list: { bulletColor: t.color },
    });
  },
};
