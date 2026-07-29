const express = require('express');
const { z } = require('zod');
const { getDb } = require('../firebase');
const { authenticate } = require('./auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const { invalidateSlaCache, DEFAULT_SLA } = require('../utils/sla');
const { logAudit, AUDIT_ACTIONS } = require('../utils/audit');

const router = express.Router();

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name:           z.string().min(2, 'Category name required').max(100),
  subcategories:  z.array(z.string()).optional().default([]),
  isActive:       z.boolean().optional().default(true),
  displayOrder:   z.number().optional().default(0),
  description:    z.string().optional().default(''),
});

const slaSchema = z.object({
  priority:             z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  firstResponseHours:   z.number().min(0.25).max(168),
  resolutionHours:      z.number().min(1).max(720),
  isActive:             z.boolean().optional().default(true),
});

// ─── Categories ───────────────────────────────────────────────────────────────

/**
 * GET /api/helpdesk/categories
 * List all ticket categories. Public — accessible to all authenticated users.
 */
router.get('/categories', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('support_categories')
      .where('isActive', '==', true)
      .orderBy('displayOrder', 'asc')
      .get();

    const categories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ data: categories });
  } catch (err) {
    console.error('[HelpdeskAdmin] Get categories error:', err);
    res.status(500).json({ message: 'Failed to fetch categories', error: err.message });
  }
});

/**
 * GET /api/helpdesk/categories/all
 * List ALL categories (including inactive). Admin only.
 */
router.get('/categories/all', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('support_categories').orderBy('displayOrder', 'asc').get();
    const categories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ data: categories });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch all categories', error: err.message });
  }
});

/**
 * POST /api/helpdesk/categories
 * Create a new ticket category. Admin only.
 */
router.post('/categories', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });

    const db = getDb();
    const now = new Date().toISOString();

    const docRef = await db.collection('support_categories').add({
      ...parsed.data,
      createdBy: req.user.uid,
      createdAt: now,
      updatedAt: now,
    });

    await logAudit({ action: AUDIT_ACTIONS.CATEGORY_CREATED, performedBy: req.user.uid,
      performedByRole: req.userRole, newValue: parsed.data, req });

    res.status(201).json({ message: 'Category created', id: docRef.id });
  } catch (err) {
    console.error('[HelpdeskAdmin] Create category error:', err);
    res.status(500).json({ message: 'Failed to create category', error: err.message });
  }
});

/**
 * PATCH /api/helpdesk/categories/:id
 * Update a category. Admin only.
 */
router.patch('/categories/:id', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const parsed = categorySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });

    const db = getDb();
    const ref = db.collection('support_categories').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ message: 'Category not found' });

    const now = new Date().toISOString();
    await ref.update({ ...parsed.data, updatedAt: now });

    await logAudit({ action: AUDIT_ACTIONS.CATEGORY_UPDATED, performedBy: req.user.uid,
      performedByRole: req.userRole, oldValue: doc.data(), newValue: parsed.data, req });

    res.json({ message: 'Category updated' });
  } catch (err) {
    console.error('[HelpdeskAdmin] Update category error:', err);
    res.status(500).json({ message: 'Failed to update category', error: err.message });
  }
});

/**
 * DELETE /api/helpdesk/categories/:id
 * Soft-delete (deactivate) a category. Admin only.
 */
router.delete('/categories/:id', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('support_categories').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ message: 'Category not found' });

    await ref.update({ isActive: false, updatedAt: new Date().toISOString() });

    await logAudit({ action: AUDIT_ACTIONS.CATEGORY_DELETED, performedBy: req.user.uid,
      performedByRole: req.userRole, ticketId: null, req });

    res.json({ message: 'Category deactivated' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to deactivate category', error: err.message });
  }
});

// ─── SLA Configuration ────────────────────────────────────────────────────────

/**
 * GET /api/helpdesk/sla
 * Get current SLA configuration. Admin only.
 */
router.get('/sla', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('sla_configurations').get();

    if (snapshot.empty) {
      // Return defaults if no config exists
      const defaults = Object.entries(DEFAULT_SLA).map(([priority, config]) => ({
        priority,
        ...config,
        isActive: true,
        isDefault: true,
      }));
      return res.json({ data: defaults });
    }

    const configs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ data: configs });
  } catch (err) {
    console.error('[HelpdeskAdmin] Get SLA error:', err);
    res.status(500).json({ message: 'Failed to fetch SLA configuration', error: err.message });
  }
});

