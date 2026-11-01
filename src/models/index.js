const sequelize = require('../config/db');
const User = require('./User');

// Associations will be declared here as models are added (Post, Follow, …).

module.exports = { sequelize, User };
