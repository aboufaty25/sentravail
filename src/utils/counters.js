const { literal } = require('sequelize');

const SAFE_FIELD = /^[a-zA-Z]+Count$/;

// Atomically adds `delta` to a counter column, never going below 0
// (unsigned columns would otherwise raise an out-of-range error).
async function adjustCounter(Model, id, field, delta) {
  if (!SAFE_FIELD.test(field) || !Number.isInteger(delta) || delta === 0) return;
  const expr = delta > 0 ? `${field} + ${delta}` : `IF(${field} > ${-delta}, ${field} - ${-delta}, 0)`;
  await Model.update({ [field]: literal(expr) }, { where: { id }, silent: true });
}

module.exports = { adjustCounter };
