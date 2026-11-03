// AdSense for sentravail.com: publisher id and the "Header Top Display Responsive" unit
// (public identifiers, visible in every page). Inserted once; editable at /admin/publicites.
module.exports.up = async (qi) => {
  const defaults = { 'ads.client': 'ca-pub-1531184274736744', 'ads.slot.default': '6556069017' };
  for (const [key, value] of Object.entries(defaults)) {
    const [rows] = await qi.sequelize.query('SELECT `key` FROM site_settings WHERE `key` = ?', { replacements: [key] });
    if (rows.length) continue;
    await qi.sequelize.query('INSERT INTO site_settings (`key`, `value`, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())', { replacements: [key, value] });
  }
};
