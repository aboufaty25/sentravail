const { addColumnIfMissing } = require('../config/migrate');

// CV showcase: images (cards, viewer) now have contact details blacked out when rendered.
// Images made before are not trusted for imported PDFs until regenerated on the admin page.
module.exports.up = async (qi, DataTypes) => {
  await addColumnIfMissing(qi, 'cv_showcase', 'masked', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
};
