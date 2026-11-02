// Offers get their own image (poster/visual shown large in the feed and in link previews),
// separate from the company logo.
module.exports.up = async (qi, DataTypes) => {
  const cols = await qi.describeTable('jobs');
  if (cols.image) return;
  await qi.addColumn('jobs', 'image', { type: DataTypes.STRING(500), allowNull: true });
  // Existing offers: an image uploaded with the offer (different from the author's profile logo) becomes its image.
  await qi.sequelize.query(`
    UPDATE jobs j
    JOIN posts p ON p.id = j.postId
    JOIN users u ON u.id = p.authorId
    SET j.image = j.companyLogo
    WHERE j.image IS NULL AND j.companyLogo IS NOT NULL AND (u.companyLogo IS NULL OR u.companyLogo <> j.companyLogo)`);
};
