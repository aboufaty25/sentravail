const { addColumnIfMissing } = require('../config/migrate');

// Offers receive applications either by email or through an external link (company site/form).
module.exports.up = async (qi, DataTypes) => {
  await addColumnIfMissing(qi, 'jobs', 'applyMode', { type: DataTypes.ENUM('email', 'link'), allowNull: false, defaultValue: 'email' });
  await addColumnIfMissing(qi, 'jobs', 'applyUrl', { type: DataTypes.STRING(500), allowNull: true });
  const cols = await qi.describeTable('jobs');
  if (cols.applyEmail && !cols.applyEmail.allowNull) {
    await qi.changeColumn('jobs', 'applyEmail', { type: DataTypes.STRING(190), allowNull: true });
  }
};
