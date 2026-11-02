const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');
const jsonColumn = require('../utils/jsonColumn');

const TYPES = [
  'like', 'comment', 'reply', 'follow', 'share',
  'application', 'application_status', 'job_approved', 'job_rejected', 'new_job_from_followed',
  'post_approved', 'post_rejected', 'verification_approved', 'verification_rejected',
];

class Notification extends Model {}

Notification.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, // recipient
    actorId: { type: DataTypes.INTEGER.UNSIGNED },
    type: { type: DataTypes.ENUM(...TYPES), allowNull: false },
    postId: { type: DataTypes.INTEGER.UNSIGNED },
    applicationId: { type: DataTypes.INTEGER.UNSIGNED },
    count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 }, // grouped actors ("X et 3 autres")
    data: jsonColumn('data', {}),
    seen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // badge
    read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // highlight until opened
  },
  {
    sequelize,
    modelName: 'Notification',
    tableName: 'notifications',
    indexes: [{ fields: ['userId', 'seen'] }, { fields: ['userId', 'createdAt'] }, { fields: ['userId', 'type', 'postId', 'read'] }],
  }
);

Notification.TYPES = TYPES;
module.exports = Notification;
