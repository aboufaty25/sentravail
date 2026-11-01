const { addColumnIfMissing } = require('../config/migrate');

// Phase 3: featuring workflow on posts (databases created during Phase 2).
module.exports.up = async (qi, DataTypes) => {
  await addColumnIfMissing(qi, 'posts', 'featureStatus', {
    type: DataTypes.ENUM('none', 'pending', 'approved', 'rejected'),
    allowNull: false,
    defaultValue: 'none',
  });
  await addColumnIfMissing(qi, 'posts', 'featureRejectReason', { type: DataTypes.STRING(300) });
};
