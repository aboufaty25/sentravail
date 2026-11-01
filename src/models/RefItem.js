const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// Admin-managed reference values (cities and sectors).
class RefItem extends Model {}

RefItem.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    kind: { type: DataTypes.ENUM('city', 'sector'), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  { sequelize, modelName: 'RefItem', tableName: 'ref_items', indexes: [{ unique: true, fields: ['kind', 'name'] }] }
);

module.exports = RefItem;
