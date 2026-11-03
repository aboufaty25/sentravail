// Publishes the offers of a JSON file under an admin account:
//   npm run import-jobs -- data/imports/2026-11-02-offres.json [admin@email]
// (Files in data/imports are also imported automatically, once, when the app starts.)
const path = require('path');
const { sequelize } = require('../src/models');
const { findAdmin, importFile } = require('../src/services/jobImport');

(async () => {
  const [file, email] = process.argv.slice(2);
  try {
    if (!file) throw new Error('Usage: npm run import-jobs -- file.json [admin@email]');
    const author = await findAdmin(email && email.toLowerCase());
    if (!author) throw new Error(email ? `No administrator with email ${email}.` : 'No administrator account.');
    const report = await importFile(path.resolve(file), author);
    console.log(`${report.created.length} offer(s) published as ${author.email}.`);
    report.created.forEach((t) => console.log(`  + ${t}`));
    report.skipped.forEach((t) => console.log(`  - skipped: ${t}`));
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
