const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = require('../middleware/upload');
const {
  createRecord,
  getRecords,
  getRecordById,
  deleteRecord,
  generateRecordPDF,
} = require('../controllers/recordController');

// Upload up to 5 photos as separate named fields (photo4 and photo5 are optional)
const uploadFields = upload.fields([
  { name: 'photo1', maxCount: 1 },
  { name: 'photo2', maxCount: 1 },
  { name: 'photo3', maxCount: 1 },
  { name: 'photo4', maxCount: 1 },
  { name: 'photo5', maxCount: 1 },
]);

// Wrapper that catches multer errors (e.g. file size exceeded) before reaching the controller
function handleUpload(req, res, next) {
  uploadFields(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Image size must not exceed 5 MB.' });
      }
      return res.status(400).json({ error: err.message || 'File upload error.' });
    }
    next();
  });
}

router.post('/', handleUpload, createRecord);
router.get('/', getRecords);
router.get('/:id/pdf', generateRecordPDF);
router.get('/:id', getRecordById);
router.delete('/:id', deleteRecord);

module.exports = router;
