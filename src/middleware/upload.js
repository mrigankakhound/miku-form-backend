const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_SIZE_MB = 10; // 10 MB per image

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const consumerNo = (req.body.consumerNo || 'unknown')
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .substring(0, 40);

    const fieldIndex = file.fieldname.replace('photo', '');
    const publicId = `drt-enterprise/solar-records/consumer-${consumerNo}-photo-${fieldIndex}-${Date.now()}`;

    return {
      public_id: publicId,
      allowed_formats: ALLOWED_FORMATS,
      quality: 'auto',
      format: 'jpg',
    };
  },
});

const fileFilter = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (ALLOWED_FORMATS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${ALLOWED_FORMATS.join(', ')}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
});

module.exports = upload;
