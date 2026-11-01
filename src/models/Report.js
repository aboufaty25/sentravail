const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

const REASONS = {
  scam: 'Fausse offre ou arnaque',
  payment: "Demande d'argent au candidat",
  inappropriate: 'Contenu inapproprié ou choquant',
  harassment: 'Harcèlement ou propos haineux',
  spam: 'Spam ou publicité',
  impersonation: "Usurpation d'identité",
  other: 'Autre',
};

class Report extends Model {}

Report.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    reporterId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    targetType: { type: DataTypes.ENUM('post', 'comment', 'user'), allowNull: false },
    targetId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    targetOwnerId: { type: DataTypes.INTEGER.UNSIGNED }, // author of the reported content / reported user
    reason: { type: DataTypes.ENUM(...Object.keys(REASONS)), allowNull: false },
    details: { type: DataTypes.STRING(500) },
    status: { type: DataTypes.ENUM('open', 'resolved', 'dismissed'), allowNull: false, defaultValue: 'open' },
    resolution: { type: DataTypes.STRING(60) }, // removed, banned, dismissed, restored
    resolvedById: { type: DataTypes.INTEGER.UNSIGNED },
    resolvedAt: { type: DataTypes.DATE },
  },
  {
    sequelize,
    modelName: 'Report',
    tableName: 'reports',
    indexes: [
      { unique: true, fields: ['reporterId', 'targetType', 'targetId'] }, // one report per person and target
      { fields: ['status', 'targetType', 'targetId'] },
    ],
  }
);

Report.REASONS = REASONS;
module.exports = Report;
