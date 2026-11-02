// PM2 configuration — only for a VPS (not needed on Hostinger's managed Node.js hosting).
// Usage: pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'sentravail',
      script: 'src/server.js',
      cwd: __dirname + '/..',
      instances: 1, // Socket.io rooms and in-memory caches assume a single process
      exec_mode: 'fork',
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'sentravail-scores',
      script: 'scripts/refreshScores.js',
      cwd: __dirname + '/..',
      cron_restart: '*/15 * * * *',
      autorestart: false,
      env: { NODE_ENV: 'production' },
    },
  ],
};
