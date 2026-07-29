const express = require('express');
const { getDb, admin } = require('../firebase');
const { authenticate } = require('./auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();
const db = getDb();

// GET: Fetch all Service Providers (for Admin)
router.get('/', authenticate, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const snapshot = await db.collection('users')
      .where('role', '==', 'serviceProvider')
      .get();

    const data = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET: Fetch Dashboard Statistics (for Service Provider)
router.get('/dashboard-stats', authenticate, requireRole('serviceProvider'), async (req, res, next) => {
  try {
    // 1. Get total builders count
    const buildersSnapshot = await db.collection('users')
      .where('role', '==', 'builder')
      .get();
    const totalBuilders = buildersSnapshot.size;

    // 2. Get total investors count
    const investorsSnapshot = await db.collection('users')
      .where('role', '==', 'investor')
      .get();
    const totalInvestors = investorsSnapshot.size;

    // 3. Get campaigns for this service provider
    const campaignsSnapshot = await db.collection('advertisement_campaigns')
      .where('userId', '==', req.user.uid)
      .get();

    const campaigns = campaignsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const totalCampaigns = campaigns.length;
    
    // Sum of cost for paid or approved/active campaigns
    const totalSpent = campaigns
      .filter(c => c.paymentStatus === 'paid' || c.approvalStatus === 'approved')
      .reduce((sum, c) => sum + (Number(c.cost) || 0), 0);

    const currentDate = new Date().toISOString().split('T')[0];
    const activeCampaigns = campaigns.filter(c => 
      c.approvalStatus === 'approved' && 
      c.startDate <= currentDate && 
      c.endDate >= currentDate
    ).length;

    res.json({
      totalBuilders,
      totalInvestors,
      totalCampaigns,
      activeCampaigns,
      totalSpent
    });
  } catch (err) {
    next(err);
  }
});

// POST: Admin Approves Service Provider Form 1 (Direct to Complete because no Form 2)
router.post('/approve-form1/:uid', authenticate, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { uid } = req.params;
    
    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "User not found." });
    }

    const userData = doc.data();
    
    const updatePayload = {
      onboardingStatus: 'complete', // Service Providers bypass Form 2 and go straight to complete
      isVerified: true,
      updatedAt: new Date().toISOString()
    };

    if (userData.pendingChanges) {
      Object.assign(updatePayload, userData.pendingChanges);
      updatePayload.pendingChanges = admin.firestore.FieldValue.delete();
    }

    await userRef.update(updatePayload);

    // Notify Service Provider of approval
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      await notifyUser(
        uid,
        NOTIFICATION_TYPES.USER_VERIFIED,
        'Service Provider Account Approved!',
        'Congratulations! Your service provider registration has been approved by our team. You now have full access to your dashboard, directory, and advertising features.',
        null,
        {},
        ['serviceProvider']
      );
    } catch (notifErr) {
      console.error('[SPRoute] Approval notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Service Provider approved successfully. Verification status is active.' });
  } catch (err) {
    next(err);
  }
});

// POST: Admin Requests Changes on Service Provider Form 1
router.post('/request-changes/:id', authenticate, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { fieldsRequested } = req.body;

    const docRef = db.collection('users').doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) return res.status(404).json({ message: 'User not found' });

    await docRef.update({
      onboardingStatus: 'form1_changes_requested',
      adminRequests: fieldsRequested,
      updatedAt: new Date().toISOString()
    });

    // Notify Service Provider that changes are needed
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const fieldsMsg = fieldsRequested && fieldsRequested.length > 0
        ? ` Requested corrections: ${fieldsRequested.join(', ')}.`
        : '';
      await notifyUser(
        req.params.id,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Profile Update Required',
        `The administrator has reviewed your registration and requires some corrections before approval.${fieldsMsg} Please log in and resubmit your profile.`,
        null,
        {},
        ['serviceProvider']
      );
    } catch (notifErr) {
      console.error('[SPRoute] Changes requested notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Changes requested successfully.' });
  } catch (err) {
    next(err);
  }
});

// POST: Admin final toggle for Service Provider
router.post('/verify-final/:id', authenticate, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { isVerified } = req.body;

    const docRef = db.collection('users').doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) return res.status(404).json({ message: 'User not found' });

    const updateData = {
      isVerified: isVerified,
      updatedAt: new Date().toISOString()
    };

    if (isVerified) {
      updateData.onboardingStatus = 'complete';
    } else {
      updateData.onboardingStatus = 'form1_rejected';
    }

    await docRef.update(updateData);

    // Notify Service Provider of verification result
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const title = isVerified ? 'Account Access Restored' : 'Account Access Revoked';
      const msg = isVerified
        ? 'Your service provider account access has been restored. You can now log in and access your dashboard.'
        : 'Your service provider account access has been revoked. Please contact support for assistance.';
      await notifyUser(
        req.params.id,
        isVerified ? NOTIFICATION_TYPES.USER_VERIFIED : NOTIFICATION_TYPES.USER_SUSPENDED,
        title,
        msg,
        null,
        {},
        ['serviceProvider']
      );
    } catch (notifErr) {
      console.error('[SPRoute] Verify-final notification failed:', notifErr.message);
    }

    res.status(200).json({ message: `Service Provider verification updated to ${isVerified}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
