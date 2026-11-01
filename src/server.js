const http = require('http');
const env = require('./config/env');
const app = require('./app');
const { sequelize } = require('./models');
const { closeStore } = require('./config/session');

async function start() {
  await sequelize.authenticate();
  // Create missing tables on boot (no destructive changes).
  await sequelize.sync();
  const server = http.createServer(app);
  server.listen(env.PORT, () => console.log(`SenTravail running on ${env.APP_URL} (port ${env.PORT})`));

  const shutdown = async () => {
    server.close();
    await closeStore();
    await sequelize.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
