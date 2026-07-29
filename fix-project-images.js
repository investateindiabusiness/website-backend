const { admin, getDb } = require('./src/firebase');
const crypto = require('crypto');

const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'dev-investate-india-5d851.firebasestorage.app';

async function fixOldProjectImages() {
  const db = getDb();
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  
  const snapshot = await db.collection('projects').get();
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    let updated = false;
    const updates = {};
    
    // Fix Project Images array
    if (data.projectImages && Array.isArray(data.projectImages)) {
      const newImages = [];
      for (const imgUrl of data.projectImages) {
        if (imgUrl.includes('firebasestorage') && !imgUrl.includes('&token=')) {
          try {
            const url = new URL(imgUrl);
            let filePath = url.pathname.split('/o/')[1];
            if (filePath) {
              filePath = decodeURIComponent(filePath);
              const file = bucket.file(filePath);
              const downloadToken = crypto.randomUUID();
              await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
              
              const encodedBucket = encodeURIComponent(STORAGE_BUCKET);
              const encodedPath = encodeURIComponent(filePath);
              newImages.push(`https://firebasestorage.googleapis.com/v0/b/${encodedBucket}/o/${encodedPath}?alt=media&token=${downloadToken}`);
              updated = true;
            } else {
              newImages.push(imgUrl);
            }
          } catch (err) {
            console.error(`Failed to fix image for project ${doc.id}:`, err.message);
            newImages.push(imgUrl);
          }
        } else {
          newImages.push(imgUrl);
        }
      }
      updates.projectImages = newImages;
    }
    
    // Fix Project Documents array
    if (data.projectDocuments && Array.isArray(data.projectDocuments)) {
      const newDocs = [];
      for (const pdoc of data.projectDocuments) {
        if (pdoc.url && pdoc.url.includes('firebasestorage') && !pdoc.url.includes('&token=')) {
          try {
            const url = new URL(pdoc.url);
            let filePath = url.pathname.split('/o/')[1];
            if (filePath) {
              filePath = decodeURIComponent(filePath);
              const file = bucket.file(filePath);
              const downloadToken = crypto.randomUUID();
              await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
              
              const encodedBucket = encodeURIComponent(STORAGE_BUCKET);
              const encodedPath = encodeURIComponent(filePath);
              pdoc.url = `https://firebasestorage.googleapis.com/v0/b/${encodedBucket}/o/${encodedPath}?alt=media&token=${downloadToken}`;
              updated = true;
            }
          } catch (err) {
            console.error(`Failed to fix doc for project ${doc.id}:`, err.message);
          }
        }
        newDocs.push(pdoc);
      }
      updates.projectDocuments = newDocs;
    }
    
    if (updated) {
      await doc.ref.update(updates);
      console.log(`Fixed images/docs for project ${doc.id}`);
    }
  }
  
  console.log("Finished fixing old project images!");
}

fixOldProjectImages().catch(console.error);
