const express = require('express');
const { getDb, admin } = require('../firebase');
const { authenticate } = require('./auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();
const db = getDb();

/**
 * GET /api/builders
 * Paginated list of builders with search and status filters
 * Query: page, limit, search, status (all|verified|unverified|pending|complete)
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = '', status = 'all' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    let query = db.collection('users').where('role', '==', 'builder');

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
      data = data.filter(b =>
        (b.companyName || '').toLowerCase().includes(q) ||
        (b.email || '').toLowerCase().includes(q) ||
        (b.contactNameAndDesignation || '').toLowerCase().includes(q) ||
        (b.city || '').toLowerCase().includes(q)
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
 * GET /api/builders/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await db.collection('users').doc(req.params.id).get();
    if (!doc.exists || doc.data()?.role !== 'builder') {
      return res.status(404).json({ message: 'Builder not found' });
    }
    const { password, ...safe } = doc.data();
    res.json({ id: doc.id, ...safe });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/builders/approve-form1/:id
 */
router.post('/approve-form1/:id', async (req, res, next) => {
  try {
    const docRef = db.collection('users').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'User not found' });
    await docRef.update({ onboardingStatus: 'form1_approved', updatedAt: new Date().toISOString() });

    // Notify Builder
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      await notifyUser(
        req.params.id,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Builder Onboarding Form 1 Approved',
        'Your registration Form 1 has been approved! You can now proceed to Form 2 to complete your profile verification.',
        null,
        {},
        ['builder']
      );
    } catch (notifErr) {
      console.error('[BuilderRoute] Form 1 approval notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Form 1 Approved. User can now proceed to Form 2.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/builders/request-changes/:id
 */
router.post('/request-changes/:id', async (req, res, next) => {
  try {
    const { fieldsRequested } = req.body;
    const docRef = db.collection('users').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'User not found' });
    
    const userData = doc.data();
    let newStatus = 'form1_changes_requested';
    if (['form1_approved', 'form2_pending', 'form2_changes_requested'].includes(userData.onboardingStatus)) {
      newStatus = 'form2_changes_requested';
    }

    await docRef.update({
      onboardingStatus: newStatus,
      adminRequests: fieldsRequested,
      updatedAt: new Date().toISOString()
    });

    // Notify Builder
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const fieldsMsg = fieldsRequested && fieldsRequested.length > 0
        ? ` Requested changes: ${fieldsRequested.join(', ')}.`
        : '';
      await notifyUser(
        req.params.id,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Onboarding Changes Requested',
        `The administrator has requested changes to your builder profile.${fieldsMsg} Please log in to resubmit.`,
        null,
        {},
        ['builder']
      );
    } catch (notifErr) {
      console.error('[BuilderRoute] Changes requested notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Changes requested successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/builders/verify-final/:id
 */
router.post('/verify-final/:id', async (req, res, next) => {
  try {
    const { isVerified } = req.body;
    const docRef = db.collection('users').doc(req.params.id);
    const doc = await docRef.get();
    await docRef.update({
      isVerified,
      kycStatus: isVerified ? 'approved' : 'rejected',
      onboardingStatus: isVerified ? 'complete' : 'form1_rejected',
      updatedAt: new Date().toISOString()
    });

    // Notify Builder
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const title = isVerified ? 'Builder Account Verified' : 'Builder Account Verification Failed';
      const msg = isVerified
        ? 'Congratulations! Your builder account has been successfully verified by our compliance team. You now have full builder dashboard access.'
        : 'Your builder profile verification was rejected. Please review your details and try again, or reach out to support.';
      await notifyUser(
        req.params.id,
        isVerified ? NOTIFICATION_TYPES.USER_VERIFIED : NOTIFICATION_TYPES.STATUS_CHANGED,
        title,
        msg,
        null,
        {},
        ['builder']
      );
    } catch (notifErr) {
      console.error('[BuilderRoute] Final verification notification failed:', notifErr.message);
    }

    res.status(200).json({ message: `Builder final status updated to ${isVerified}` });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/builders/submit-verification
 * Submit builder Form 2 verification data and project brochure
 */
router.post('/submit-verification', authenticate, requireRole('builder'), async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const {
      projectBrochureUrl,
      yearOfIncorporation,
      deliveryVolumeType,
      deliverySqft,
      deliverySqyd,
      namesOfProjects,
      typeOfFirm,
      typeOfFirmOther,
      totalPartners,
      managingPartnerName,
      majorStakeholderName,
      tradeOrganizationMembership,
      tradeOrganizationOther,
      companyOverview,
      declaredLitigationDisputes,
      bankingPartners,
      totalRevenue,
      revenueInLastYear,
      experienceWithNriInvestors,
      majorCompletedProjects,
      outstandingDebt,
      financialOfCompany,
      projectCategories,
      projectTypes,
      projectStages,
      capitalRequirements,
      ongoingProjects,
      projectsCompleted
    } = req.body;

    const finalBrochureUrl = projectBrochureUrl || '';

    const docRef = db.collection('users').doc(uid);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update with Form 2 data and mark KYC as pending
    await docRef.update({
      yearOfIncorporation: yearOfIncorporation || '',
      deliveryVolumeType: deliveryVolumeType || '',
      deliverySqft: deliverySqft || '',
      deliverySqyd: deliverySqyd || '',
      namesOfProjects: namesOfProjects || '',
      typeOfFirm: typeOfFirm || '',
      typeOfFirmOther: typeOfFirmOther || '',
      totalPartners: totalPartners || '',
      managingPartnerName: managingPartnerName || '',
      majorStakeholderName: majorStakeholderName || '',
      tradeOrganizationMembership: tradeOrganizationMembership || [],
      tradeOrganizationOther: tradeOrganizationOther || '',
      companyOverview: companyOverview || '',
      declaredLitigationDisputes: declaredLitigationDisputes || '',
      bankingPartners: bankingPartners || '',
      totalRevenue: totalRevenue || '',
      revenueInLastYear: revenueInLastYear || '',
      experienceWithNriInvestors: experienceWithNriInvestors || '',
      majorCompletedProjects: majorCompletedProjects || '',
      outstandingDebt: outstandingDebt || '',
      financialOfCompany: financialOfCompany || '',
      projectCategories: projectCategories || [],
      projectTypes: projectTypes || [],
      projectStages: projectStages || [],
      capitalRequirements: capitalRequirements || [],
      ongoingProjects: ongoingProjects || '',
      projectsCompleted: projectsCompleted || '',
      projectBrochureUrl: finalBrochureUrl,
      kycStatus: 'pending',
      onboardingStatus: 'form2_pending',
      adminRequests: admin.firestore.FieldValue.delete(),
      updatedAt: new Date().toISOString()
    });

    // Notify admins of builder Form 2 (2-Step Verification) submission
    try {
      const { notifyAdmins, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const companyName = doc.data().companyName || doc.data().email || 'A builder';
      await notifyAdmins(
        NOTIFICATION_TYPES.KYC_PENDING_REVIEW,
        'Builder 2-Step Verification Submitted',
        `${companyName} has submitted Form 2 verification details and project brochure for review.`,
        null,
        { userId: uid }
      );
    } catch (notifErr) {
      console.error('[BuilderRoute] Verification submission admin notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Verification data submitted successfully. Pending admin review.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;