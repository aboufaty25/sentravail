const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const cloudinary = require('../config/cloudinary');

// Detects the real file type from its first bytes (never trust the browser's mimetype).
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `sentravail/${folder}`,
        resource_type: 'image',
        // Keep originals reasonably small; delivery size is chosen per view (see imageUrl).
        transformation: [{ width: 2000, height: 2000, crop: 'limit' }],
      },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    stream.end(buffer);
  });
}

async function saveLocally(buffer, ext, folder) {
  const now = new Date();
  const rel = path.join(folder, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  const dir = path.join(env.uploadDir, rel);
  await fs.mkdir(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(dir, name), buffer);
  return `/uploads/${rel.split(path.sep).join('/')}/${name}`;
}

// Stores a validated image and returns its public URL.
async function saveImage(buffer, folder = 'posts') {
  const ext = detectImageType(buffer);
  if (!ext) {
    const err = new Error('Format d’image non pris en charge (JPEG, PNG ou WebP uniquement).');
    err.status = 422;
    throw err;
  }
  return env.cloudinaryEnabled ? uploadToCloudinary(buffer, folder) : saveLocally(buffer, ext, folder);
}

module.exports = { saveImage, detectImageType };
