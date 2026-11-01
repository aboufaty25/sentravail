const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class Save extends Model {}

Save.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  },
  {
    sequelize,
    modelName: 'Save',
    tableName: 'saves',
    indexes: [{ unique: true, fields: ['userId', 'postId'] }, { fields: ['userId', 'createdAt'] }],
  }
);

module.exports = Save;
