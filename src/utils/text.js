// Lowercase ASCII slug: "Aïssatou Ndiaye" -> "aissatou-ndiaye"
function slugify(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// Normalizes Senegalese numbers to E.164 (+221XXXXXXXXX). Other international
// numbers starting with "+" or "00" are kept as-is (digits only).
function normalizePhone(input) {
  if (!input) return null;
  let digits = String(input).replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^221\d{9}$/.test(digits)) return `+${digits}`;
  if (/^[37]\d{8}$/.test(digits)) return `+221${digits}`;
  return null;
}

function isEmailLike(value) {
  return String(value || '').includes('@');
}

module.exports = { slugify, normalizePhone, isEmailLike };
