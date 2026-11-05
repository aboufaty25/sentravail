const { addColumnIfMissing } = require('../config/migrate');

// CV showcase: no prior consent any more (announced in the Terms and the Privacy policy); the
// admin may show any CV created or imported on the site, and a member may refuse at any time.
// The older users.cvShowcase column (consent) is no longer used.
module.exports.up = async (qi, DataTypes) => {
  await addColumnIfMissing(qi, 'users', 'cvShowcaseRefused', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
};
