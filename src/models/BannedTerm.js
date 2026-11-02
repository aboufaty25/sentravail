const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// Anti-scam filter terms (admin-editable). Matching is accent- and case-insensitive.
class BannedTerm extends Model {}

BannedTerm.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    term: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  { sequelize, modelName: 'BannedTerm', tableName: 'banned_terms' }
);

BannedTerm.DEFAULTS = ['frais de dossier', 'paiement', 'payer', 'investissement', 'argent facile', 'Wave', 'Orange Money', 'dépôt'];
module.exports = BannedTerm;
