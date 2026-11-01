const nodemailer = require('nodemailer');
const env = require('./env');

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  if (env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
  } else {
    // No SMTP configured (dev/test): build the message without sending it.
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

module.exports = { getTransporter };
