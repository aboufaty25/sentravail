// Promotes the accounts listed in ADMIN_EMAILS to administrator at startup.
// Only existing accounts are promoted, so the owner signs up first, then sets the variable.
const env = require('../config/env');
const { User } = require('../models');

function adminEmails() {
  return env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'));
}

async function promoteConfiguredAdmins() {
  const promoted = [];
  for (const email of adminEmails()) {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.warn(`ADMIN_EMAILS: no account with email ${email} yet. Sign up on the site, then restart the app.`);
      continue;
    }
    if (user.role !== 'admin' || user.isBanned || !user.isVerified) {
      await user.update({ role: 'admin', isBanned: false, isVerified: true });
      promoted.push(email);
      console.log(`ADMIN_EMAILS: ${email} is now an administrator.`);
    }
  }
  // Existing members follow the newly promoted administrator (the SenTravail team).
  if (promoted.length) {
    const ids = (await User.findAll({ where: { email: promoted }, attributes: ['id'] })).map((u) => u.id);
    await require('./follows').followTeam({ adminIds: ids });
  }
  return promoted;
}

module.exports = { adminEmails, promoteConfiguredAdmins };
