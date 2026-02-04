const admin = require('firebase-admin');
const path = require('path');

/**
 * Initialize Firebase Admin SDK using Service Account
 * The GOOGLE_APPLICATION_CREDENTIALS env var should be the absolute 
 * or relative path to your service-account-file.json
 */
const initFirebase = () => {
  if (admin.apps.length > 0) return admin.app();

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credentialsPath) {
    throw new Error(
      'Missing GOOGLE_APPLICATION_CREDENTIALS in .env file. Real Firebase connection is required.'
    );
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(require(path.resolve(credentialsPath))),
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
    
    console.log('[firebase] Admin SDK initialized successfully.');
  } catch (error) {
    console.error('[firebase] Initialization error:', error);
    throw error;
  }
};

// Initialize immediately
initFirebase();

const db = admin.firestore();

module.exports = {
  admin,
  getDb: () => db
};