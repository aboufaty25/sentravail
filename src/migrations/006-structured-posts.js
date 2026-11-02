const { addColumnIfMissing } = require('../config/migrate');

// 100 % emploi: structured publication types. Existing shares get the 'share' type;
// legacy free posts ('text'/'photo') are kept in the database but hidden everywhere.
module.exports.up = async (qi, DataTypes, sequelize) => {
  await qi.changeColumn('posts', 'type', {
    type: DataTypes.ENUM('job', 'job_search', 'event', 'hired', 'advice', 'share', 'text', 'photo'),
    allowNull: false,
  });
  await addColumnIfMissing(qi, 'posts', 'title', { type: DataTypes.STRING(160) });
  await addColumnIfMissing(qi, 'posts', 'city', { type: DataTypes.STRING(80) });
  await addColumnIfMissing(qi, 'posts', 'eventDate', { type: DataTypes.DATE });
  await addColumnIfMissing(qi, 'posts', 'details', { type: DataTypes.TEXT('long') });
  const indexes = await qi.showIndex('posts');
  if (!indexes.some((i) => i.name === 'posts_type_event_date')) await qi.addIndex('posts', ['type', 'eventDate'], { name: 'posts_type_event_date' });
  await sequelize.query("UPDATE posts SET type = 'share' WHERE sharedPostId IS NOT NULL AND type IN ('text', 'photo')");
};
