const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// Admin-managed site settings (branding: logo, app icon, default share image…).
class SiteSetting extends Model {}

SiteSetting.init(
  {
    key: { type: DataTypes.STRING(60), primaryKey: true },
    value: { type: DataTypes.TEXT },
  },
  { sequelize, modelName: 'SiteSetting', tableName: 'site_settings' }
);

module.exports = SiteSetting;
