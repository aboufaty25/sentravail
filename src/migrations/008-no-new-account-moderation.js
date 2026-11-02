// New accounts no longer go through moderation: publish anything that was held for that reason.
module.exports.up = async (qi, DataTypes, sequelize) => {
  const [, meta] = await sequelize.query("UPDATE posts SET status = 'published', moderationReason = NULL WHERE status = 'pending_approval' AND moderationReason = 'new_account'");
  const n = meta?.affectedRows ?? 0;
  if (n) console.log(`Migration 008: ${n} publication(s) from new accounts published.`);
};
