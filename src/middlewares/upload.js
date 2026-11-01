const multer = require('multer');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Images are kept in memory (max 4 × 5 MB) then validated and stored by services/storage.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
    const err = new Error('Format d’image non pris en charge (JPEG, PNG ou WebP uniquement).');
    err.status = 422;
    return cb(err);
  },
});

// Turns multer errors into user-facing 4xx errors.
function handleUploadErrors(mw) {
  return (req, res, next) =>
    mw(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const messages = {
          LIMIT_FILE_SIZE: req.path.startsWith('/reels')
            ? 'La vidéo doit faire moins de 40 Mo. Filmez en 720p ou raccourcissez-la.'
            : req.path.includes('postuler') || req.path.startsWith('/cv')
              ? 'Le CV doit faire moins de 5 Mo.'
              : 'Chaque photo doit faire moins de 5 Mo.',
          LIMIT_FILE_COUNT: '4 photos maximum par publication.',
          LIMIT_UNEXPECTED_FILE: '4 photos maximum par publication.',
        };
        err.message = messages[err.code] || 'Envoi du fichier impossible.';
        err.status = 422;
      }
      return next(err);
    });
}

module.exports = { imageUpload, handleUploadErrors };

const CV_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // some Android browsers
]);

// Single CV upload (PDF/DOC/DOCX, 5 MB). Real type is checked by services/cvStorage.
const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (CV_TYPES.has(file.mimetype) || /\.(pdf|docx?)$/i.test(file.originalname)) return cb(null, true);
    const err = new Error('Le CV doit être un fichier PDF ou Word (.doc, .docx).');
    err.status = 422;
    return cb(err);
  },
});

module.exports.cvUpload = cvUpload;

// Reels: video written to a temp file on disk (up to 40 MB, never in memory) + client thumbnail.
const fsSync = require('fs');
const cryptoMod = require('crypto');
const envCfg = require('../config/env');

const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp']);
const reelUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fsSync.mkdir(envCfg.uploadTmpDir, { recursive: true }, (err) => cb(err, envCfg.uploadTmpDir));
    },
    filename: (req, file, cb) => cb(null, `${cryptoMod.randomBytes(12).toString('hex')}.part`),
  }),
  limits: { fileSize: 40 * 1024 * 1024, files: 2, fields: 10 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video' && VIDEO_TYPES.has(file.mimetype)) return cb(null, true);
    if (file.fieldname === 'thumbnail' && IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
    const err = new Error(file.fieldname === 'video' ? 'Format vidéo non pris en charge. Utilisez une vidéo MP4 ou MOV.' : 'Miniature invalide.');
    err.status = 422;
    return cb(err);
  },
});

module.exports.reelUpload = reelUpload;
