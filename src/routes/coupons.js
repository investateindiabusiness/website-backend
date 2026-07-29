const express = require('express');
const { getDb } = require('../firebase');
const { authenticate } = require('./auth');

const router = express.Router();

/**
 * GET /api/coupons/my-coupons
 * Fetch coupons assigned to the authenticated user
 */
router.get('/my-coupons', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('coupons').where('status', '==', 'active').get();

    const coupons = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(coupon => {
      // Skip expired or exhausted coupons
      const isExpired = coupon.validUntil && new Date(coupon.validUntil) < new Date();
      const notStarted = coupon.validFrom && new Date(coupon.validFrom) > new Date();
      const isMaxedOut = coupon.usedCount >= coupon.maxUses;
      if (isExpired || notStarted || isMaxedOut) return false;

      // Ensure it is assigned to this user (if assignedTo is set)
      if (coupon.assignedTo && coupon.assignedTo !== req.user.uid) return false;

      return true;
    });

    res.json({ data: coupons });
  } catch (err) {
    console.error("Fetch my coupons error:", err);
    res.status(500).json({ message: 'Failed to fetch coupons' });
  }
});

/**
 * POST /api/coupons/validate
 * Validate a coupon code
 */
router.post('/validate', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ message: 'Coupon code is required' });
    }

    const db = getDb();
    const snapshot = await db.collection('coupons')
      .where('code', '==', code.toUpperCase())
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ message: 'Invalid coupon code' });
    }

    const coupon = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };

    // Validations
    if (coupon.status !== 'active') {
      return res.status(400).json({ message: 'Coupon is inactive' });
    }
    if (coupon.assignedTo && coupon.assignedTo !== req.user.uid) {
      return res.status(403).json({ message: 'This coupon is not assigned to you' });
    }

    if (coupon.usedCount >= coupon.maxUses) {
      return res.status(400).json({ message: 'Coupon usage limit exceeded' });
    }
    if (coupon.validFrom && new Date(coupon.validFrom) > new Date()) {
      return res.status(400).json({ message: 'Coupon is not yet active' });
    }
    if (coupon.validUntil && new Date(coupon.validUntil) < new Date()) {
      return res.status(400).json({ message: 'Coupon has expired' });
    }

    res.json({
      message: 'Coupon is valid',
      data: {
        code: coupon.code,
        discountAmount: coupon.discountAmount,
        id: coupon.id
      }
    });

  } catch (err) {
    console.error("Validate coupon error:", err);
    res.status(500).json({ message: 'Failed to validate coupon' });
  }
});

module.exports = router;
