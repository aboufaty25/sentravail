// Horizon: colored bands at the top and bottom, grey left column with photo (model 7).
const L = require('../layout');
const C = require('./common');

const BAND = 30;
const COL_X = 40;
const COL_W = 168;

module.exports = {
  chrome(doc, t, pageIndex) {
    const W = L.PAGE.width;
    const H = L.PAGE.height;
    doc.save();
    doc.rect(0, 0, W, BAND).fill(t.color);
    doc.rect(0, H - BAND, W, BAND).fill(t.color);
    const colTop = pageIndex === 0 ? 124 : BAND + 22;
    doc.rect(COL_X, colTop, COL_W, H - BAND - 22 - colTop).fill('#f3f4f6');
    doc.restore();
  },
  render(doc, cv, t, photo) {
    const W = L.PAGE.width;
    const H = L.PAGE.height;
    const head = new L.Flow(doc, { x: COL_X, width: W - 2 * COL_X, top: BAND + 26, bottom: H, topNext: BAND + 26 });
    head.text(C.fullName(cv), { font: t.fonts.heading, size: 25, color: t.color, lineGap: 0, width: head.width });
    if (cv.title) head.text(cv.title, { font: t.fonts.medium, size: 11.5, color: t.dark });
    const ruleY = 112;
    doc.save().moveTo(COL_X, ruleY).lineTo(W - COL_X, ruleY).lineWidth(0.6).strokeColor('#e5e7eb').stroke().restore();

    // Left column
    const side = new L.Flow(doc, { x: COL_X + 14, width: COL_W - 28, top: 138, bottom: H - BAND - 34, topNext: BAND + 36 });
    if (photo) {
      const size = side.width;
      if (L.photo(doc, photo, side.x, side.y, size, { shape: 'square', radius: 0 })) side.space(size + 14);
    }
    const sideTitle = (f, key, label) => {
      f.ensure(40);
      f.text(label, { font: t.fonts.heading, size: 13, color: t.color, lineGap: 0 });
      f.space(4);
      doc.save().moveTo(f.x, f.y).lineTo(f.x + f.width, f.y).lineWidth(0.6).strokeColor('#d1d5db').stroke().restore();
      f.space(9);
    };
    const p = cv.personal;
    const rows = [['Nom', C.fullName(cv)], ['Adresse e-mail', p.email], ['Téléphone', p.phone], ['Adresse', p.address], ['Nationalité', p.nationality], ['Site internet', p.website], ['Permis', p.license]].filter(([, v]) => v);
    sideTitle(side, 'info', 'Informations personnelles');
    rows.forEach(([k, v]) => {
      side.text(k, { font: t.fonts.bold, size: 8.6, color: t.dark, keep: 12 });
      side.text(v, { font: t.fonts.regular, size: 8.6, color: t.text });
      side.space(6);
    });
    side.space(8);
    C.renderSections(side, cv, ['languages', 'interests', 'qualities'], t, {
      title: sideTitle,
      sectionGap: 12,
      languages: { style: 'dots' },
      list: { style: 'bullets', bulletShape: 'square', bulletColor: t.color },
    });

    // Main column
    const main = new L.Flow(doc, { x: COL_X + COL_W + 22, width: W - COL_X - COL_W - 22 - COL_X, top: 138, bottom: H - BAND - 34, topNext: BAND + 36 });
    main.focus();
    const title = (f, key, label) => {
      f.ensure(42);
      f.text(label, { font: t.fonts.heading, size: 15, color: t.color, lineGap: 0 });
      f.space(4);
      doc.save().moveTo(f.x, f.y).lineTo(f.x + f.width, f.y).lineWidth(0.6).strokeColor('#e5e7eb').stroke().restore();
      f.space(10);
    };
    C.renderSections(main, cv, ['summary', 'educations', 'experiences', 'skills', 'certificates', 'custom'], t, {
      title,
      entries: { dateColor: t.color, subColor: t.color, subFont: t.fonts.regular },
      skills: { levelStyle: 'dots', plainStyle: 'bullets', bulletShape: 'square', bulletColor: t.color },
    });
  },
};
