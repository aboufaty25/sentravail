const http = require('http');
const fs = require('fs/promises');
const env = require('./config/env');
const app = require('./app');
const { sequelize } = require('./models');
const { closeStore, sessionMiddleware } = require('./config/session');
const { initSocket, closeSocket } = require('./config/socket');
const { refreshRecentScores } = require('./services/feedRanking');
const { runMigrations } = require('./config/migrate');
const { promoteConfiguredAdmins } = require('./services/admins');
const branding = require('./services/branding');
const refs = require('./services/refs');

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
  await promoteConfiguredAdmins();
  await refs.load();
  await branding.load();
  await require('./services/jobImport').importPending().catch((err) => console.error('[import] failed:', err.message));
  setInterval(() => refs.load().catch(() => {}), 5 * 60 * 1000).unref();
  const server = http.createServer(app);
  initSocket(server, sessionMiddleware());
  server.listen(env.PORT, () => console.log(`SenTravail running on ${env.APP_URL} (port ${env.PORT})`));

  // Feed scores decay with time: recompute them every 15 minutes (also available as `npm run scores`).
  const refresh = () => refreshRecentScores().catch((err) => console.error('Score refresh failed:', err.message));
  refresh();
  const timer = setInterval(refresh, SCORE_REFRESH_MS);
  timer.unref();

  const shutdown = async () => {
    server.close();
    await closeSocket();
    await closeStore();
    await sequelize.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, exiting:', err);
  process.exit(1); // the host restarts the app
});

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
