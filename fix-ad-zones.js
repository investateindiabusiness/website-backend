require('dotenv').config();
const { getDb } = require('./src/firebase');
const db = getDb();

async function updateZones() {
  try {
    const zonesRef = db.collection('advertisement_zones');
    const snapshot = await zonesRef.get();
    
    if (snapshot.empty) {
      console.log('No advertisement zones found.');
      return;
    }

    const batch = db.batch();
    let updatedCount = 0;

    const dimensionsMap = {
      zone1: { width: 970, height: 90 },
      zone2: { width: 970, height: 250 },
      zone3: { width: 970, height: 90 },
      zone4: { width: 970, height: 180 },
      zone5: { width: 728, height: 90 }
    };

    snapshot.forEach(doc => {
      const dims = dimensionsMap[doc.id] || { width: 728, height: 90 };
      batch.update(doc.ref, {
        width: dims.width,
        height: dims.height
      });
      updatedCount++;
      console.log(`Updating ${doc.id} to ${dims.width}x${dims.height}`);
    });

    if (updatedCount > 0) {
      await batch.commit();
      console.log(`Successfully updated ${updatedCount} advertisement zones to correct dimensions.`);
    }

  } catch (error) {
    console.error('Error updating zones:', error);
  } finally {
    process.exit(0);
  }
}

updateZones();
