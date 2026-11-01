const sequelize = require('../config/db');
const User = require('./User');
const Post = require('./Post');
const Reaction = require('./Reaction');
const Comment = require('./Comment');
const CommentLike = require('./CommentLike');
const Save = require('./Save');
const Job = require('./Job');
const Application = require('./Application');

const cascade = { onDelete: 'CASCADE', onUpdate: 'CASCADE' };

User.hasMany(Post, { foreignKey: 'authorId', as: 'posts', ...cascade });
Post.belongsTo(User, { foreignKey: 'authorId', as: 'author', ...cascade });

// A share points to the original post. No FK constraint on purpose: when the original
// is deleted the share keeps its sharedPostId and shows "no longer available".
Post.belongsTo(Post, { foreignKey: 'sharedPostId', as: 'sharedPost', constraints: false });

Post.hasMany(Reaction, { foreignKey: 'postId', as: 'reactions', ...cascade });
Reaction.belongsTo(Post, { foreignKey: 'postId', ...cascade });
User.hasMany(Reaction, { foreignKey: 'userId', ...cascade });
Reaction.belongsTo(User, { foreignKey: 'userId', as: 'user', ...cascade });

Post.hasMany(Comment, { foreignKey: 'postId', as: 'comments', ...cascade });
Comment.belongsTo(Post, { foreignKey: 'postId', ...cascade });
User.hasMany(Comment, { foreignKey: 'authorId', ...cascade });
Comment.belongsTo(User, { foreignKey: 'authorId', as: 'author', ...cascade });
Comment.hasMany(Comment, { foreignKey: 'parentCommentId', as: 'replies', ...cascade });
Comment.belongsTo(Comment, { foreignKey: 'parentCommentId', as: 'parent', ...cascade });

Comment.hasMany(CommentLike, { foreignKey: 'commentId', ...cascade });
CommentLike.belongsTo(Comment, { foreignKey: 'commentId', ...cascade });
User.hasMany(CommentLike, { foreignKey: 'userId', ...cascade });

Post.hasMany(Save, { foreignKey: 'postId', ...cascade });
Save.belongsTo(Post, { foreignKey: 'postId', as: 'post', ...cascade });
User.hasMany(Save, { foreignKey: 'userId', ...cascade });
Save.belongsTo(User, { foreignKey: 'userId', ...cascade });

Post.hasOne(Job, { foreignKey: 'postId', as: 'job', ...cascade });
Job.belongsTo(Post, { foreignKey: 'postId', as: 'post', ...cascade });

Post.hasMany(Application, { foreignKey: 'jobPostId', as: 'applications', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Application.belongsTo(Post, { foreignKey: 'jobPostId', as: 'jobPost', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
User.hasMany(Application, { foreignKey: 'candidateId', as: 'applications', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Application.belongsTo(User, { foreignKey: 'candidateId', as: 'candidate', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Application.belongsTo(User, { foreignKey: 'recruiterId', as: 'recruiter', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

module.exports = { sequelize, User, Post, Reaction, Comment, CommentLike, Save, Job, Application };
