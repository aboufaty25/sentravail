const fs = require('fs');
const path = require('path');
const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const DIR = path.join(__dirname, '../migrations');

// Minimal migration runner: `sequelize.sync()` creates missing tables, then each file in
// src/migrations runs once (recorded in the `migrations` table). Migrations must be
// idempotent so they also work on fresh databases where sync() already created the columns.
async function runMigrations({ log = console.log } = {}) {
  const qi = sequelize.getQueryInterface();
  await sequelize.query('CREATE TABLE IF NOT EXISTS migrations (name VARCHAR(190) PRIMARY KEY, runAt DATETIME NOT NULL)');
  const [rows] = await sequelize.query('SELECT name FROM migrations');
  const done = new Set(rows.map((r) => r.name));
  const files = fs.readdirSync(DIR).filter((f) => /^\d+.*\.js$/.test(f)).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    log(`Running migration ${file}`);
    await require(path.join(DIR, file)).up(qi, DataTypes, sequelize);
    await sequelize.query('INSERT INTO migrations (name, runAt) VALUES (?, UTC_TIMESTAMP())', { replacements: [file] });
  }
}

// Helper for migrations: add a column only if it is missing.
async function addColumnIfMissing(qi, table, column, definition) {
  const cols = await qi.describeTable(table);
  if (!cols[column]) await qi.addColumn(table, column, definition);
}

module.exports = { runMigrations, addColumnIfMissing };
