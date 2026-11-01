// Recomputes feed scores. Run from a cron job (hPanel > Avancé > Tâches Cron) every 15 minutes:
//   cd ~/path/to/app && node scripts/refreshScores.js
const { sequelize } = require('../src/models');
const { refreshRecentScores } = require('../src/services/feedRanking');

refreshRecentScores()
  .then(() => console.log('Feed scores refreshed.'))
  .catch((err) => { console.error('Score refresh failed:', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
