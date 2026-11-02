const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');
const { CONTRACT_TYPES } = require('../config/constants');

// Job offer details, 1:1 with a Post of type "job".
class Job extends Model {
  get isExpired() {
    if (!this.deadline) return false;
    return new Date(`${this.deadline}T23:59:59Z`).getTime() < Date.now();
  }

  get url() {
    return `/offres/${this.slug}`;
  }
}

Job.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
    slug: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    title: { type: DataTypes.STRING(120), allowNull: false },
    companyName: { type: DataTypes.STRING(120), allowNull: false },
    companyLogo: { type: DataTypes.STRING(500) },
    // Offer image (poster/visual) chosen at publication: shown large in the feed and in link previews.
    image: { type: DataTypes.STRING(500) },
    location: { type: DataTypes.STRING(80), allowNull: false },
    contractType: { type: DataTypes.ENUM(...CONTRACT_TYPES), allowNull: false },
    sector: { type: DataTypes.STRING(80), allowNull: false },
    salary: { type: DataTypes.STRING(80) },
    description: { type: DataTypes.TEXT, allowNull: false },
    requirements: { type: DataTypes.TEXT },
    benefits: { type: DataTypes.TEXT },
    // How candidates apply: 'email' (modal on SenTravail, sent to applyEmail) or 'link' (external applyUrl).
    applyMode: { type: DataTypes.ENUM('email', 'link'), allowNull: false, defaultValue: 'email' },
    applyEmail: { type: DataTypes.STRING(190) },
    applyUrl: { type: DataTypes.STRING(500) },
    deadline: { type: DataTypes.DATEONLY },
    isOfficial: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: 'Job',
    tableName: 'jobs',
    indexes: [{ fields: ['location'] }, { fields: ['sector'] }, { fields: ['contractType'] }, { fields: ['deadline'] }],
  }
);

module.exports = Job;
