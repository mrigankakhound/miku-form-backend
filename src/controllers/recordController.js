const mongoose = require('mongoose');
const SolarRecord = require('../models/SolarRecord');
const { PLANT_CAPACITY_OPTIONS } = require('../models/SolarRecord');
const cloudinary = require('../config/cloudinary');
const { generatePDF } = require('../utils/pdfGenerator');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function deleteCloudinaryImages(record) {
  const ids = [
    record.photo1?.publicId,
    record.photo2?.publicId,
    record.photo3?.publicId,
    record.photo4?.publicId,
    record.photo5?.publicId,
  ].filter(Boolean);
  for (const publicId of ids) {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (err) {
      console.error(`Failed to delete Cloudinary image ${publicId}:`, err.message);
    }
  }
}

async function cleanupUploadedFiles(files) {
  if (!files) return;
  const uploadedIds = Object.values(files)
    .flat()
    .map((f) => f.filename)
    .filter(Boolean);
  for (const pid of uploadedIds) {
    try { await cloudinary.uploader.destroy(pid); } catch (_) {}
  }
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/records
 * Create a new solar record.
 * Required photos: photo1 (Inverter), photo2 (Panel), photo3 (Earth), photo4 (LA)
 * Optional photo:  photo5
 */
const createRecord = async (req, res) => {
  try {
    const {
      consumerName,
      consumerNo,
      contactNumber,
      applicationReferenceNo,
      address,
      plantCapacity,
      installationDate,
      subDivision,
      systemCommissioningDate,
      vendorName,
    } = req.body;

    // Validate required text fields (systemCommissioningDate is optional)
    const requiredFields = {
      consumerName,
      consumerNo,
      contactNumber,
      applicationReferenceNo,
      address,
      plantCapacity,
      installationDate,
      subDivision,
      vendorName,
    };

    for (const [key, val] of Object.entries(requiredFields)) {
      if (!val || String(val).trim() === '') {
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: `Field '${key}' is required.` });
      }
    }

    // Validate plantCapacity is one of the allowed options
    if (!PLANT_CAPACITY_OPTIONS.includes(plantCapacity.trim())) {
      await cleanupUploadedFiles(req.files);
      return res.status(400).json({
        error: `Invalid plant capacity. Must be one of: ${PLANT_CAPACITY_OPTIONS.join(', ')}.`,
      });
    }

    // Validate all 4 required photos were uploaded (photo5 is optional)
    if (
      !req.files ||
      !req.files.photo1 ||
      !req.files.photo2 ||
      !req.files.photo3 ||
      !req.files.photo4
    ) {
      await cleanupUploadedFiles(req.files);
      return res.status(400).json({
        error: 'Inverter Photo, Panel Photo, Earth Photo, and LA Photo are all required.',
      });
    }

    const photo1File = req.files.photo1[0];
    const photo2File = req.files.photo2[0];
    const photo3File = req.files.photo3[0];
    const photo4File = req.files.photo4[0];
    const photo5File = req.files.photo5 ? req.files.photo5[0] : null;

    const recordData = {
      consumerName:           consumerName.trim(),
      consumerNo:             consumerNo.trim(),
      contactNumber:          contactNumber.trim(),
      applicationReferenceNo: applicationReferenceNo.trim(),
      address:                address.trim(),
      plantCapacity:          plantCapacity.trim(),
      installationDate:       new Date(installationDate),
      subDivision:            subDivision.trim(),
      vendorName:             vendorName.trim(),
      photo1: { url: photo1File.path, publicId: photo1File.filename },
      photo2: { url: photo2File.path, publicId: photo2File.filename },
      photo3: { url: photo3File.path, publicId: photo3File.filename },
      photo4: { url: photo4File.path, publicId: photo4File.filename },
    };

    // systemCommissioningDate is optional
    if (systemCommissioningDate && String(systemCommissioningDate).trim() !== '') {
      recordData.systemCommissioningDate = new Date(systemCommissioningDate);
    }

    // photo5 is optional
    if (photo5File) {
      recordData.photo5 = { url: photo5File.path, publicId: photo5File.filename };
    }

    const record = await SolarRecord.create(recordData);

    res.status(201).json({ message: 'Record saved successfully.', record });
  } catch (err) {
    console.error('createRecord error:', err);

    // Handle multer file size error
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image size must not exceed 10 MB.' });
    }

    // Clean up any Cloudinary uploads on DB failure
    await cleanupUploadedFiles(req.files);

    res.status(500).json({ error: 'Unable to save record.' });
  }
};

/**
 * GET /api/records
 * Fetch all records, optional search query param.
 */
const getRecords = async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query = {
        $or: [
          { consumerName: regex },
          { consumerNo: regex },
          { applicationReferenceNo: regex },
          { vendorName: regex },
        ],
      };
    }

    const records = await SolarRecord.find(query).sort({ createdAt: -1 });
    res.json({ records });
  } catch (err) {
    console.error('getRecords error:', err);
    res.status(500).json({ error: 'Unable to fetch records.' });
  }
};

/**
 * GET /api/records/:id
 * Fetch a single record by ID.
 */
const getRecordById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid record ID.' });
    }

    const record = await SolarRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    res.json({ record });
  } catch (err) {
    console.error('getRecordById error:', err);
    res.status(500).json({ error: 'Unable to fetch record.' });
  }
};

/**
 * DELETE /api/records/:id
 * Delete record from MongoDB and clean up Cloudinary images.
 */
const deleteRecord = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid record ID.' });
    }

    const record = await SolarRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    // Delete from MongoDB first
    await SolarRecord.findByIdAndDelete(req.params.id);

    // Then clean up Cloudinary (log errors but don't fail the response)
    await deleteCloudinaryImages(record);

    res.json({ message: 'Record deleted successfully.' });
  } catch (err) {
    console.error('deleteRecord error:', err);
    res.status(500).json({ error: 'Unable to delete record.' });
  }
};

/**
 * GET /api/records/:id/pdf
 * Generate and stream a 3-page A4 PDF for the record.
 */
const generateRecordPDF = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid record ID.' });
    }

    const record = await SolarRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    // Sanitize consumer number for filename
    const safeConsumerNo = (record.consumerNo || 'unknown')
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .substring(0, 50);
    const filename = `DRT-Enterprise-${safeConsumerNo}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    // generatePDF returns a complete Buffer — send it directly.
    // Avoids stream pipe timing issues on Node.js 24+.
    const pdfBuffer = await generatePDF(record);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (err) {
    console.error('generateRecordPDF error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Unable to generate PDF.' });
    }
  }
};

module.exports = {
  createRecord,
  getRecords,
  getRecordById,
  deleteRecord,
  generateRecordPDF,
};
