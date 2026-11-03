const { addColumnIfMissing } = require('../config/migrate');

// "Continuer avec Google / Apple": provider account ids.
module.exports.up = async (qi, DataTypes) => {
  await addColumnIfMissing(qi, 'users', 'googleId', { type: DataTypes.STRING(64), allowNull: true, unique: true });
  await addColumnIfMissing(qi, 'users', 'appleId', { type: DataTypes.STRING(64), allowNull: true, unique: true });
};
