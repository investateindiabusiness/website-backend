const express = require('express');
const { z } = require('zod');
const { getDb } = require('../firebase');
const { authenticate } = require('./auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const socketService = require('../services/SocketService');

const router = express.Router();

// --- Zod Validation Schemas ---

const zoneUpdateSchema = z.object({
  name: z.string().min(1, 'Zone name is required'),
  defaultZoneName: z.string().min(1, 'Default zone name is required'),
  platform: z.enum(['Web', 'Mobile']),
  category: z.string().min(1, 'Category is required'),
  adType: z.enum(['Image', 'Video', 'Text']),
  width: z.number().positive(),
  height: z.number().positive(),
  // costPerDay: price per day for flexible date-range bookings
  costPerDay: z.number().nonnegative(),
  availableDateRange: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD')
  }),
  availableTimeSlots: z.array(z.string()),
  status: z.enum(['active', 'inactive']),
  defaultAd: z.object({
    imageUrl: z.string().url().or(z.string().length(0)),
    videoUrl: z.string().url().or(z.string().length(0)),
    text: z.string(),
    targetUrl: z.string().url().or(z.string().length(0))
  })
});

const slotCreateSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  timeSlot: z.string().min(1, 'Time slot description is required')
});

const campaignReviewSchema = z.object({
  approvalStatus: z.enum(['approved', 'rejected']),
  rejectionReason: z.string().optional().default('')
});

// --- Predefined Zone Seeds ---
const PREDEFINED_ZONES = [
  {
    id: 'zone1',
    name: 'Home page Zone',
    displayType: 'Homepage Hero Leaderboard',
    description: 'Bottom of main homepage hero section',
    defaultZoneName: 'Default Home Page Banner',
    platform: 'Web',
    category: 'Real Estate',
    adType: 'Image',
    width: 970,
    height: 90,
    costPerDay: 5,
    campaignDuration: 1,
    availableDateRange: { start: '2026-06-01', end: '2026-12-31' },
    availableTimeSlots: ['All Day'],
    status: 'active',
    defaultAd: {
      imageUrl: 'https://placehold.co/970x90?text=Default+Builder+Dashboard+Ad',
      videoUrl: '',
      text: 'Grow your reach with Investate India',
      targetUrl: 'https://nrifederation.business'
    }
  },
  {
    id: 'zone2',
    name: 'Home page Zone 2',
    displayType: 'Homepage Mid-Page Banner',
    description: 'Between sections 3-4 on the main homepage',
    defaultZoneName: 'Default Public Investor Page Banner',
    platform: 'Web',
    category: 'Real Estate',
    adType: 'Image',
    width: 970,
    height: 250,
    costPerDay: 5,
    campaignDuration: 1,
    availableDateRange: { start: '2026-06-01', end: '2026-12-31' },
    availableTimeSlots: ['All Day'],
    status: 'active',
    defaultAd: {
      imageUrl: 'https://placehold.co/970x250?text=Default+Investor+Dashboard+Ad',
      videoUrl: '',
      text: 'Premium Investment Opportunities',
      targetUrl: 'https://nrifederation.business'
    }
  },
  {
    id: 'zone3',
    name: 'Investor Page',
    displayType: 'Investor Hero Leaderboard',
    description: 'Bottom of the Investor landing page hero',
    defaultZoneName: 'Default Investor Project Details Banner',
    platform: 'Web',
    category: 'Real Estate',
    adType: 'Image',
    width: 970,
    height: 90,
    costPerDay: 5,
    campaignDuration: 1,
    availableDateRange: { start: '2026-06-01', end: '2026-12-31' },
    availableTimeSlots: ['All Day'],
    status: 'active',
    defaultAd: {
      imageUrl: 'https://placehold.co/970x90?text=Default+Project+Details+Ad',
      videoUrl: '',
      text: 'Partner with Elite Developers',
      targetUrl: 'https://nrifederation.business'
    }
  },
  {
    id: 'zone4',
    name: 'Project Search Results Inline Ad',
    displayType: 'Properties Page Top Banner',
    description: 'Top of the Properties listing page',
    defaultZoneName: 'Default Project Search Results Banner',
    platform: 'Web',
    category: 'Real Estate',
    adType: 'Image',
    width: 970,
    height: 180,
    costPerDay: 5,
    campaignDuration: 1,
    availableDateRange: { start: '2026-06-01', end: '2026-12-31' },
    availableTimeSlots: ['All Day'],
    status: 'active',
    defaultAd: {
      imageUrl: 'https://placehold.co/970x180?text=Default+Search+Results+Ad',
      videoUrl: '',
      text: 'Looking for a specific property type?',
      targetUrl: 'https://nrifederation.business'
    }
  },
  {
    id: 'zone5',
    name: 'Projects/ Properties View page',
    displayType: 'Project Detail Page Banner',
    description: 'Inside individual project detail pages',
    defaultZoneName: 'Default Landing Page Banner',
    platform: 'Web',
    category: 'Real Estate',
    adType: 'Image',
    width: 728,
    height: 90,
    costPerDay: 5,
    campaignDuration: 1,
    availableDateRange: { start: '2026-06-01', end: '2026-12-31' },
    availableTimeSlots: ['All Day'],
    status: 'active',
    defaultAd: {
      imageUrl: 'https://placehold.co/728x90?text=Default+Landing+Page+Ad',
      videoUrl: '',
      text: 'Investate India - Fractional Real Estate Investment',
      targetUrl: 'https://nrifederation.business'
    }
  }
];

