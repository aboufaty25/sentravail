const multer = require('multer');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// One image per request (logo, poster, CV photo), 2 MB max — the browser compresses before upload.
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
function imageFileFilter(req, file, cb) {
  if (IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
  const err = new Error('Format d’image non pris en charge (JPEG, PNG ou WebP uniquement).');
  err.status = 422;
  return cb(err);
}
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 30 },
  fileFilter: imageFileFilter,
});

// Admin branding: the image plus a browser-generated 192 px icon.
const brandingImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES, files: 2, fields: 10 },
  fileFilter: imageFileFilter,
});

// Job form: offer image + company logo, plus the form fields.
const jobImagesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES, files: 2, fields: 40 },
  fileFilter: imageFileFilter,
});

// Turns multer errors into user-facing 4xx errors.
function handleUploadErrors(mw) {
  return (req, res, next) =>
    mw(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const messages = {
          LIMIT_FILE_SIZE: req.path.includes('postuler') || req.path === '/cv/importer'
            ? 'Le CV doit faire moins de 5 Mo.'
            : "L'image doit faire moins de 2 Mo.",
          LIMIT_FILE_COUNT: 'Une seule image par publication.',
          LIMIT_UNEXPECTED_FILE: 'Une seule image par publication.',
        };
        err.message = messages[err.code] || 'Envoi du fichier impossible.';
        err.status = 422;
      }
      return next(err);
    });
}

module.exports = { imageUpload, brandingImageUpload, jobImagesUpload, handleUploadErrors };

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

