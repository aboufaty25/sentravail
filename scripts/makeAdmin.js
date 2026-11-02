// Promotes an existing account to administrator: npm run make-admin -- email@example.com
const { sequelize, User } = require('../src/models');

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email.includes('@')) {
    console.error('Usage: npm run make-admin -- email@example.com');
    process.exitCode = 1;
    return sequelize.close();
  }
  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.error(`No account with email ${email}. Sign up on the site first.`);
      process.exitCode = 1;
    } else {
      await user.update({ role: 'admin', isBanned: false, isVerified: true });
      console.log(`${user.firstName} ${user.lastName} <${email}> is now an administrator.`);
    }
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
