const admin = require("firebase-admin");

/**
 * Initialize Firebase using ENV JSON (Render-safe)
 * Uses FIREBASE_SERVICE_ACCOUNT instead of file path
 */
const initFirebase = () => {
  if (admin.apps.length > 0) return admin.app();

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable");
  }

  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
      storageBucket: `${serviceAccount.project_id}.appspot.com`,
    });

    console.log("✅ Firebase Admin SDK initialized successfully.");
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
