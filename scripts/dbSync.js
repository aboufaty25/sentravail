// Creates/updates tables from the models. Safe to run on every deploy.
const { sequelize } = require('../src/models');
const { runMigrations } = require('../src/config/migrate');

(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    await runMigrations();
    console.log('Database synchronized.');
  } catch (err) {
    console.error('Database sync failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
