const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class Follow extends Model {}

Follow.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    followerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    followingId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  },
  {
    sequelize,
    modelName: 'Follow',
    tableName: 'follows',
    indexes: [{ unique: true, fields: ['followerId', 'followingId'] }, { fields: ['followingId', 'createdAt'] }],
  }
);

module.exports = Follow;
