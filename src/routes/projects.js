const express = require('express');
const { z } = require('zod');
const { getDb, admin } = require('../firebase');
const socketService = require('../services/SocketService');

const router = express.Router();
const db = getDb();
const collection = db.collection('projects');

const FieldValue = admin.firestore.FieldValue;

// --- Zod Schema ---
const projectSchema = z.object({
  projectName: z.string().min(1),
  builderName: z.string().min(1),
  projectOverview: z.string().min(1),
  projectLocation: z.string().min(1),
  projectCategory: z.union([z.string(), z.array(z.string())]).optional(),
  projectType: z.union([z.string(), z.array(z.string())]).optional(),
  totalLandArea: z.string().min(1),
  totalBuiltUpArea: z.string().min(1),
  totalUnits: z.union([z.string().min(1), z.number()]),
  currentConstructionStatus: z.string().min(1),
  expectedCompletionDate: z.string().min(1),
  governmentApprovalsObtained: z.union([z.string(), z.array(z.string())]).optional(),
  reraRegistrationNumber: z.string().min(1),
  bankApprovals: z.string().min(1),
  bankApprovalsName: z.string().optional(),
  projectCost: z.string().min(1),
  existingBorrowings: z.string().min(1),
  existingBorrowingsAmount: z.string().optional(),
  existingBorrowingsPurpose: z.string().optional(),
  sellingPrice: z.string().min(1),
  pricingOffered: z.string().min(1),
  securityOffered: z.string().min(1),
  lockInPeriod: z.string().min(1),
  buybackGuarantee: z.string().min(1),
  buybackGuaranteeDetails: z.string().optional(),
  exitResaleFramework: z.string().min(1),
  marketingResponsibility: z.string().min(1),
  additionalDisclosures: z.string().optional(),
  hasPendingEdits: z.boolean().optional(),
  pendingEdits: z.any().optional(),
  availableForRent: z.string().min(1),
  expectedRent: z.string().optional(),
  projectImages: z.array(z.any()).optional(),
  projectDocuments: z.array(z.any()).optional(),
  builderId: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  views: z.number().optional().default(0),
  inquiries: z.number().optional().default(0),
  status: z.enum(['pending', 'approved', 'rejected', 'changes_requested']).optional(),
  appealReason: z.string().optional(),
  area: z.string().optional(),
  inventory: z.string().optional(),
  landType: z.string().optional(),
  landTypeOther: z.string().optional(),
  projectBrochureUrl: z.string().optional(),
  projectSpecifications: z.string().optional(),
  projectState: z.string().optional(),
  otherGovernmentApprovals: z.string().optional(),
  undividedShare: z.string().optional(),
  otherUnitInformation: z.string().optional(),
  liveCctvAvailable: z.string().optional(),
  liveCameraUrl: z.string().optional(),
  cameraUsername: z.string().optional(),
  cameraPassword: z.string().optional(),
  viewerInstructions: z.string().optional(),
  projectWebsite: z.string().optional(),
  googleMapsLocation: z.string().optional(),
  virtualTourUrl: z.string().optional(),
  droneVideoUrl: z.string().optional(),
  salesOfficeAddress: z.string().optional(),
  projectContactPerson: z.string().optional(),
  projectContactNumber: z.string().optional(),
  projectContactEmail: z.string().optional()
});

/**
 * GET /api/projects
 * Paginated list with filtering and search
 * Query: page, limit, status, type, builderId, search, role
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = 'all',
      type = 'all',
      builderId,
      search = '',
      role
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    let query = collection;

    // Filter: specific builder's projects
    if (builderId) {
      query = query.where('builderId', '==', builderId);
    }

    // Filter: investor-facing only sees approved projects
    if (role === 'investor') {
      query = query.where('status', '==', 'approved');
    } else if (status !== 'all') {
      // Admin/builder status filter
      if (status === 'pending_any') {
        // Special: pending OR has pending edits — handled in memory
      } else {
        query = query.where('status', '==', status);
      }
    }

    // Filter by project type
    if (type !== 'all') {
      query = query.where('projectType', '==', type);
    }

    // Fetch all matching documents (no orderBy to avoid composite index requirement)
    const snapshot = await query.get();
    let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // In-memory: sort by createdAt descending
    data.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    // In-memory: pending_any filter (has pending edits OR status = pending)
    if (status === 'pending_any') {
      data = data.filter(p => p.status === 'pending' || p.hasPendingEdits);
    }

    // In-memory search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      data = data.filter(p =>
        (p.projectName || '').toLowerCase().includes(q) ||
        (p.builderName || '').toLowerCase().includes(q) ||
        (p.projectLocation || '').toLowerCase().includes(q) ||
        (p.reraRegistrationNumber || '').toLowerCase().includes(q)
      );
    }

    const total = data.length;

    // Pagination (in-memory)
    const offset = (pageNum - 1) * limitNum;
    data = data.slice(offset, offset + limitNum);

    res.json({
      success: true,
      data,
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
 * GET /api/projects/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await collection.doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Project not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects (Create New)
 */
