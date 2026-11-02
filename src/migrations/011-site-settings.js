// Admin-editable branding (logo, app icon, default share image).
module.exports.up = async (qi, DataTypes) => {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (tables.includes('site_settings')) return;
  await qi.createTable('site_settings', {
    key: { type: DataTypes.STRING(60), primaryKey: true },
    value: { type: DataTypes.TEXT },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
};
