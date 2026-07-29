const express = require('express');
const { getDb, admin } = require('../firebase');
const { authenticate } = require('./auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();
const db = getDb();

/**
 * GET /api/investors
 * Paginated list of investors with search and status filters
 * Query: page, limit, search, status (all|verified|unverified|pending|complete), type (individual|company|nri)
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = '', status = 'all', type = 'all' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    let query = db.collection('users').where('role', '==', 'investor');

    // Server-side status filter
    if (status === 'verified') {
      query = query.where('isVerified', '==', true);
    } else if (status === 'unverified') {
      query = query.where('isVerified', '==', false);
    } else if (status === 'complete') {
      query = query.where('onboardingStatus', '==', 'complete');
    } else if (status === 'pending') {
      query = query.where('onboardingStatus', '==', 'form1_pending');
    } else if (status === 'final_review') {
      query = query.where('onboardingStatus', '==', 'form2_pending');
    }

    // Investor type filter
    if (type !== 'all') {
      query = query.where('investorType', '==', type);
    }

    // Get all matching documents to sort and paginate in-memory
    const snapshot = await query.get();
    let data = snapshot.docs.map(doc => {
      const { password, ...safe } = doc.data();
      return { id: doc.id, ...safe };
    });

    // In-memory sorting (newest first)
    data.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    // In-memory search (Firestore doesn't support native full-text)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      data = data.filter(inv =>
        (inv.fullName || '').toLowerCase().includes(q) ||
        (inv.email || '').toLowerCase().includes(q) ||
        (inv.companyName || '').toLowerCase().includes(q) ||
        (inv.city || '').toLowerCase().includes(q) ||
        (inv.contactNumber || '').includes(q)
      );
    }

    const total = data.length;

    // In-memory pagination slicing
    const offset = (pageNum - 1) * limitNum;
    const paginatedData = data.slice(offset, offset + limitNum);

    res.json({
      success: true,
      data: paginatedData,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/investors/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await db.collection('users').doc(req.params.id).get();
    if (!doc.exists || doc.data()?.role !== 'investor') {
      return res.status(404).json({ message: 'Investor not found' });
    }
    const { password, ...safe } = doc.data();
    res.json({ id: doc.id, ...safe });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/investors/approve-investor-form1/:uid
 */
/**
 * POST /api/investors/approve-investor-form1/:uid
 */
router.post('/approve-investor-form1/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;
    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'User not found.' });

    const userData = doc.data();
    const updatePayload = { onboardingStatus: 'form1_approved', updatedAt: new Date().toISOString() };

    if (userData.pendingChanges) {
      Object.assign(updatePayload, userData.pendingChanges);
      updatePayload.pendingChanges = admin.firestore.FieldValue.delete();
    }

    await userRef.update(updatePayload);

    // Notify Investor
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      await notifyUser(
        uid,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Investor Onboarding Form 1 Approved',
        'Your onboarding Form 1 details have been approved! You can now proceed to submit your passport KYC verification.',
        null,
        {},
        ['investor']
      );
    } catch (notifErr) {
      console.error('[InvestorRoute] Form 1 approval notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Form 1 approved successfully. Investor can now proceed to Form 2.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/investors/request-investor-changes/:id
 */
router.post('/request-investor-changes/:id', async (req, res, next) => {
  try {
    const { fieldsRequested } = req.body;
    const docRef = db.collection('users').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'User not found' });
    
    const userData = doc.data();
    let newStatus = 'form1_changes_requested';
    if (userData.role === 'investor' || ['form1_approved', 'form2_pending', 'form2_changes_requested'].includes(userData.onboardingStatus)) {
      newStatus = 'form2_changes_requested';
    }

    await docRef.update({
      onboardingStatus: newStatus,
      adminRequests: fieldsRequested,
      updatedAt: new Date().toISOString()
    });

    // Notify Investor
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const fieldsMsg = fieldsRequested && fieldsRequested.length > 0
        ? ` Requested changes: ${fieldsRequested.join(', ')}.`
        : '';
      await notifyUser(
        req.params.id,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Onboarding Changes Requested',
        `The administrator has requested modifications to your investor onboarding details.${fieldsMsg} Please resubmit your form.`,
        null,
        {},
        ['investor']
      );
    } catch (notifErr) {
      console.error('[InvestorRoute] Changes request notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Changes requested successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/investors/verify-investor-final/:id
 */
router.post('/verify-investor-final/:id', async (req, res, next) => {
  try {
    const { isVerified } = req.body;
    const docRef = db.collection('users').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'User not found' });
    await docRef.update({
      isVerified,
      isKycVerified: isVerified,
      kycStatus: isVerified ? 'approved' : 'rejected',
      onboardingStatus: isVerified ? 'complete' : 'form1_rejected',
      updatedAt: new Date().toISOString()
    });

    // Notify Investor
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const title = isVerified ? 'Investor Account Verified' : 'Investor Account Verification Failed';
      const msg = isVerified
        ? 'Congratulations! Your investor account has been fully verified. You now have complete access to properties and investing features.'
        : 'Your investor account verification was rejected. Please contact our support team for help.';
      await notifyUser(
        req.params.id,
        isVerified ? NOTIFICATION_TYPES.USER_VERIFIED : NOTIFICATION_TYPES.STATUS_CHANGED,
        title,
        msg,
        null,
        {},
        ['investor']
      );
    } catch (notifErr) {
      console.error('[InvestorRoute] Final verification notification failed:', notifErr.message);
    }

    res.status(200).json({ message: `Investor final status updated to ${isVerified}` });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/investors/submit-kyc
 * Authenticated investor submits passport for review
 */
router.post('/submit-kyc', authenticate, requireRole('investor'), async (req, res, next) => {
  try {
    const { kycPassportUrl, passportNumber, kycVisaUrl } = req.body;
    if (!kycPassportUrl) {
      return res.status(400).json({ success: false, message: 'Passport document URL is required' });
    }
    if (!passportNumber || !passportNumber.trim()) {
      return res.status(400).json({ success: false, message: 'Passport number is required' });
    }

    const userRef = db.collection('users').doc(req.user.uid);
    const doc = await userRef.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updates = {
      kycPassportUrl,
      passportNumber: passportNumber.trim().toUpperCase(),
      kycStatus: 'pending',
      isKycVerified: false,
      onboardingStatus: 'form2_pending',
      adminRequests: admin.firestore.FieldValue.delete(),
      kycSubmittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (kycVisaUrl !== undefined) {
      updates.kycVisaUrl = kycVisaUrl;
    }

    await userRef.update(updates);

    // Notify admins of new KYC submission
    try {
      const { notifyAdmins, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const userName = doc.data().fullName || doc.data().email || 'An investor';
      await notifyAdmins(
        NOTIFICATION_TYPES.KYC_PENDING_REVIEW,
        'KYC Pending Review',
        `${userName} has submitted passport documents for KYC verification. Please review.`,
        null,
        { userId: req.user.uid }
      );
    } catch (notifErr) {
      console.error('[InvestorRoute] KYC submission admin notification failed:', notifErr.message);
    }

    // Notify user that KYC is received and pending review
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      await notifyUser(
        req.user.uid,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'KYC Documents Under Review',
        'Thank you for submitting your passport KYC details. Our verification team is currently reviewing your documents, which typically takes under 24 hours.',
        null,
        {},
        ['investor']
      );
    } catch (notifErr) {
      console.error('[InvestorRoute] KYC submission user notification failed:', notifErr.message);
    }

    res.json({ success: true, message: 'KYC documents submitted successfully for review.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;