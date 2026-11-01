const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');
const jsonColumn = require('../utils/jsonColumn');

const POST_TYPES = ['text', 'photo', 'reel', 'job'];
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
    type: { type: DataTypes.ENUM(...POST_TYPES), allowNull: false, defaultValue: 'text' },
    text: { type: DataTypes.TEXT },
    mediaUrls: jsonColumn('mediaUrls'),
    videoUrl: { type: DataTypes.STRING(500) },
    thumbnailUrl: { type: DataTypes.STRING(500) },
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
    ],
  }
);

Post.TYPES = POST_TYPES;
Post.VISIBILITIES = VISIBILITIES;
Post.FEATURE_STATUSES = FEATURE_STATUSES;
module.exports = Post;
