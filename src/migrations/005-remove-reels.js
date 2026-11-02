const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

// No more video: delete reels (and their files), drop the video columns.
module.exports.up = async (qi, DataTypes, sequelize) => {
  const cols = await qi.describeTable('posts');
  if (cols.videoUrl) {
    const [reels] = await sequelize.query("SELECT id, videoUrl, thumbnailUrl FROM posts WHERE type = 'reel'");
    for (const r of reels) {
      for (const url of [r.videoUrl, r.thumbnailUrl]) {
        if (url && url.startsWith('/uploads/') && !url.includes('..')) {
          await fs.unlink(path.join(env.uploadDir, url.slice('/uploads/'.length))).catch(() => {});
        }
      }
    }
    // Reactions, comments, saves, notifications cascade with the post.
    await sequelize.query("DELETE FROM posts WHERE type = 'reel'");
    await qi.removeColumn('posts', 'videoUrl');
    if (cols.thumbnailUrl) await qi.removeColumn('posts', 'thumbnailUrl');
    console.log(`Migration 005: ${reels.length} reel(s) removed.`);
  }
  await qi.changeColumn('posts', 'type', { type: DataTypes.ENUM('text', 'photo', 'job'), allowNull: false, defaultValue: 'text' });
};
