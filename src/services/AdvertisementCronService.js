const { getDb } = require('../firebase');
const socketService = require('./SocketService');

class AdvertisementCronService {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    
    // Run every 15 seconds
    this.intervalId = setInterval(() => this.checkExpirations(), 15000);
    this.isRunning = true;
    console.log('[AdCron] Advertisement Cron Service started.');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isRunning = false;
      console.log('[AdCron] Advertisement Cron Service stopped.');
    }
  }

  async checkExpirations() {
    try {
      const db = getDb();
      // Get current date in YYYY-MM-DD local format
      const currentDate = new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();

      // Find all approved campaigns where endDate is less than currentDate
      const snapshot = await db.collection('advertisement_campaigns')
        .where('approvalStatus', '==', 'approved')
        .get();

      const expiredDocs = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.endDate < currentDate) {
          expiredDocs.push({ id: doc.id, ...data });
        }
      });

      if (expiredDocs.length === 0) return;

      console.log(`[AdCron] Found ${expiredDocs.length} expired campaigns.`);

      for (const campaign of expiredDocs) {
        // Guard: skip campaigns with missing required fields
        if (!campaign.slotId || !campaign.zoneId) {
          console.warn(`[AdCron] Skipping campaign ${campaign.id} — missing slotId or zoneId.`);
          continue;
        }

        // Run a transaction to safely mark as completed and release the slot
        await db.runTransaction(async (transaction) => {
          const campaignRef = db.collection('advertisement_campaigns').doc(campaign.id);
          const slotRef = db.collection('advertisement_slots').doc(campaign.slotId);

          const cDoc = await transaction.get(campaignRef);
          if (!cDoc.exists || cDoc.data().approvalStatus !== 'approved') return;

          // Mark campaign as completed
          transaction.update(campaignRef, {
            approvalStatus: 'completed',
            updatedAt: now
          });

          // Mark slot as not booked (or you can leave it booked if you don't want reuse, 
          // but releasing it is safer for cleanup)
          const sDoc = await transaction.get(slotRef);
          if (sDoc.exists) {
            transaction.update(slotRef, {
              isBooked: false,
              campaignId: null,
              updatedAt: now
            });
          }
        });

        // Fetch the default ad for this zone to broadcast to clients
        const zoneDoc = await db.collection('advertisement_zones').doc(campaign.zoneId).get();
        let fallbackPayload = null;
        if (zoneDoc.exists && zoneDoc.data().status === 'active') {
          fallbackPayload = {
            type: 'default',
            adContent: zoneDoc.data().defaultAd
          };
        }

        // Notify clients to fallback to default empty state
        socketService.emitAdUpdate(campaign.zoneId, fallbackPayload);
        console.log(`[AdCron] Campaign ${campaign.id} expired. Emitted fallback for zone ${campaign.zoneId}.`);
      }
    } catch (err) {
      console.error('[AdCron] Error checking expirations:', err);
    }
  }
}

module.exports = new AdvertisementCronService();
