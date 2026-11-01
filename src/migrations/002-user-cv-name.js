const { addColumnIfMissing } = require('../config/migrate');

// Phase 4: original file name of the CV imported on the profile.
module.exports.up = async (qi, DataTypes) => {
  await addColumnIfMissing(qi, 'users', 'cvName', { type: DataTypes.STRING(160) });
};