/**
 * Helper to ensure the fixed zones exist in DB.
 * If a zone is missing, it will be created.
 */
async function ensureZonesSeeded(db) {
  const now = new Date().toISOString();
  const batch = db.batch();

  // Fetch all zone documents in a single round-trip
  const refs = PREDEFINED_ZONES.map(zone => db.collection('advertisement_zones').doc(zone.id));
  const docs = await db.getAll(...refs);

  let hasUpdates = false;
  docs.forEach((doc, i) => {
    if (!doc.exists) {
      batch.set(refs[i], {
        ...PREDEFINED_ZONES[i],
        createdAt: now,
        updatedAt: now
      });
      hasUpdates = true;
    } else {
      // Merge updates into existing documents
      batch.set(refs[i], {
        name: PREDEFINED_ZONES[i].name,
        displayType: PREDEFINED_ZONES[i].displayType,
        description: PREDEFINED_ZONES[i].description,
        costPerDay: PREDEFINED_ZONES[i].costPerDay,
        width: PREDEFINED_ZONES[i].width,
        height: PREDEFINED_ZONES[i].height,
        updatedAt: now
      }, { merge: true });
      hasUpdates = true;
    }
  });

  if (hasUpdates) {
    await batch.commit();
  }
}

// ─── ENDPOINTS ─────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/advertisements/seed-zones
 * Seeds the fixed 5 advertisement zones.
 */
router.post('/seed-zones', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    await ensureZonesSeeded(db);
    res.status(200).json({ message: 'Advertisement zones seeded successfully' });
  } catch (err) {
    console.error('[AdAdmin] Seed zones error:', err);
    res.status(500).json({ message: 'Failed to seed advertisement zones', error: err.message });
  }
});

/**
 * GET /api/admin/advertisements/zones
 * List configurations for all zones.
 */
router.get('/zones', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    await ensureZonesSeeded(db);

    const snapshot = await db.collection('advertisement_zones').get();
    const zones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.status(200).json({ data: zones });
  } catch (err) {
    console.error('[AdAdmin] Get zones error:', err);
    res.status(500).json({ message: 'Failed to fetch zones', error: err.message });
  }
});

/**
 * GET /api/admin/advertisements/zones/:zoneId
 * Retrieve configuration of a single zone.
 */
