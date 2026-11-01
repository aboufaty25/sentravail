// Phase 8: cities and sectors become admin-editable; copy the defaults into the table.
module.exports.up = async () => {
  await require('../services/refs').seedDefaults();
};
