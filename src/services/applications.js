const fs = require('fs/promises');
const env = require('../config/env');
const { sendMail } = require('./mail');
const cvStorage = require('./cvStorage');

function subjectFor(app) {
  return `Candidature — ${app.jobTitle} — via SenTravail`;
}

function bodyFor(app, { cvLink = true } = {}) {
  const lines = [
    'Bonjour,',
    '',
    `Je vous adresse ma candidature au poste de « ${app.jobTitle} » (${app.companyName}), vue sur SenTravail.`,
    '',
    `Nom : ${app.firstName} ${app.lastName}`,
    `Email : ${app.email}`,
    `Téléphone : ${app.phone}`,
  ];
  if (app.message) lines.push('', 'Message :', app.message);
  if (cvLink) {
    lines.push('', `Mon CV (lien de téléchargement valable ${env.CV_LINK_DAYS} jours) :`, cvStorage.signedUrl(app.cvKey, app.cvName));
  } else {
    lines.push('', 'Mon CV est joint à cet email.');
  }
  lines.push('', 'Cordialement,', `${app.firstName} ${app.lastName}`);
  if (app.jobSlug) lines.push('', '—', `Offre : ${env.APP_URL}/offres/${app.jobSlug}`);
  return lines.join('\r\n');
}

// mailto: cannot carry attachments, hence the signed CV link in the body.
function mailtoFor(app, recipient) {
  return `mailto:${encodeURIComponent(recipient).replace(/%40/g, '@')}?subject=${encodeURIComponent(subjectFor(app))}&body=${encodeURIComponent(bodyFor(app))}`;
}

// Fallback: SenTravail sends the application itself, CV attached, reply-to = candidate.
async function sendViaServer(app, recipient) {
  const path = cvStorage.filePath(app.cvKey);
  const attachments = path ? [{ filename: app.cvName || 'CV.pdf', content: await fs.readFile(path), contentType: cvStorage.mimeOf(app.cvKey) }] : [];
  await sendMail({
    to: recipient,
    replyTo: `"${app.firstName} ${app.lastName}" <${app.email}>`,
    subject: subjectFor(app),
    text: bodyFor(app, { cvLink: !attachments.length }),
    attachments,
  });
  // Receipt for the candidate.
  await sendMail({
    to: app.email,
    subject: `Votre candidature « ${app.jobTitle} » a été envoyée`,
    text: [
      `Bonjour ${app.firstName},`,
      '',
      `Votre candidature au poste « ${app.jobTitle} » chez ${app.companyName} a bien été transmise au recruteur par SenTravail.`,
      'Le recruteur vous répondra directement à cette adresse email.',
      '',
      `Suivez vos candidatures : ${env.APP_URL}/mes-candidatures`,
    ].join('\n'),
  });
}

module.exports = { subjectFor, bodyFor, mailtoFor, sendViaServer };
