const http = require('http');
const fs = require('fs/promises');
const env = require('./config/env');
const app = require('./app');
const { sequelize } = require('./models');
const { closeStore } = require('./config/session');
const { refreshRecentScores } = require('./services/feedRanking');
const { runMigrations } = require('./config/migrate');

const SCORE_REFRESH_MS = 15 * 60 * 1000;

async function ensureUploadDir() {
  try {
    await fs.mkdir(env.uploadDir, { recursive: true });
    await fs.access(env.uploadDir, fs.constants.W_OK);
    console.log(`Uploads stored in ${env.uploadDir}`);
  } catch (err) {
    console.error(`Upload folder ${env.uploadDir} is not writable (${err.code}). Set UPLOAD_DIR to a writable folder.`);
  }
}

async function start() {
  await ensureUploadDir();
  await sequelize.authenticate();
  // Create missing tables on boot (no destructive changes), then apply migrations.
  await sequelize.sync();
  await runMigrations();
  const server = http.createServer(app);
  server.listen(env.PORT, () => console.log(`SenTravail running on ${env.APP_URL} (port ${env.PORT})`));

  // Feed scores decay with time: recompute them every 15 minutes (also available as `npm run scores`).
  const refresh = () => refreshRecentScores().catch((err) => console.error('Score refresh failed:', err.message));
  refresh();
  const timer = setInterval(refresh, SCORE_REFRESH_MS);
  timer.unref();

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
