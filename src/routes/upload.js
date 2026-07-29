const express = require('express');
const router = express.Router();
const multer = require('multer');
const { admin } = require('../firebase');
const { requireRole } = require('../middleware/rbac');
const { authenticate } = require('./auth');

const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'dev-investate-india-5d851.firebasestorage.app';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for images
});

const uploadFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for general files/docs
});

/**
 * Upload a file to Firebase Storage via REST API
 * This approach works with both old (.appspot.com) and new (.firebasestorage.app) bucket formats
 */
async function uploadToFirebase(fileBuffer, filePath, contentType) {
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  const file = bucket.file(filePath);

  const crypto = require('crypto');
  const downloadToken = crypto.randomUUID();

  await file.save(fileBuffer, {
    metadata: {
      contentType: contentType,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken
      }
    }
  });

  const encodedBucket = encodeURIComponent(STORAGE_BUCKET);
  const encodedPath = encodeURIComponent(filePath);
  
  // Build the public download URL with the token
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${encodedBucket}/o/${encodedPath}?alt=media&token=${downloadToken}`;
  return publicUrl;
}

const path = require('path');
const fs = require('fs');

async function saveFileLocally(fileBuffer, filePath) {
  const absolutePath = path.join(__dirname, '../../public/uploads', filePath);
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(absolutePath, fileBuffer);
}

/**
 * Upload an image to Firebase Storage (with local fallback)
 * POST /api/upload/image
 */
router.post('/image', authenticate, requireRole('builder', 'admin', 'super_admin', 'investor', 'serviceProvider'), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const folder = req.query.folder || 'misc';
    const originalName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${folder}/${Date.now()}_${originalName}`;

    // Always upload to Firebase Storage — no local fallback
    const publicUrl = await uploadToFirebase(req.file.buffer, filePath, req.file.mimetype);
    console.log(`[upload] Uploaded to Firebase Storage: ${publicUrl}`);

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      url: publicUrl,
    });
  } catch (error) {
    console.error('[upload] Image upload error:', error);
    res.status(500).json({ error: 'Failed to upload image to Firebase Storage', detail: error.message });
  }
});

/**
 * Upload a general file/document to Firebase Storage (with local fallback)
 * POST /api/upload/file
 */
router.post('/file', authenticate, requireRole('builder', 'admin', 'super_admin', 'investor', 'serviceProvider'), uploadFile.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const folder = req.query.folder || 'misc';
    const originalName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${folder}/${Date.now()}_${originalName}`;

    // Always upload to Firebase Storage — no local fallback
    const publicUrl = await uploadToFirebase(req.file.buffer, filePath, req.file.mimetype);
    console.log(`[upload] Uploaded to Firebase Storage: ${publicUrl}`);

    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      url: publicUrl,
    });
  } catch (error) {
    console.error('[upload] File upload error:', error);
    res.status(500).json({ error: 'Failed to upload file to Firebase Storage', detail: error.message });
  }
});

module.exports = router;