router.post('/', async (req, res, next) => {
  try {
    const parseResult = projectSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: 'Invalid project payload', errors: parseResult.error.flatten() });
    }

    const projectData = {
      ...parseResult.data,
      views: parseResult.data.views ?? 0,
      inquiries: parseResult.data.inquiries ?? 0,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    let projectId;
    if (req.body.id) {
      projectId = req.body.id;
      await collection.doc(projectId).set(projectData);
    } else {
      const docRef = await collection.add(projectData);
      projectId = docRef.id;
    }

    const created = await collection.doc(projectId).get();
    res.status(201).json({ id: created.id, ...created.data() });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/projects/:id (Edit — handles live vs draft logic)
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const partialSchema = projectSchema.partial();
    const parseResult = partialSchema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({ message: 'Invalid payload', errors: parseResult.error.flatten() });
    }

    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'Project not found' });

    const currentData = doc.data();
    const cleanedData = Object.fromEntries(
      Object.entries(parseResult.data).filter(([_, v]) => v !== undefined)
    );

    if (currentData.status === 'approved') {
      // Live project: save edits as draft, keep live version intact
      await docRef.update({
        hasPendingEdits: true,
        pendingEdits: cleanedData,
        updatedAt: new Date().toISOString()
      });
    } else {
      // Not live: update directly and re-submit for approval
      await docRef.update({
        ...cleanedData,
        status: 'pending',
        updatedAt: new Date().toISOString()
      });
    }

    res.json({ message: 'Update processed' });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/projects/:id
 */
router.delete('/:id', async (req, res, next) => {
  try {
    await collection.doc(req.params.id).delete();
    res.status(200).json({ message: 'Project deleted successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/verify/:id — Admin approve/reject, or approve/reject edits
 */
router.post('/verify/:id', async (req, res, next) => {
  try {
    const { status, action, visibleDocuments } = req.body || {};

    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'Project not found' });

    const currentData = doc.data();

    if (action === 'approve_edits') {
      const edits = currentData.pendingEdits || {};
      const cleanedEdits = Object.fromEntries(Object.entries(edits).filter(([_, v]) => v !== undefined));
      await docRef.update({
        ...cleanedEdits,
        hasPendingEdits: FieldValue.delete(),
        pendingEdits: FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });
      return res.status(200).json({ message: 'Edits approved and live.' });
    }

    if (action === 'reject_edits') {
      await docRef.update({
        hasPendingEdits: FieldValue.delete(),
        pendingEdits: FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });
      return res.status(200).json({ message: 'Edits rejected. Original project remains live.' });
    }

    if (status === undefined) return res.status(400).json({ message: 'Missing status field.' });

    const updateData = { status, updatedAt: new Date().toISOString() };
    if (status === 'approved' && visibleDocuments) {
      updateData.visibleDocuments = visibleDocuments;
    }

    await docRef.update(updateData);
    res.status(200).json({ message: `Project marked as ${status}` });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/request-changes/:id — Admin requests changes
 */
router.post('/request-changes/:id', async (req, res, next) => {
  try {
    const { fieldsRequested } = req.body;
    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'Project not found' });
    await docRef.update({
      status: 'changes_requested',
      adminRequests: fieldsRequested,
      updatedAt: new Date().toISOString()
    });
    res.status(200).json({ message: 'Changes requested successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/submit-changes/:id — Builder submits requested changes
 */
router.post('/submit-changes/:id', async (req, res, next) => {
  try {
    const updatedFields = req.body;
    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'Project not found' });
    await docRef.update({
      ...updatedFields,
      status: 'pending',
      adminRequests: FieldValue.delete(),
      updatedAt: new Date().toISOString()
    });
    res.status(200).json({ message: 'Changes submitted successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/appeal-rejection/:id — Builder appeals rejection
 */
router.post('/appeal-rejection/:id', async (req, res, next) => {
  try {
    const { appealReason } = req.body;
    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'Project not found' });
    await docRef.update({
      status: 'pending',
      appealReason,
      updatedAt: new Date().toISOString()
    });
    res.status(200).json({ message: 'Appeal submitted successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:id/lead-status
 */
router.get('/:id/lead-status', async (req, res, next) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.json({ hasSubmitted: false });
    const existingLead = await db.collection('leads')
      .where('projectId', '==', req.params.id)
      .where('investorId', '==', uid)
      .get();
    res.json({ hasSubmitted: !existingLead.empty });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:id/lead — Investor submits inquiry
 */
router.post('/:id/lead', async (req, res, next) => {
  try {
    const { uid, message } = req.body;
    if (!uid) return res.status(400).json({ message: 'User ID is required' });

    const existingLead = await db.collection('leads')
      .where('projectId', '==', req.params.id)
      .where('investorId', '==', uid)
      .get();
    if (!existingLead.empty) {
      return res.status(400).json({ message: 'You have already submitted an inquiry for this project.' });
    }

    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ message: 'User not found' });
    const userData = userDoc.data();

    const projectDoc = await collection.doc(req.params.id).get();
    if (!projectDoc.exists) return res.status(404).json({ message: 'Project not found' });
    const projectData = projectDoc.data();

    const leadData = {
      projectId: req.params.id,
      projectName: projectData.projectName || 'Unknown',
      builderId: projectData.builderId || 'Unknown',
      investorId: uid,
      investorName: userData.fullName || userData.name || 'Unknown',
      investorEmail: userData.email || 'No Email',
      investorPhone: userData.contactNumber || 'No Phone',
      message: message || 'Requested a call back.',
      status: 'New',
      adminNote: '',
      createdAt: new Date().toISOString()
    };

    await db.collection('leads').add(leadData);
    await projectDoc.ref.update({ inquiries: (projectData.inquiries || 0) + 1 });

    try {
      const io = socketService.getIO();
      io.emit('newLead', leadData);
    } catch (sockErr) {
      console.error('[Socket] Failed to emit newLead event:', sockErr.message);
    }

    res.status(201).json({ message: 'Inquiry submitted successfully.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;