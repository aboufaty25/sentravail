const http = require('http');
const fs = require('fs/promises');
const env = require('./config/env');
const app = require('./app');
const { sequelize } = require('./models');
const { closeStore, sessionMiddleware } = require('./config/session');
const { initSocket, closeSocket } = require('./config/socket');
const { refreshRecentScores } = require('./services/feedRanking');
const { runMigrations } = require('./config/migrate');
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

// Removes upload leftovers (interrupted video uploads) older than one hour.
async function cleanUploadTmp() {
  try {
    const path = require('path');
    const files = await fs.readdir(env.uploadTmpDir);
    const limit = Date.now() - 3600_000;
    for (const f of files) {
      const full = path.join(env.uploadTmpDir, f);
      const st = await fs.stat(full).catch(() => null);
      if (st && st.mtimeMs < limit) await fs.unlink(full).catch(() => {});
    }
  } catch (_) { /* folder not created yet */ }
}

async function start() {
  await ensureUploadDir();
  await cleanUploadTmp();
  setInterval(cleanUploadTmp, 3600_000).unref();
  await sequelize.authenticate();
  // Create missing tables on boot (no destructive changes), then apply migrations.
  await sequelize.sync();
  await runMigrations();
  await refs.load();
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
