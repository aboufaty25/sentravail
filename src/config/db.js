const { Sequelize } = require('sequelize');
const env = require('./env');

const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
  host: env.DB_HOST,
  port: env.DB_PORT,
  dialect: 'mysql',
  logging: false,
  timezone: '+00:00',
  define: {
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    underscored: false,
  },
  // Shared hosting limits concurrent connections: keep the pool small.
  pool: { max: 5, min: 0, idle: 10000, acquire: 30000 },
});

module.exports = sequelize;
