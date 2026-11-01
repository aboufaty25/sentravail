const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class Comment extends Model {}

Comment.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    authorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    parentCommentId: { type: DataTypes.INTEGER.UNSIGNED },
    text: { type: DataTypes.TEXT, allowNull: false },
    likesCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  },
  {
    sequelize,
    modelName: 'Comment',
    tableName: 'comments',
    indexes: [{ fields: ['postId', 'parentCommentId', 'createdAt'] }],
  }
);

module.exports = Comment;
