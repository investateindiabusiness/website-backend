const admin = require('firebase-admin');

try {
  admin.initializeApp({
    credential: admin.credential.cert(require('./service-account.json')),
    storageBucket: 'investate-india.appspot.com'
  });
} catch (e) {
  if (!/already exists/.test(e.message)) {
    console.error('Firebase initialization error', e.stack);
  }
}

const db = admin.firestore();

async function activateCampaignsToday() {
  try {
    const today = new Date().toISOString().split('T')[0]; // "2026-07-08"
    const snapshot = await db.collection('advertisement_campaigns').get();
    
    let updated = 0;
    const batch = db.batch();

    snapshot.forEach(doc => {
      const data = doc.data();
      // If it's approved or pending_review, let's force the start date to today so it shows up!
      if (['approved', 'pending_review'].includes(data.approvalStatus)) {
        batch.update(doc.ref, {
          startDate: today
        });
        updated++;
        console.log(`Updated campaign ${doc.id} startDate to ${today}`);
      }
    });

    if (updated > 0) {
      await batch.commit();
      console.log(`Successfully updated ${updated} campaigns.`);
    } else {
      console.log('No campaigns needed updating.');
    }

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

activateCampaignsToday();
