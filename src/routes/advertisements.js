const express = require('express');
const { z } = require('zod');
const { getDb } = require('../firebase');
const { authenticate } = require('./auth');
const { ensureZonesSeeded } = require('./advertisementsAdmin');
const paymentService = require('../services/PaymentService');

const router = express.Router();

// --- Zod Validation Schemas ---

const bookingCreateSchema = z.object({
  zoneId: z.string().min(1, 'Zone ID is required'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  couponCode: z.string().optional(),
  adContent: z.object({
    imageUrl: z.string().url().or(z.string().length(0)),
    videoUrl: z.string().url().or(z.string().length(0)),
    text: z.string().min(1, 'Text content is required'),
    targetUrl: z.string().url().or(z.string().length(0))
  })
});

const bookingRectifySchema = z.object({
  adContent: z.object({
    imageUrl: z.string().url().or(z.string().length(0)),
    videoUrl: z.string().url().or(z.string().length(0)),
    text: z.string().min(1, 'Text content is required'),
    targetUrl: z.string().url().or(z.string().length(0))
  })
});

// --- PUBLIC / USER ENDPOINTS ---

/**
 * GET /api/advertisements/zones
 * Public. Retrieve all active zones and their basic display specifications/default ads.
 */
router.get('/zones', async (req, res) => {
  try {
    const db = getDb();
    await ensureZonesSeeded(db);

    const snapshot = await db.collection('advertisement_zones')
      .where('status', '==', 'active')
      .get();

    const zones = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        displayType: data.displayType || '',
        description: data.description || '',
        platform: data.platform,
        category: data.category,
        adType: data.adType,
        width: data.width,
        height: data.height,
        costPerDay: data.costPerDay,
        status: data.status,
        defaultAd: data.defaultAd,
        allowedBookers: data.allowedBookers || ['investor', 'builder', 'serviceProvider']
      };
    });

    res.status(200).json({ data: zones });
  } catch (err) {
    console.error('[Ad] Get zones error:', err);
    res.status(500).json({ message: 'Failed to fetch zones', error: err.message });
  }
});

/**
 * GET /api/advertisements/zones/:zoneId/slots
 * Public. Returns booked date ranges for this zone so the
 * frontend calendar can mark those days red. Active/future only.
 */
router.get('/zones/:zoneId/slots', async (req, res) => {
  try {
    const db = getDb();
    const { zoneId } = req.params;
    const currentDate = new Date().toISOString().split('T')[0];

    // Return campaigns that are not cancelled and end in the future
    const snapshot = await db.collection('advertisement_campaigns')
      .where('zoneId', '==', zoneId)
      .get();

    const booked = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(c =>
        c.endDate >= currentDate &&
        !['cancelled', 'rejected'].includes(c.approvalStatus)
      )
      .map(c => ({
        id: c.id,
        startDate: c.startDate,
        endDate: c.endDate,
        isBooked: true
      }));

    res.status(200).json({ data: booked });
  } catch (err) {
    console.error('[Ad] Get slots error:', err);
    res.status(500).json({ message: 'Failed to fetch booked slots', error: err.message });
  }
});

/**
 * POST /api/advertisements/bookings
 * Authenticated. Book a date range in a zone.
 * startDate is chosen by the user; endDate is auto-calculated from zone's campaignDuration.
 */
