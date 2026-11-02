// Sets a new password for an existing account: npm run set-password -- email@example.com
// The password is typed at the prompt (or given in NEW_PASSWORD), never as an argument,
// so it does not end up in the shell history.
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('../src/models');

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  try {
    if (!email.includes('@')) throw new Error('Usage: npm run set-password -- email@example.com');
    const user = await User.findOne({ where: { email } });
    if (!user) throw new Error(`No account with email ${email}.`);
    const password = process.env.NEW_PASSWORD || (await ask('Nouveau mot de passe : '));
    if (password.length < 8 || password.length > 100) throw new Error('Password must be 8 to 100 characters.');
    await user.update({ passwordHash: await bcrypt.hash(password, 12) });
    // Log the account out everywhere (sessions are stored in MySQL).
    await sequelize.query('DELETE FROM sessions WHERE data LIKE :a OR data LIKE :b', {
      replacements: { a: `%"userId":${user.id},%`, b: `%"userId":${user.id}}%` },
    }).catch(() => {});
    console.log(`Password updated for ${user.firstName} ${user.lastName} <${email}>.`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
