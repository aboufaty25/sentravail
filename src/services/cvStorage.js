const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');

const KEY_RE = /^\d{4}\/\d{2}\/[a-f0-9]{24}\.(pdf|doc|docx)$/;
const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// Real type from the file's first bytes.
function detectCvType(buffer) {
  if (!buffer || buffer.length < 8) return null;
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'doc';
  // DOCX is a ZIP containing word/ entries.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04 && buffer.includes('word/')) return 'docx';
  return null;
}

function cleanName(name, ext) {
  const base = String(name || 'CV')
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 80);
  return `${base || 'CV'}.${ext}`;
}

async function saveCv(buffer, originalName) {
  const ext = detectCvType(buffer);
  if (!ext) {
    const err = new Error('Le CV doit être un fichier PDF ou Word (.doc, .docx).');
    err.status = 422;
    throw err;
  }
  const now = new Date();
  const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const key = `${dir}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await fs.mkdir(path.join(env.cvDir, dir), { recursive: true });
  await fs.writeFile(path.join(env.cvDir, key), buffer, { mode: 0o600 });
  return { key, name: cleanName(originalName, ext) };
}

function filePath(key) {
  if (!KEY_RE.test(key)) return null;
  return path.join(env.cvDir, key);
}

// HMAC signature binding key, download name and expiry.
function sign(key, name, exp) {
  return crypto.createHmac('sha256', `cv:${env.SESSION_SECRET}`).update(`${key}|${name}|${exp}`).digest('base64url');
}

function signedPath(key, name, days = env.CV_LINK_DAYS) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const qs = new URLSearchParams({ k: key, n: name || 'CV.pdf', e: String(exp), s: sign(key, name || 'CV.pdf', exp) });
  return `/cv/telecharger?${qs}`;
}

function signedUrl(key, name, days) {
  return `${env.APP_URL}${signedPath(key, name, days)}`;
}

function verify({ k, n, e, s }) {
  if (typeof k !== 'string' || typeof n !== 'string' || typeof s !== 'string' || !KEY_RE.test(k)) return false;
  const exp = Number(e);
  if (!Number.isInteger(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(k, n, exp));
  const given = Buffer.from(s);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function mimeOf(key) {
  return MIME[key.split('.').pop()];
}

module.exports = { saveCv, filePath, signedPath, signedUrl, verify, mimeOf, detectCvType };