router.get('/zones/:zoneId', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('advertisement_zones').doc(req.params.zoneId).get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Advertisement zone not found' });
    }

    res.status(200).json({ data: { id: doc.id, ...doc.data() } });
  } catch (err) {
    console.error('[AdAdmin] Get zone error:', err);
    res.status(500).json({ message: 'Failed to fetch zone details', error: err.message });
  }
});

/**
 * PUT /api/admin/advertisements/zones/:zoneId
 * Update an advertisement zone configuration.
 */
router.put('/zones/:zoneId', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const parsed = zoneUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });
    }

    const docRef = db.collection('advertisement_zones').doc(req.params.zoneId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Advertisement zone not found' });
    }

    const now = new Date().toISOString();
    await docRef.update({
      ...parsed.data,
      updatedAt: now
    });

    res.status(200).json({ message: 'Advertisement zone updated successfully' });
  } catch (err) {
    console.error('[AdAdmin] Update zone error:', err);
    res.status(500).json({ message: 'Failed to update zone', error: err.message });
  }
});

/**
 * POST /api/admin/advertisements/zones/:zoneId/slots
 * Create an available booking slot for a zone.
 */
router.post('/zones/:zoneId/slots', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const parsed = slotCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });
    }

    // Verify zone exists
    const zoneDoc = await db.collection('advertisement_zones').doc(req.params.zoneId).get();
    if (!zoneDoc.exists) {
      return res.status(404).json({ message: 'Advertisement zone not found' });
    }

    const now = new Date().toISOString();
    const slotData = {
      zoneId: req.params.zoneId,
      ...parsed.data,
      isBooked: false,
      campaignId: null,
      createdAt: now,
      updatedAt: now
    };

    const docRef = await db.collection('advertisement_slots').add(slotData);

    res.status(201).json({ message: 'Advertisement slot created successfully', id: docRef.id });
  } catch (err) {
    console.error('[AdAdmin] Create slot error:', err);
    res.status(500).json({ message: 'Failed to create slot', error: err.message });
  }
});

/**
 * GET /api/admin/advertisements/slots
 * View advertisement slots (can filter by zoneId).
 */
router.get('/slots', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const { zoneId } = req.query;

    let query = db.collection('advertisement_campaigns');
    if (zoneId) {
      query = query.where('zoneId', '==', zoneId);
    }

    const snapshot = await query.get();
    const currentDate = new Date().toISOString().split('T')[0];

    const slots = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(c => c.endDate >= currentDate && !['cancelled', 'rejected'].includes(c.approvalStatus))
      .map(c => ({
        id: c.id,
        zoneId: c.zoneId,
        startDate: c.startDate,
        endDate: c.endDate,
        isBooked: true,
        userEmail: c.userEmail || c.userId || 'Unknown User'
      }));

    res.status(200).json({ data: slots });
  } catch (err) {
    console.error('[AdAdmin] Get slots error:', err);
    res.status(500).json({ message: 'Failed to fetch slots', error: err.message });
  }
});

/**
 * DELETE /api/admin/advertisements/slots/:slotId
 * Delete a slot (only if it has not been booked).
 */
router.delete('/slots/:slotId', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const docRef = db.collection('advertisement_slots').doc(req.params.slotId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Slot not found' });
    }

    const slotData = doc.data();
    if (slotData.isBooked) {
      return res.status(400).json({ message: 'Cannot delete a slot that has already been booked' });
    }

    await docRef.delete();
    res.status(200).json({ message: 'Slot deleted successfully' });
  } catch (err) {
    console.error('[AdAdmin] Delete slot error:', err);
    res.status(500).json({ message: 'Failed to delete slot', error: err.message });
  }
});

/**
 * GET /api/admin/advertisements/bookings
 * List all campaign bookings with optional filters (e.g. zoneId, approvalStatus).
 */
