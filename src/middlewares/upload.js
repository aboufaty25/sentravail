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
          LIMIT_FILE_SIZE: 'Chaque photo doit faire moins de 5 Mo.',
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
