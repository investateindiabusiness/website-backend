const admin = require("firebase-admin");

/**
 * Initialize Firebase using ENV JSON (Render-safe)
 * Uses FIREBASE_SERVICE_ACCOUNT instead of file path
 */
const initFirebase = () => {
  if (admin.apps.length > 0) return admin.app();

  try {
    let serviceAccount;
    const jsonPath = require('path').join(__dirname, '../service-account.json');

    if (require('fs').existsSync(jsonPath)) {
      console.log("[firebase] Using service-account.json file");
      serviceAccount = require(jsonPath);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log("[firebase] Using FIREBASE_SERVICE_ACCOUNT env var");
      let serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if (serviceAccountStr.startsWith("'") && serviceAccountStr.endsWith("'")) {
        serviceAccountStr = serviceAccountStr.slice(1, -1);
      }
      serviceAccount = JSON.parse(serviceAccountStr);
    } else {
      throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable or service-account.json file");
    }

    // Ensure private key has proper PEM formatting with newlines
    if (serviceAccount.private_key) {
      // If the key is a string with literal \n characters, they should be converted to actual newlines
      if (typeof serviceAccount.private_key === 'string' && !serviceAccount.private_key.includes('\n')) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
    }

    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.firebasestorage.app`;
    console.log(`[firebase] Initializing storage bucket: ${bucketName}`);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
      storageBucket: bucketName,
    });

  } catch (error) {
    console.error("[firebase] Initialization error:", error);
    throw error;
  }
};

// Initialize immediately
initFirebase();

const db = admin.firestore();

module.exports = {
  admin,
  getDb: () => db,
};