router.get('/bookings', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const { zoneId, approvalStatus } = req.query;

    let query = db.collection('advertisement_campaigns');

    if (zoneId) {
      query = query.where('zoneId', '==', zoneId);
    }
    if (approvalStatus) {
      query = query.where('approvalStatus', '==', approvalStatus);
    }

    const snapshot = await query.get();
    const bookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.status(200).json({ data: bookings });
  } catch (err) {
    console.error('[AdAdmin] Get bookings error:', err);
    res.status(500).json({ message: 'Failed to fetch bookings', error: err.message });
  }
});

/**
 * PATCH /api/admin/advertisements/bookings/:bookingId/review
 * Approve or reject a campaign booking.
 */
router.patch('/bookings/:bookingId/review', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const parsed = campaignReviewSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });
    }

    const { approvalStatus, rejectionReason } = parsed.data;

    const campaignRef = db.collection('advertisement_campaigns').doc(req.params.bookingId);
    const campaignDoc = await campaignRef.get();

    if (!campaignDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const campaignData = campaignDoc.data();
    const now = new Date().toISOString();

    await campaignRef.update({
      approvalStatus,
      rejectionReason: approvalStatus === 'rejected' ? rejectionReason : '',
      updatedAt: now
    });

    // Determine current active campaign for the zone
    const currentDate = new Date().toISOString().split('T')[0];

    if (approvalStatus === 'approved') {
      // If the approved campaign is currently active, broadcast it
      if (campaignData.startDate <= currentDate && campaignData.endDate >= currentDate) {
        socketService.emitAdUpdate(campaignData.zoneId, {
          type: 'campaign',
          campaignId: campaignDoc.id,
          adContent: campaignData.adContent
        });
      }
    } else if (approvalStatus === 'rejected') {
      // If we reject a campaign, verify if there's any active campaign
      const activeSnapshot = await db.collection('advertisement_campaigns')
        .where('zoneId', '==', campaignData.zoneId)
        .where('approvalStatus', '==', 'approved')
        .get();

      let hasActive = false;
      activeSnapshot.forEach(doc => {
        const d = doc.data();
        if (d.startDate <= currentDate && d.endDate >= currentDate) hasActive = true;
      });

      // If no active campaign, push the fallback ad
      if (!hasActive) {
        const zoneDoc = await db.collection('advertisement_zones').doc(campaignData.zoneId).get();
        if (zoneDoc.exists && zoneDoc.data().status === 'active') {
          socketService.emitAdUpdate(campaignData.zoneId, {
            type: 'default',
            adContent: zoneDoc.data().defaultAd
          });
        }
      }
    }

    // Write a notification to the user
    try {
      const { notifyUser } = require('../utils/notificationHelper');
      const notificationTitle = approvalStatus === 'approved' ? 'Advertisement Approved' : 'Advertisement Changes Required';
      const notificationMsg = approvalStatus === 'approved'
        ? `Your campaign in zone ${campaignData.zoneId} from ${campaignData.startDate} to ${campaignData.endDate} has been approved.`
        : `Your campaign in zone ${campaignData.zoneId} was rejected. Reason: ${rejectionReason}`;

      await notifyUser(
        campaignData.userId,
        approvalStatus === 'approved' ? 'AD_APPROVED' : 'AD_REJECTED',
        notificationTitle,
        notificationMsg,
        null,
        { campaignId: req.params.bookingId }
      );
    } catch (notifErr) {
      console.error('[AdAdmin] Notification writing failed:', notifErr.message);
    }

    res.status(200).json({ message: `Campaign booking successfully reviewed: ${approvalStatus}` });
  } catch (err) {
    console.error('[AdAdmin] Review campaign error:', err);
    res.status(500).json({ message: 'Failed to process campaign review', error: err.message });
  }
});

module.exports = router;
module.exports.ensureZonesSeeded = ensureZonesSeeded;