/**
 * POST /api/helpdesk/sla
 * Create or update SLA for a priority. Admin only.
 * Upserts based on priority field.
 */
router.post('/sla', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const parsed = slaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });

    const db = getDb();
    const { priority } = parsed.data;

    // Check if SLA for this priority exists
    const existing = await db.collection('sla_configurations').where('priority', '==', priority).get();

    const now = new Date().toISOString();
    let docId;

    if (!existing.empty) {
      const docRef = existing.docs[0].ref;
      await docRef.update({ ...parsed.data, updatedBy: req.user.uid, updatedAt: now });
      docId = docRef.id;
    } else {
      const docRef = await db.collection('sla_configurations').add({
        ...parsed.data,
        createdBy: req.user.uid,
        createdAt: now,
        updatedAt: now,
      });
      docId = docRef.id;
    }

    // Invalidate in-memory SLA cache
    invalidateSlaCache();

    await logAudit({ action: AUDIT_ACTIONS.SLA_UPDATED, performedBy: req.user.uid,
      performedByRole: req.userRole, newValue: parsed.data, req });

    res.json({ message: `SLA for ${priority} saved`, id: docId });
  } catch (err) {
    console.error('[HelpdeskAdmin] Save SLA error:', err);
    res.status(500).json({ message: 'Failed to save SLA configuration', error: err.message });
  }
});

/**
 * POST /api/helpdesk/sla/seed
 * Seed all 4 default SLA configurations. Admin only. Safe to run multiple times.
 */
router.post('/sla/seed', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const batch = db.batch();
    const now = new Date().toISOString();

    for (const [priority, config] of Object.entries(DEFAULT_SLA)) {
      const existing = await db.collection('sla_configurations').where('priority', '==', priority).get();
      if (existing.empty) {
        const ref = db.collection('sla_configurations').doc();
        batch.set(ref, { priority, ...config, isActive: true, createdBy: 'seed', createdAt: now, updatedAt: now });
      }
    }

    await batch.commit();
    invalidateSlaCache();

    res.json({ message: 'Default SLA configurations seeded' });
  } catch (err) {
    console.error('[HelpdeskAdmin] Seed SLA error:', err);
    res.status(500).json({ message: 'Failed to seed SLA', error: err.message });
  }
});

/**
 * POST /api/helpdesk/categories/seed
 * Seed default ticket categories. Admin only. Safe to run multiple times.
 */
router.post('/categories/seed', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    const defaultCategories = [
      { name: 'Technical Issue',    subcategories: ['Login Problem', 'App Crash', 'Slow Performance', 'Data Not Loading'], displayOrder: 1 },
      { name: 'Bug Report',         subcategories: ['UI Bug', 'Calculation Error', 'Missing Data', 'Broken Feature'],       displayOrder: 2 },
      { name: 'Feature Request',    subcategories: ['New Feature', 'UI Improvement', 'Integration Request'],                 displayOrder: 3 },
      { name: 'Account Access',     subcategories: ['Password Reset', 'Account Locked', 'Email Change', 'Profile Issue'],   displayOrder: 4 },
      { name: 'KYC Verification',   subcategories: ['Document Upload', 'Verification Pending', 'Rejection Query'],           displayOrder: 5 },
      { name: 'Payment Issue',      subcategories: ['Failed Payment', 'Refund Request', 'Billing Error'],                    displayOrder: 6 },
      { name: 'Builder Support',    subcategories: ['Project Listing', 'Document Submission', 'Approval Query'],             displayOrder: 7 },
      { name: 'Investor Support',   subcategories: ['Investment Query', 'Returns Query', 'Portfolio Issue'],                 displayOrder: 8 },
      { name: 'General Inquiry',    subcategories: ['How-to Question', 'Policy Query', 'Other'],                             displayOrder: 9 },
      { name: 'Billing',            subcategories: ['Invoice Request', 'Payment History', 'Subscription'],                   displayOrder: 10 },
    ];

    const batch = db.batch();
    for (const cat of defaultCategories) {
      const existing = await db.collection('support_categories').where('name', '==', cat.name).get();
      if (existing.empty) {
        const ref = db.collection('support_categories').doc();
        batch.set(ref, { ...cat, isActive: true, description: '', createdBy: 'seed', createdAt: now, updatedAt: now });
      }
    }

    await batch.commit();

    res.json({ message: `Default categories seeded` });
  } catch (err) {
    console.error('[HelpdeskAdmin] Seed categories error:', err);
    res.status(500).json({ message: 'Failed to seed categories', error: err.message });
  }
});

module.exports = router;
