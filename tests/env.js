const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-test-secret-test-secret';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'sentravail-test-uploads');
process.env.FEED_PAGE_SIZE = '3';
// Never hit Cloudinary from tests.
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CV_DIR = path.join(os.tmpdir(), 'sentravail-test-cvs');
