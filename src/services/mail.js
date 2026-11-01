const { getTransporter } = require('../config/mailer');
const env = require('../config/env');

// In tests, sent messages are kept here so assertions can read them.
const outbox = [];

async function sendMail({ to, subject, text, html }) {
  const info = await getTransporter().sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  if (env.isTest) outbox.push({ to, subject, text, html });
  else if (!env.SMTP_HOST) console.log(`[mail:dev] To: ${to} | ${subject}\n${text}`);
  return info;
}

async function sendPasswordReset(user, resetUrl) {
  const text = [
    `Bonjour ${user.firstName},`,
    '',
    'Vous avez demandé à réinitialiser votre mot de passe SenTravail.',
    `Cliquez sur ce lien (valable 1 heure) : ${resetUrl}`,
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.",
  ].join('\n');
  const html = `<p>Bonjour ${user.firstName},</p>
<p>Vous avez demandé à réinitialiser votre mot de passe SenTravail.</p>
<p><a href="${resetUrl}" style="background:#1877f2;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Choisir un nouveau mot de passe</a></p>
<p>Ce lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`;
  return sendMail({ to: user.email, subject: 'Réinitialisation de votre mot de passe SenTravail', text, html });
}

module.exports = { sendMail, sendPasswordReset, outbox };
