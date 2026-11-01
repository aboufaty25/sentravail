const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

const STATUSES = ['opened_mail', 'confirmed_sent', 'viewed', 'shortlisted', 'rejected'];

class Application extends Model {}

Application.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    // Job post; set to NULL if the offer is deleted (the snapshot below keeps the history readable).
    jobPostId: { type: DataTypes.INTEGER.UNSIGNED },
    jobTitle: { type: DataTypes.STRING(120), allowNull: false },
    companyName: { type: DataTypes.STRING(120), allowNull: false },
    jobSlug: { type: DataTypes.STRING(120) },
    recruiterId: { type: DataTypes.INTEGER.UNSIGNED },
    candidateId: { type: DataTypes.INTEGER.UNSIGNED }, // null for guests
    firstName: { type: DataTypes.STRING(60), allowNull: false },
    lastName: { type: DataTypes.STRING(60), allowNull: false },
    email: { type: DataTypes.STRING(190), allowNull: false },
    phone: { type: DataTypes.STRING(20), allowNull: false },
    cvKey: { type: DataTypes.STRING(120), allowNull: false }, // private file key (see services/cvStorage)
    cvName: { type: DataTypes.STRING(160) },
    message: { type: DataTypes.TEXT },
    status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'opened_mail' },
    sentVia: { type: DataTypes.ENUM('mailto', 'server') },
    sentAt: { type: DataTypes.DATE },
  },
  {
    sequelize,
    modelName: 'Application',
    tableName: 'applications',
    indexes: [
      { fields: ['jobPostId', 'createdAt'] },
      { fields: ['candidateId', 'createdAt'] },
      { fields: ['recruiterId'] },
      { fields: ['email', 'jobPostId'] },
    ],
  }
);

Application.STATUSES = STATUSES;
Application.STATUS_LABELS = {
  opened_mail: { candidate: 'Email à confirmer', recruiter: 'Email non confirmé', color: 'bg-amber-100 text-amber-800' },
  confirmed_sent: { candidate: 'Envoyée', recruiter: 'Nouvelle', color: 'bg-brand-100 text-brand-800' },
  viewed: { candidate: 'Vue par le recruteur', recruiter: 'Vue', color: 'bg-gray-200 text-gray-700' },
  shortlisted: { candidate: 'Présélectionné(e) 🎉', recruiter: 'Présélectionnée', color: 'bg-green-100 text-green-800' },
  rejected: { candidate: 'Non retenue', recruiter: 'Refusée', color: 'bg-red-100 text-red-700' },
};
module.exports = Application;
