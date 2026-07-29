const express = require('express');
const { getDb, admin } = require('../firebase');
const { authenticate } = require('./auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');

const router = express.Router();
const db = getDb();

/**
 * PATCH /api/admin/verify-builder/:uid
 * Verify or revoke a builder's account
 */
router.patch('/verify-builder/:uid', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res, next) => {
  try {
    const { uid } = req.params;
    const { isVerified } = req.body;

    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Builder not found." });
    }

    await userRef.update({
      isVerified: isVerified,
      updatedAt: new Date().toISOString()
    });

    // Notify Builder
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const title = isVerified ? 'Builder Profile Verified' : 'Builder Profile Verification Changed';
      const msg = isVerified
        ? 'Your builder profile has been officially verified by our compliance team. You now have full dashboard access.'
        : 'Your builder profile verification status has been updated. Please contact support if you have any questions.';
      await notifyUser(
        uid,
        isVerified ? NOTIFICATION_TYPES.USER_VERIFIED : NOTIFICATION_TYPES.STATUS_CHANGED,
        title,
        msg,
        null,
        {},
        ['builder']
      );
    } catch (notifErr) {
      console.error('[AdminRoute] Builder verification notification failed:', notifErr.message);
    }

    res.status(200).json({ message: `Builder verification status updated to ${isVerified}` });
  } catch (err) {
    console.error("Verification Error:", err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

/**
 * GET /api/admin/users
 * Paginated list of all users with optional role filter and search
 * Query params: page, limit, role, search
 */
router.get('/users', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      role,
      search
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Build the query
    let query = db.collection('users');

    // Filter by role if provided
    if (role && role !== 'all') {
      query = query.where('role', '==', role);
    }

    // Fetch matching records without ordering in firestore (avoids composite index error)
    const snapshot = await query.get();
    let users = snapshot.docs.map(doc => {
      const data = doc.data();
      // Omit sensitive fields
      const { password, ...safeData } = data;
      return { id: doc.id, ...safeData };
    });

    // Sort in memory (newest first)
    users.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    // Apply search filter in memory
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      users = users.filter(u =>
        (u.email || '').toLowerCase().includes(q) ||
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.companyName || '').toLowerCase().includes(q) ||
        (u.uid || '').toLowerCase().includes(q)
      );
    }

    const totalRecords = users.length;

    // Apply pagination in memory
    const offset = (pageNum - 1) * limitNum;
    users = users.slice(offset, offset + limitNum);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalRecords,
        pages: Math.ceil(totalRecords / limitNum)
      }
    });
  } catch (err) {
    console.error("Admin Users Error:", err);
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
});

/**
 * GET /api/admin/kyc-submissions
 * Returns a list of investors who have submitted KYC documents (kycStatus is not 'not_started')
 */
router.get('/kyc-submissions', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res, next) => {
  try {
    const snapshot = await db.collection('users').where('role', '==', 'investor').get();
    const investors = snapshot.docs.map(doc => {
      const data = doc.data();
      const { password, ...safe } = data;
      return { id: doc.id, ...safe };
    });

    // Build passport number map to check for duplicates
    const passportMap = {};
    investors.forEach(inv => {
      if (inv.passportNumber) {
        const num = inv.passportNumber.trim().toUpperCase();
        if (!passportMap[num]) {
          passportMap[num] = [];
        }
        passportMap[num].push({ uid: inv.id, email: inv.email, name: inv.fullName || inv.name });
      }
    });

    const submissions = investors
      .filter(u => u.kycStatus && u.kycStatus !== 'not_started')
      .map(inv => {
        if (inv.passportNumber) {
          const num = inv.passportNumber.trim().toUpperCase();
          const duplicates = (passportMap[num] || []).filter(u => u.uid !== inv.id);
          return {
            ...inv,
            isDuplicatePassport: duplicates.length > 0,
            duplicatePassportUsers: duplicates
          };
        }
        return {
          ...inv,
          isDuplicatePassport: false,
          duplicatePassportUsers: []
        };
      });

    // Sort in-memory (newest first)
    submissions.sort((a, b) => {
      const dateA = a.kycSubmittedAt ? new Date(a.kycSubmittedAt).getTime() : 0;
      const dateB = b.kycSubmittedAt ? new Date(b.kycSubmittedAt).getTime() : 0;
      return dateB - dateA;
    });

    res.json({ success: true, data: submissions });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/verify-kyc/:uid
 * Approve or reject an investor's KYC verification status
 */
router.patch('/verify-kyc/:uid', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res, next) => {
  try {
    const { uid } = req.params;
    const { kycStatus } = req.body;

    if (!['approved', 'rejected'].includes(kycStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC status' });
    }

    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updateData = {
      kycStatus,
      isKycVerified: kycStatus === 'approved',
      kycVerifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await userRef.update(updateData);

    // Notify investor about their KYC result
    try {
      await notifyUser(
        uid,
        kycStatus === 'approved' ? NOTIFICATION_TYPES.KYC_APPROVED : NOTIFICATION_TYPES.KYC_REJECTED,
        kycStatus === 'approved' ? 'KYC Approved' : 'KYC Rejected',
        kycStatus === 'approved'
          ? 'Your KYC has been approved. You can now access investor features.'
          : 'Your KYC has been rejected. Please update your documents and resubmit.',
        null,
        {},
        ['investor']
      );
    } catch (notifErr) {
      console.error('[Admin] KYC notification failed:', notifErr.message);
    }

    res.json({ success: true, message: `Investor KYC status updated to ${kycStatus}` });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/membership-pricing
 * Returns per-role annual membership prices (USD) from Firestore config
 */
router.get('/membership-pricing', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res, next) => {
  try {
    const configRef = db.collection('config').doc('membership_pricing');
    const doc = await configRef.get();

    const defaults = {
      investor: 49,
      builder: 99,
      serviceProvider: 49,
      currency: 'usd',
      updatedAt: null
    };

    if (!doc.exists) {
      // Seed defaults on first read
      await configRef.set({ ...defaults, updatedAt: new Date().toISOString() });
      return res.json({ success: true, data: defaults });
    }

    res.json({ success: true, data: { ...defaults, ...doc.data() } });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/membership-pricing
 * Update per-role annual membership prices (USD)
 * Body: { investor?: number, builder?: number, serviceProvider?: number }
 */
router.patch('/membership-pricing', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res, next) => {
  try {
    const { investor, builder, serviceProvider } = req.body;

    const updates = { updatedAt: new Date().toISOString(), currency: 'usd' };
    if (investor !== undefined) {
      if (typeof investor !== 'number' || investor <= 0) {
        return res.status(400).json({ success: false, message: 'investor price must be a positive number (USD)' });
      }
      updates.investor = investor;
    }
    if (builder !== undefined) {
      if (typeof builder !== 'number' || builder <= 0) {
        return res.status(400).json({ success: false, message: 'builder price must be a positive number (USD)' });
      }
      updates.builder = builder;
    }
    if (serviceProvider !== undefined) {
      if (typeof serviceProvider !== 'number' || serviceProvider <= 0) {
        return res.status(400).json({ success: false, message: 'serviceProvider price must be a positive number (USD)' });
      }
      updates.serviceProvider = serviceProvider;
    }

    await db.collection('config').doc('membership_pricing').set(updates, { merge: true });
    res.json({ success: true, message: 'Membership pricing updated successfully', data: updates });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
