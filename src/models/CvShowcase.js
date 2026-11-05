const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

// "Vitrine des CV": CVs chosen by the admin and shown in the CV slider (feed, offer pages)
// and the full-screen viewer (/cv/vitrine). Static documents, never video.
// - source 'built': CV made with the builder; a copy WITHOUT email, phone and address is stored.
// - source 'file': a PDF (the member's imported CV, or a CV the admin uploads with consent).
// The PDF lives in private storage (cvKey) and is served only while the item is shown.
class CvShowcase extends Model {}

CvShowcase.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }, // member who owns the CV (null: added by the admin)
    source: { type: DataTypes.ENUM('built', 'file'), allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    title: { type: DataTypes.STRING(120) },
    city: { type: DataTypes.STRING(80) },
    cvKey: { type: DataTypes.STRING(120), allowNull: false },
    thumbnail: { type: DataTypes.STRING(500) }, // small first-page image (cards)
    image: { type: DataTypes.STRING(500) }, // large first-page image (viewer)
    color: { type: DataTypes.STRING(7) }, // fallback card colour (template colour)
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    viewsCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    createdById: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  },
  {
    sequelize,
    modelName: 'CvShowcase',
    tableName: 'cv_showcase',
    indexes: [{ fields: ['isActive', 'sortOrder'] }, { fields: ['userId'] }],
  }
);

module.exports = CvShowcase;
