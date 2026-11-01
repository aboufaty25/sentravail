const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');

const MAX_REEL_SECONDS = 30;
const TOLERANCE = 0.9; // encoders often add a few frames

// Container types we accept: MP4 / MOV / M4V (ISO base media). These are what phones record.
const FIRST_BOXES = new Set(['ftyp', 'moov', 'wide', 'free', 'mdat', 'skip']);

// Reads boxes (atoms) from an open file without loading it in memory.
async function readBoxHeader(fh, pos, end) {
  if (pos + 8 > end) return null;
  const h = Buffer.alloc(16);
  const { bytesRead } = await fh.read(h, 0, 16, pos);
  if (bytesRead < 8) return null;
  let size = h.readUInt32BE(0);
  const type = h.toString('latin1', 4, 8);
  let header = 8;
  if (size === 1) {
    if (bytesRead < 16) return null;
    size = Number(h.readBigUInt64BE(8));
    header = 16;
  } else if (size === 0) {
    size = end - pos; // box extends to end of file
  }
  if (size < header) return null;
  return { pos, size, header, type };
}

async function findBox(fh, start, end, type) {
  let pos = start;
  for (let guard = 0; guard < 10_000 && pos < end; guard += 1) {
    const box = await readBoxHeader(fh, pos, end);
    if (!box) return null;
    if (box.type === type) return box;
    pos += box.size;
  }
  return null;
}

// Returns { ok, duration } — duration in seconds read from moov/mvhd, or ok=false.
async function probeMp4(filePath) {
  const fh = await fs.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    const first = await readBoxHeader(fh, 0, size);
    if (!first || !FIRST_BOXES.has(first.type)) return { ok: false };
    const moov = await findBox(fh, 0, size, 'moov');
    if (!moov) return { ok: false };
    const mvhd = await findBox(fh, moov.pos + moov.header, moov.pos + moov.size, 'mvhd');
    if (!mvhd) return { ok: false };
    const b = Buffer.alloc(32);
    await fh.read(b, 0, 32, mvhd.pos + mvhd.header);
    const version = b[0];
    const timescale = version === 1 ? b.readUInt32BE(20) : b.readUInt32BE(12);
    const units = version === 1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
    if (!timescale) return { ok: false };
    return { ok: true, duration: units / timescale };
  } finally {
    await fh.close();
  }
}

function reject(message, status = 422) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Validates the uploaded temp file and moves it into the public uploads folder.
async function saveReelVideo(tmpPath) {
  let info;
  try {
    info = await probeMp4(tmpPath);
  } catch (_) {
    info = { ok: false };
  }
  if (!info.ok) throw reject('Format vidéo non pris en charge. Utilisez une vidéo MP4 ou MOV filmée avec votre téléphone.');
  if (info.duration > MAX_REEL_SECONDS + TOLERANCE) {
    throw reject(`Votre vidéo dure ${Math.round(info.duration)} secondes. Les réels sont limités à ${MAX_REEL_SECONDS} secondes.`);
  }
  if (info.duration < 1) throw reject('Cette vidéo est trop courte.');
  const now = new Date();
  const rel = path.join('reels', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  await fs.mkdir(path.join(env.uploadDir, rel), { recursive: true });
  // Stored as .mp4: MOV and MP4 share the same container and play as video/mp4.
  const name = `${crypto.randomBytes(12).toString('hex')}.mp4`;
  const dest = path.join(env.uploadDir, rel, name);
  try {
    await fs.rename(tmpPath, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err; // different disks: copy then delete
    await fs.copyFile(tmpPath, dest);
    await fs.unlink(tmpPath);
  }
  return { url: `/uploads/${rel.split(path.sep).join('/')}/${name}`, duration: info.duration };
}

// Best-effort removal of files we stored locally (never throws).
async function removeLocalMedia(urls) {
  for (const url of urls.filter(Boolean)) {
    if (!url.startsWith('/uploads/')) continue;
    const rel = url.slice('/uploads/'.length);
    if (rel.includes('..')) continue;
    await fs.unlink(path.join(env.uploadDir, rel)).catch(() => {});
  }
}

module.exports = { probeMp4, saveReelVideo, removeLocalMedia, MAX_REEL_SECONDS };
