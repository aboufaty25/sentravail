const { RefItem } = require('../models');
const { CITIES, SECTORS, DEFAULT_CITIES, DEFAULT_SECTORS } = require('../config/constants');

const LISTS = { city: CITIES, sector: SECTORS };
const DEFAULTS = { city: DEFAULT_CITIES, sector: DEFAULT_SECTORS };

// Refreshes the live CITIES / SECTORS arrays (mutated in place, so every module that
// imported them sees the new values). Keeps the defaults when the table is empty.
async function load() {
  const rows = await RefItem.findAll({ order: [['position', 'ASC'], ['name', 'ASC']], raw: true });
  for (const kind of Object.keys(LISTS)) {
    const own = rows.filter((r) => r.kind === kind);
    const active = own.length ? own.filter((r) => r.active).map((r) => r.name) : [...DEFAULTS[kind]];
    LISTS[kind].splice(0, LISTS[kind].length, ...active);
  }
}

// Inserts the default values once (fresh installs and upgrades).
async function seedDefaults() {
  if (await RefItem.count()) return;
  const rows = [];
  for (const kind of Object.keys(DEFAULTS)) DEFAULTS[kind].forEach((name, i) => rows.push({ kind, name, position: i }));
  await RefItem.bulkCreate(rows);
}

async function list(kind) {
  return RefItem.findAll({ where: { kind }, order: [['active', 'DESC'], ['position', 'ASC'], ['name', 'ASC']] });
}

module.exports = { load, seedDefaults, list };