router.post('/bookings', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const parsed = bookingCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });
    }

    const { zoneId, startDate, endDate, adContent, couponCode } = parsed.data;

    // Validate startDate <= endDate
    if (endDate < startDate) {
      return res.status(400).json({ message: 'endDate must be after or equal to startDate' });
    }

    // Fetch zone
    const zoneDoc = await db.collection('advertisement_zones').doc(zoneId).get();
    if (!zoneDoc.exists || zoneDoc.data().status !== 'active') {
      return res.status(400).json({ message: 'Advertisement zone is not active or does not exist' });
    }
    const zoneData = zoneDoc.data();

    // Get user role for validation
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userRole = userDoc.exists ? userDoc.data().role : 'investor';

    // Check if user is allowed to book this zone
    // Skipped: allowing anyone to book for testing purposes as requested.

    // Calculate number of days and cost
    const msPerDay = 1000 * 60 * 60 * 24;
    const numberOfDays = Math.round((new Date(endDate) - new Date(startDate)) / msPerDay) + 1;
    const costPerDay = zoneData.costPerDay || 0;
    const baseCost = costPerDay * numberOfDays;

    // Ensure startDate is not in the past
    const currentDate = new Date().toISOString().split('T')[0];
    if (startDate < currentDate) {
      return res.status(400).json({ message: 'Cannot book a date in the past' });
    }

    // Check for overlap with existing active campaigns in this zone
    const existingSnapshot = await db.collection('advertisement_campaigns')
      .where('zoneId', '==', zoneId)
      .get();

    const hasOverlap = existingSnapshot.docs.some(doc => {
      const c = doc.data();
      if (['cancelled', 'rejected'].includes(c.approvalStatus)) return false;
      return startDate <= c.endDate && endDate >= c.startDate;
    });

    if (hasOverlap) {
      return res.status(400).json({
        message: 'The selected dates overlap with an existing booking. Please choose different dates.'
      });
    }

    const now = new Date().toISOString();
    let finalCost = baseCost;
    let appliedCoupon = null;

    // Handle Coupon
    if (couponCode) {
      const couponSnapshot = await db.collection('coupons')
        .where('code', '==', couponCode.toUpperCase())
        .limit(1)
        .get();

      if (couponSnapshot.empty) throw new Error('Invalid coupon code');

      const couponDoc = couponSnapshot.docs[0];
      const coupon = couponDoc.data();

      if (coupon.status !== 'active') throw new Error('Coupon is inactive');
      if (coupon.assignedTo && coupon.assignedTo !== req.user.uid) throw new Error('Coupon not assigned to you');
      if (coupon.usedCount >= coupon.maxUses) throw new Error('Coupon usage limit exceeded');
      if (coupon.validUntil && new Date(coupon.validUntil) < new Date(now)) throw new Error('Coupon expired');

      finalCost = Math.max(0, finalCost - coupon.discountAmount);
      appliedCoupon = {
        id: couponDoc.id,
        code: coupon.code,
        discountAmount: coupon.discountAmount
      };

      if (finalCost === 0) {
        await couponDoc.ref.update({ usedCount: coupon.usedCount + 1, updatedAt: now });
      }
    }

    const campaignData = {
      userId: req.user.uid,
      userEmail: req.user.email || '',
      zoneId,
      startDate,
      endDate,
      numberOfDays,
      costPerDay,
      cost: baseCost,
      finalCost,
      couponApplied: appliedCoupon,
      adContent,
      paymentStatus: finalCost > 0 ? 'pending' : 'completed',
      approvalStatus: finalCost > 0 ? 'pending_payment' : 'pending_review',
      rejectionReason: '',
      createdAt: now,
      updatedAt: now
    };

    const campaignRef = await db.collection('advertisement_campaigns').add(campaignData);

    // Notify User & Admins
    try {
      const { notifyUser, notifyAdmins, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      if (finalCost > 0) {
        await notifyUser(
          req.user.uid,
          NOTIFICATION_TYPES.STATUS_CHANGED,
          'Ad Booking Reserved',
          `Your advertisement campaign in zone ${zoneId} (${startDate} to ${endDate}) is reserved. Please complete the payment of $${finalCost} to submit it for review.`,
          null,
          { campaignId: campaignRef.id }
        );
        await notifyAdmins(
          NOTIFICATION_TYPES.NEW_AD_BOOKING,
          'New Ad Booking Reserved (Pending Payment)',
          `User ${req.user.email || req.user.uid} reserved campaign dates in zone ${zoneId} from ${startDate} to ${endDate} (Cost: $${finalCost}).`,
          null,
          { campaignId: campaignRef.id }
        );
      } else {
        await notifyUser(
          req.user.uid,
          NOTIFICATION_TYPES.STATUS_CHANGED,
          'Ad Booking Confirmed',
          `Your advertisement campaign in zone ${zoneId} (${startDate} to ${endDate}) has been confirmed and submitted for admin review.`,
          null,
          { campaignId: campaignRef.id }
        );
        await notifyAdmins(
          NOTIFICATION_TYPES.NEW_AD_BOOKING,
          'New Ad Booking Confirmed (Pending Review)',
          `User ${req.user.email || req.user.uid} booked a free campaign in zone ${zoneId} from ${startDate} to ${endDate}. Awaiting review.`,
          null,
          { campaignId: campaignRef.id }
        );
      }
    } catch (notifErr) {
      console.error('[AdRoute] Booking notifications failed:', notifErr.message);
    }

    if (finalCost > 0) {
      const payment = await paymentService.createPayment({
        userId: req.user.uid,
        amount: finalCost,
        currency: 'usd',
        paymentPurpose: 'ADVERTISEMENT',
        referenceType: 'ADVERTISEMENT',
        referenceId: campaignRef.id,
        metadata: { campaignId: campaignRef.id, zoneId }
      }, req);

      return res.status(201).json({
        message: 'Dates reserved. Please complete payment to activate your campaign.',
        data: { campaignId: campaignRef.id, cost: finalCost, payment }
      });
    }

    return res.status(201).json({
      message: 'Booking confirmed. Campaign is pending admin review.',
      data: { campaignId: campaignRef.id, cost: 0 }
    });

  } catch (err) {
    console.error('[Ad] Booking error:', err.message, err.stack);
    res.status(400).json({ message: err.message });
  }
});

