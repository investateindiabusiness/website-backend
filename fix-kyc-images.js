const { admin, getDb } = require('./src/firebase');
const crypto = require('crypto');

const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'dev-investate-india-5d851.firebasestorage.app';

async function fixOldKycImages() {
  const db = getDb();
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  
  const snapshot = await db.collection('users').where('role', '==', 'investor').get();
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    let updated = false;
    const updates = {};
    
    if (data.kycPassportUrl && data.kycPassportUrl.includes('firebasestorage') && !data.kycPassportUrl.includes('&token=')) {
      try {
        const url = new URL(data.kycPassportUrl);
        let filePath = url.pathname.split('/o/')[1];
        if (filePath) {
          filePath = decodeURIComponent(filePath);
          
          const file = bucket.file(filePath);
          const downloadToken = crypto.randomUUID();
          
          await file.setMetadata({
            metadata: {
              firebaseStorageDownloadTokens: downloadToken
            }
          });
          
          const encodedBucket = encodeURIComponent(STORAGE_BUCKET);
          const encodedPath = encodeURIComponent(filePath);
          const newUrl = `https://firebasestorage.googleapis.com/v0/b/${encodedBucket}/o/${encodedPath}?alt=media&token=${downloadToken}`;
          
          updates.kycPassportUrl = newUrl;
          updated = true;
          console.log(`Fixed kycPassportUrl for user ${doc.id}`);
        }
      } catch (err) {
        console.error(`Failed to fix kycPassportUrl for user ${doc.id}:`, err.message);
      }
    }
    
    if (updated) {
      await doc.ref.update(updates);
    }
  }
  
  console.log("Finished fixing old KYC images!");
}

fixOldKycImages().catch(console.error);
