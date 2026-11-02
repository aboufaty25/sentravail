// Recruiter verification: NINEA, RCCM or a professional email address.

// Free/personal mailbox providers are not accepted as "professional" emails.
const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'ymail.com', 'rocketmail.com', 'hotmail.com', 'hotmail.fr',
  'outlook.com', 'outlook.fr', 'live.com', 'live.fr', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.com',
  'gmx.fr', 'mail.com', 'proton.me', 'protonmail.com', 'yandex.com', 'yandex.ru', 'zoho.com', 'laposte.net', 'orange.fr',
  'orange.sn', 'free.fr', 'sfr.fr', 'wanadoo.fr', 'tutanota.com', 'mail.ru', 'qq.com', '163.com',
];

function isFreeEmailDomain(email) {
  const domain = String(email).toLowerCase().split('@')[1] || '';
  return FREE_EMAIL_DOMAINS.includes(domain) || /^(yahoo|hotmail|outlook|live|gmail)\./.test(domain);
}

// NINEA: 7 to 9 digits, optionally followed by the 3-character COFI code (e.g. "004562312 2V2").
function normalizeNinea(value) {
  const v = String(value || '').toUpperCase().replace(/[\s.-]/g, '');
  return /^\d{7,9}([0-9A-Z]{3})?$/.test(v) ? v : null;
}

// RCCM: e.g. "SN-DKR-2020-B-12345" (separators optional).
function normalizeRccm(value) {
  const v = String(value || '').toUpperCase().replace(/[\s_.]/g, '-').replace(/-+/g, '-');
  const m = v.replace(/-/g, '').match(/^SN([A-Z]{2,4})(\d{4})([A-Z])(\d{1,6})$/);
  return m ? `SN-${m[1]}-${m[2]}-${m[3]}-${m[4]}` : null;
}

module.exports = { FREE_EMAIL_DOMAINS, isFreeEmailDomain, normalizeNinea, normalizeRccm };