/**
 * GET /api/advertisements/my-bookings
 * Authenticated. Retrieve all advertisement bookings made by the current user.
 */
router.get('/my-bookings', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('advertisement_campaigns')
      .where('userId', '==', req.user.uid)
      .get();

    const bookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort by createdAt descending
    bookings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.status(200).json({ data: bookings });
  } catch (err) {
    console.error('[Ad] Get my bookings error:', err);
    res.status(500).json({ message: 'Failed to fetch bookings', error: err.message });
  }
});

/**
 * PUT /api/advertisements/bookings/:bookingId/rectify
 * Authenticated. Rectify a rejected booking and re-submit it for admin review.
 */
router.put('/bookings/:bookingId/rectify', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const parsed = bookingRectifySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });
    }

    const { adContent } = parsed.data;

    const campaignRef = db.collection('advertisement_campaigns').doc(req.params.bookingId);
    const campaignDoc = await campaignRef.get();

    if (!campaignDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const campaignData = campaignDoc.data();

    // Verify ownership
    if (campaignData.userId !== req.user.uid) {
      return res.status(403).json({ message: 'Forbidden: You do not own this booking' });
    }

    // Must be in rejected status to rectify
    if (campaignData.approvalStatus !== 'rejected') {
      return res.status(400).json({ message: 'Only rejected campaigns can be rectified and re-submitted' });
    }

    const now = new Date().toISOString();
    await campaignRef.update({
      adContent,
      approvalStatus: 'pending_review',
      rejectionReason: '',
      updatedAt: now
    });

    // Notify admins & user of re-submission
    try {
      const { notifyAdmins, notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      await notifyAdmins(
        'AD_RESUBMITTED',
        'Advertisement Campaign Re-submitted',
        `A rejected campaign for zone ${campaignData.zoneId} has been rectified and re-submitted for review by ${req.user.email || req.user.uid}.`,
        null,
        { campaignId: req.params.bookingId }
      );
      await notifyUser(
        req.user.uid,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Ad Campaign Re-submitted',
        `Your rectified ad campaign content for zone ${campaignData.zoneId} has been successfully re-submitted for admin review.`,
        null,
        { campaignId: req.params.bookingId }
      );
    } catch (notifErr) {
      console.error('[AdRoute] Rectify booking notifications failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Campaign rectified and re-submitted for review successfully' });
  } catch (err) {
    console.error('[Ad] Rectify booking error:', err);
    res.status(500).json({ message: 'Failed to rectify booking', error: err.message });
  }
});

/**
 * POST /api/advertisements/bookings/:bookingId/cancel
 * Authenticated. Cancel a booking.
 */
