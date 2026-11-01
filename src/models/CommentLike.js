const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class CommentLike extends Model {}

CommentLike.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    commentId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  },
  {
    sequelize,
    modelName: 'CommentLike',
    tableName: 'comment_likes',
    indexes: [{ unique: true, fields: ['userId', 'commentId'] }],
  }
);

module.exports = CommentLike;
