const { addColumnIfMissing } = require('../config/migrate');

// Phase 9: users can turn notification emails off.
module.exports.up = async (qi, DataTypes) => {
  await addColumnIfMissing(qi, 'users', 'emailNotifications', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
};
