const { addColumnIfMissing } = require('../config/migrate');

// Guardrails: trust levels, recruiter verification, moderation reasons, filter terms.
module.exports.up = async (qi, DataTypes, sequelize) => {
  await addColumnIfMissing(qi, 'users', 'approvedPostsCount', { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 });
  await addColumnIfMissing(qi, 'users', 'verificationStatus', { type: DataTypes.ENUM('none', 'pending', 'approved', 'rejected'), allowNull: false, defaultValue: 'none' });
  await addColumnIfMissing(qi, 'users', 'verificationMethod', { type: DataTypes.ENUM('ninea', 'rccm', 'email') });
  await addColumnIfMissing(qi, 'users', 'verificationValue', { type: DataTypes.STRING(190) });
  await addColumnIfMissing(qi, 'users', 'verificationEmailConfirmed', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addColumnIfMissing(qi, 'users', 'verificationTokenHash', { type: DataTypes.STRING(64) });
  await addColumnIfMissing(qi, 'users', 'verificationNote', { type: DataTypes.STRING(300) });
  await addColumnIfMissing(qi, 'users', 'verificationRequestedAt', { type: DataTypes.DATE });
  await addColumnIfMissing(qi, 'posts', 'moderationReason', { type: DataTypes.ENUM('new_account', 'filter', 'reports') });
  await addColumnIfMissing(qi, 'posts', 'moderationNote', { type: DataTypes.STRING(300) });
  await addColumnIfMissing(qi, 'comments', 'status', { type: DataTypes.ENUM('published', 'pending_approval'), allowNull: false, defaultValue: 'published' });
  await addColumnIfMissing(qi, 'comments', 'moderationReason', { type: DataTypes.ENUM('filter', 'reports') });
  await addColumnIfMissing(qi, 'comments', 'moderationNote', { type: DataTypes.STRING(300) });
  await qi.changeColumn('notifications', 'type', {
    type: DataTypes.ENUM(
      'like', 'comment', 'reply', 'follow', 'share', 'application', 'application_status', 'job_approved', 'job_rejected',
      'new_job_from_followed', 'post_approved', 'post_rejected', 'verification_approved', 'verification_rejected'
    ),
    allowNull: false,
  });
  // Existing members already publishing keep publishing directly; verified accounts are approved.
  await sequelize.query('UPDATE users SET approvedPostsCount = 3 WHERE approvedPostsCount = 0 AND id IN (SELECT authorId FROM (SELECT DISTINCT authorId FROM posts) t)');
  await sequelize.query("UPDATE users SET verificationStatus = 'approved' WHERE isVerified = 1 AND verificationStatus = 'none'");
  // Default anti-scam terms.
  const [[{ n }]] = await sequelize.query('SELECT COUNT(*) AS n FROM banned_terms');
  if (!Number(n)) {
    const BannedTerm = require('../models/BannedTerm');
    await BannedTerm.bulkCreate(BannedTerm.DEFAULTS.map((term) => ({ term })));
  }
};
