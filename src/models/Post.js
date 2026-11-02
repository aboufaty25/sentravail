const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');
const jsonColumn = require('../utils/jsonColumn');

// 'text' and 'photo' are legacy free posts (hidden); see config/postTypes.js.
const POST_TYPES = ['job', 'job_search', 'event', 'hired', 'advice', 'share', 'text', 'photo'];
const VISIBILITIES = ['network', 'public'];
const STATUSES = ['published', 'pending_approval', 'rejected'];
// "À la une" request workflow, independent from visibility: a recruiter's job stays
// visible to their network while the admin reviews the featuring request.
const FEATURE_STATUSES = ['none', 'pending', 'approved', 'rejected'];

class Post extends Model {}

Post.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    authorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    type: { type: DataTypes.ENUM(...POST_TYPES), allowNull: false },
    title: { type: DataTypes.STRING(160) }, // métier, event title, job obtained, advice title
    city: { type: DataTypes.STRING(80) },
    eventDate: { type: DataTypes.DATE },
    details: jsonColumn('details', {}), // type-specific fields (experience, availability, kind, place, company…)
    text: { type: DataTypes.TEXT },
    mediaUrls: jsonColumn('mediaUrls'),
    visibility: { type: DataTypes.ENUM(...VISIBILITIES), allowNull: false, defaultValue: 'public' },
    status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'published' },
    isFeatured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    featuredUntil: { type: DataTypes.DATE },
    featureStatus: { type: DataTypes.ENUM(...FEATURE_STATUSES), allowNull: false, defaultValue: 'none' },
    featureRejectReason: { type: DataTypes.STRING(300) },
    likesCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    commentsCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    sharesCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    savesCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    viewsCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    score: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    sharedPostId: { type: DataTypes.INTEGER.UNSIGNED },
  },
  {
    sequelize,
    modelName: 'Post',
    tableName: 'posts',
    indexes: [
      { fields: ['status', 'score'] },
      { fields: ['authorId', 'createdAt'] },
      { fields: ['isFeatured', 'featuredUntil'] },
      { fields: ['type', 'status', 'createdAt'] },
      { fields: ['createdAt'] },
      { fields: ['sharedPostId'] },
      // (type, eventDate) index is created by migration 006
    ],
  }
);

Post.TYPES = POST_TYPES;
Post.VISIBILITIES = VISIBILITIES;
Post.FEATURE_STATUSES = FEATURE_STATUSES;
module.exports = Post;