router.post('/bookings/:bookingId/cancel', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const campaignRef = db.collection('advertisement_campaigns').doc(req.params.bookingId);
    const campaignDoc = await campaignRef.get();

    if (!campaignDoc.exists) return res.status(404).json({ message: 'Booking not found' });

    const campaignData = campaignDoc.data();
    if (campaignData.userId !== req.user.uid) {
      return res.status(403).json({ message: 'Forbidden: You do not own this booking' });
    }
    if (campaignData.approvalStatus === 'cancelled') {
      return res.status(400).json({ message: 'Campaign is already cancelled' });
    }

    const now = new Date().toISOString();

    // Refund coupon if applied
    if (campaignData.couponApplied?.id) {
      const couponRef = db.collection('coupons').doc(campaignData.couponApplied.id);
      const couponDoc = await couponRef.get();
      if (couponDoc.exists) {
        const cData = couponDoc.data();
        await couponRef.update({ usedCount: Math.max(0, (cData.usedCount || 1) - 1), updatedAt: now });
      }
    }

    await campaignRef.update({ approvalStatus: 'cancelled', updatedAt: now });
    res.status(200).json({ message: 'Booking cancelled successfully' });
  } catch (err) {
    console.error('[Ad] Cancel booking error:', err.message);
    res.status(400).json({ message: err.message });
  }
});

/**
 * GET /api/advertisements/active-ad/:zoneId
 * Public. Retrieve the currently winning/active ad for a zone.
 * If an approved campaign exists for today's date, it returns that ad.
 * Otherwise, it falls back to the zone's default ad.
 */
router.get('/active-ad/:zoneId', async (req, res) => {
  try {
    const db = getDb();
    const { zoneId } = req.params;

    // Get current date in YYYY-MM-DD local format
    const currentDate = new Date().toISOString().split('T')[0];

    // Query for any active booking (approved or pending_review after payment) for this zone
    const snapshot = await db.collection('advertisement_campaigns')
      .where('zoneId', '==', zoneId)
      .get();

    // Find if any campaign overlaps with today's date and has an active/approved status
    let activeCampaign = null;
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      // Include 'approved' and 'pending_review' (campaigns paid but awaiting admin approval)
      const isActive = ['approved', 'pending_review'].includes(data.approvalStatus);
      if (isActive && data.startDate <= currentDate && data.endDate >= currentDate) {
        activeCampaign = data;
      }
    });

    // If fetching for Properties module (zone4) and no specific zone4 ad is active,
    // mirror ANY active ad if its redirect URL points to a property.
    if (!activeCampaign && zoneId === 'zone4') {
      const allActiveSnapshot = await db.collection('advertisement_campaigns')
        .get();
        
      allActiveSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const isActive = ['approved', 'pending_review'].includes(data.approvalStatus);
        if (isActive && data.startDate <= currentDate && data.endDate >= currentDate) {
          if (data.adContent && data.adContent.targetUrl && data.adContent.targetUrl.includes('properties')) {
            activeCampaign = data;
          }
        }
      });
    }

    // Fetch zone format details
    await ensureZonesSeeded(db);
    const zoneDoc = await db.collection('advertisement_zones').doc(zoneId).get();

    if (!zoneDoc.exists) {
      return res.status(404).json({ message: 'Advertisement zone not found' });
    }

    const zoneData = zoneDoc.data();
    if (zoneData.status !== 'active') {
      return res.status(400).json({ message: 'Advertisement zone is inactive' });
    }

    const width = zoneData.width || 728;
    const height = zoneData.height || 90;

    if (activeCampaign) {
      return res.status(200).json({
        type: 'campaign',
        campaignId: activeCampaign.slotId, // or doc ID
        adContent: activeCampaign.adContent,
        width,
        height
      });
    }

    res.status(200).json({
      type: 'default',
      adContent: zoneData.defaultAd,
      width,
      height
    });

  } catch (err) {
    console.error('[Ad] Get active ad error:', err);
    res.status(500).json({ message: 'Failed to fetch active advertisement', error: err.message });
  }
});

module.exports = router;
