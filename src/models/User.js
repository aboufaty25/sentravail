const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');
const jsonColumn = require('../utils/jsonColumn');

const ROLES = ['candidate', 'recruiter', 'admin'];

class User extends Model {
  get fullName() {
    return `${this.firstName} ${this.lastName}`.trim();
  }

  get initials() {
    return require('../utils/viewHelpers').initialsOf(this.firstName, this.lastName);
  }

  get displayName() {
    return this.role === 'recruiter' && this.companyName ? this.companyName : this.fullName;
  }

  hasRole(...roles) {
    return roles.includes(this.role);
  }

  // Fields that are safe to expose in views and JSON.
  toPublicJSON() {
    const { passwordHash, resetTokenHash, resetTokenExpires, email, phone, googleId, appleId, ...rest } = this.get({ plain: true });
    return rest;
  }
}

User.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING(60), allowNull: false, unique: true },
    firstName: { type: DataTypes.STRING(60), allowNull: false },
    lastName: { type: DataTypes.STRING(60), allowNull: false },
    email: { type: DataTypes.STRING(190), allowNull: false, unique: true },
    phone: { type: DataTypes.STRING(20), allowNull: true, unique: true },
    passwordHash: { type: DataTypes.STRING(100), allowNull: false }, // random for Google/Apple-only accounts
    googleId: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    appleId: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    role: { type: DataTypes.ENUM(...ROLES), allowNull: false, defaultValue: 'candidate' },
    avatarUrl: { type: DataTypes.STRING(500) },
    coverUrl: { type: DataTypes.STRING(500) },
    headline: { type: DataTypes.STRING(160) },
    bio: { type: DataTypes.TEXT },
    city: { type: DataTypes.STRING(80) },
    sector: { type: DataTypes.STRING(80) },
    skills: jsonColumn('skills'),
    experiences: jsonColumn('experiences'),
    educations: jsonColumn('educations'),
    languages: jsonColumn('languages'),
    cvUrl: { type: DataTypes.STRING(500) }, // key of the imported CV (private storage)
    cvName: { type: DataTypes.STRING(160) },
    cvBuilt: jsonColumn('cvBuilt', null),
    companyName: { type: DataTypes.STRING(120) },
    companyLogo: { type: DataTypes.STRING(500) },
    isVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isBanned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    followersCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    followingCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    resetTokenHash: { type: DataTypes.STRING(64) },
    resetTokenExpires: { type: DataTypes.DATE },
    lastLoginAt: { type: DataTypes.DATE },
    emailNotifications: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // Recruiter verification request (NINEA, RCCM or professional email), validated by an admin.
    verificationStatus: { type: DataTypes.ENUM('none', 'pending', 'approved', 'rejected'), allowNull: false, defaultValue: 'none' },
    verificationMethod: { type: DataTypes.ENUM('ninea', 'rccm', 'email') },
    verificationValue: { type: DataTypes.STRING(190) },
    verificationEmailConfirmed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    verificationTokenHash: { type: DataTypes.STRING(64) },
    verificationNote: { type: DataTypes.STRING(300) },
    verificationRequestedAt: { type: DataTypes.DATE },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    indexes: [{ fields: ['role'] }, { fields: ['city'] }],
  }
);

User.ROLES = ROLES;
module.exports = User;
