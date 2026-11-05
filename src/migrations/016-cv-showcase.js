const { addColumnIfMissing } = require('../config/migrate');

// CV showcase ("Vitrine des CV"): the member's consent to be shown. The cv_showcase table
// itself is created by sequelize.sync() at startup (new table, nothing to alter).
module.exports.up = async (qi, DataTypes) => {
  await addColumnIfMissing(qi, 'users', 'cvShowcase', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
};
