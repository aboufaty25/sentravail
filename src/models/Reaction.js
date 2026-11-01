const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

const REACTION_TYPES = ['like', 'love', 'bravo', 'support'];

class Reaction extends Model {}

Reaction.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    postId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    type: { type: DataTypes.ENUM(...REACTION_TYPES), allowNull: false, defaultValue: 'like' },
  },
  {
    sequelize,
    modelName: 'Reaction',
    tableName: 'reactions',
    // One reaction per user and per post.
    indexes: [{ unique: true, fields: ['userId', 'postId'] }, { fields: ['postId', 'type'] }],
  }
);

Reaction.TYPES = REACTION_TYPES;
module.exports = Reaction;
