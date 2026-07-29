const express = require('express');
const { z } = require('zod');
const sanitizeHtml = require('sanitize-html');
const { getDb, admin } = require('../firebase');
const { authenticate } = require('./auth');
const { requireRole, requireOwnerOrAgent, ROLES } = require('../middleware/rbac');
const { ticketCreateLimiter, messageLimiter, searchLimiter } = require('../middleware/rateLimiter');
const { generateTicketId } = require('../utils/ticketId');
const { computeSlaDeadlines, isFirstResponseBreached, isResolutionBreached } = require('../utils/sla');
const { notifyUser, notifyAdmins, notifyStaff, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
const { logAudit, AUDIT_ACTIONS } = require('../utils/audit');

const router = express.Router();

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_STATUSES = [
  'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED',
  'CLOSED', 'REOPENED', 'ESCALATED', 'CANCELLED', 'DUPLICATE',
];

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const PRIORITY_COLORS = { LOW: '#22c55e', MEDIUM: '#3b82f6', HIGH: '#f97316', CRITICAL: '#ef4444' };

/**
 * Valid status transitions:
 * key = current status, value = array of allowed next statuses
 */
const STATUS_TRANSITIONS = {
  OPEN:               ['IN_PROGRESS', 'CANCELLED', 'DUPLICATE'],
  IN_PROGRESS:        ['WAITING_FOR_USER', 'RESOLVED', 'ESCALATED', 'CANCELLED'],
  WAITING_FOR_USER:   ['IN_PROGRESS', 'RESOLVED', 'CANCELLED'],
  RESOLVED:           ['CLOSED', 'REOPENED'],
  CLOSED:             ['REOPENED'],
  REOPENED:           ['IN_PROGRESS', 'CANCELLED'],
  ESCALATED:          ['IN_PROGRESS', 'RESOLVED', 'CANCELLED'],
  CANCELLED:          [],
  DUPLICATE:          [],
};

const REOPEN_WINDOW_DAYS = 30;

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const createTicketSchema = z.object({
  subject:     z.string().min(5, 'Subject must be at least 5 characters').max(200),
  category:    z.string().min(1, 'Category is required'),
  subcategory: z.string().optional().default(''),
  description: z.string().min(10, 'Description must be at least 10 characters').max(5000),
  priority:    z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  source:      z.enum(['WEB', 'MOBILE', 'API', 'ADMIN_CREATED']).default('WEB'),
  tags:        z.array(z.string()).optional().default([]),
});

const sendMessageSchema = z.object({
  message:    z.string().min(1, 'Message cannot be empty').max(10000),
  isInternal: z.boolean().optional().default(false),
  attachments: z.array(z.object({
    fileName: z.string(),
    fileUrl:  z.string().url(),
    fileSize: z.number().optional(),
    mimeType: z.string().optional(),
  })).optional().default([]),
});

const changeStatusSchema = z.object({
  status: z.enum(VALID_STATUSES),
  reason: z.string().optional().default(''),
});

const changePrioritySchema = z.object({
  priority: z.enum(VALID_PRIORITIES),
  reason:   z.string().optional().default(''),
});

const assignTicketSchema = z.object({
  assignedTo:   z.string().min(1, 'Assignee UID required'),
  team:         z.string().optional().default(''),
  department:   z.string().optional().default(''),
});

const escalateSchema = z.object({
  reason:         z.string().min(5, 'Escalation reason required'),
  escalationLevel: z.number().int().min(1).max(4).optional(),
});

const reopenSchema = z.object({
  reason: z.string().min(5, 'Reopen reason is required (min 5 chars)'),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip dangerous HTML from user-submitted message content.
 */
const sanitize = (html) =>
  sanitizeHtml(html, {
    allowedTags: ['b', 'i', 'u', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote'],
    allowedAttributes: { a: ['href', 'target'] },
    allowedSchemes: ['http', 'https', 'mailto'],
  });

/**
 * Fetch all docs from a simple single-field query, then filter/sort in memory.
 * This avoids the need for composite Firestore indexes entirely.
 */
const fetchAndFilter = async (collection, filters = {}, { limit = 20, orderByField = 'createdAt', orderDirection = 'desc' } = {}) => {
  const db = getDb();

  // Use only the first filter as the Firestore query (single-field, no index needed)
  const filterEntries = Object.entries(filters).filter(([, v]) => v !== undefined && v !== null);

  let snapshot;
  if (filterEntries.length > 0) {
    const [firstKey, firstVal] = filterEntries[0];
    snapshot = await db.collection(collection).where(firstKey, '==', firstVal).get();
  } else {
    snapshot = await db.collection(collection).get();
  }

  let docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  // Apply remaining filters in memory
  for (const [key, val] of filterEntries.slice(1)) {
    docs = docs.filter((doc) => doc[key] === val);
  }

  // Sort in memory
  docs.sort((a, b) => {
    const aVal = a[orderByField] || '';
    const bVal = b[orderByField] || '';
    if (orderDirection === 'desc') return bVal > aVal ? 1 : -1;
    return aVal > bVal ? 1 : -1;
  });

  // Apply limit
  const limited = docs.slice(0, Number(limit));

  return {
    data: limited,
    pagination: {
      count: limited.length,
      limit: Number(limit),
      lastDocId: limited.length > 0 ? limited[limited.length - 1].id : null,
      hasMore: docs.length > Number(limit),
    },
  };
};

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/helpdesk/tickets
 * Create a new support ticket.
 */
router.post('/tickets', authenticate, ticketCreateLimiter, async (req, res) => {
  try {
    const parsed = createTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });
    }

    const db = getDb();
    const uid = req.user.uid;

    // Fetch user profile snapshot
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    // Generate unique ticket ID
    const ticketId = await generateTicketId();

    // Compute SLA deadlines
    const now = new Date();
    const sla = await computeSlaDeadlines(parsed.data.priority, now);

    // Build ticket document
    const ticketData = {
      ...parsed.data,
      ticketId,
      status:      'OPEN',
      reopenCount: 0,
      reopenDeadline: null,
      slaFirstResponse:      sla.slaFirstResponse,
      slaResolution:         sla.slaResolution,
      slaFirstResponseHours: sla.slaFirstResponseHours,
      slaResolutionHours:    sla.slaResolutionHours,
      slaBreached:           false,
      firstResponseAt:       null,
      closedAt:              null,
      resolvedAt:            null,
      lastResponseAt:        null,
      isDeleted:             false,
      assignedTo:            null,
      assignedTeam:          null,
      escalationLevel:       0,
      duplicateOf:           null,

      // Frozen user snapshot
      userId:          uid,
      userName:        userData.fullName || userData.companyName || userData.email || 'Unknown',
      userEmail:       userData.email || '',
      userMobile:      userData.contactNumber || userData.mobile || '',
      userCompany:     userData.companyName || '',
      userRole:        userData.role || 'investor',
      userAccountType: userData.accountType || userData.role || 'investor',

      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // Write ticket using ticketId as document ID
    await db.collection('tickets').doc(ticketId).set(ticketData);

    // Audit log
    await logAudit({
      action: AUDIT_ACTIONS.TICKET_CREATED,
      performedBy: uid,
      performedByRole: userData.role || 'investor',
      ticketId,
      newValue: { subject: parsed.data.subject, priority: parsed.data.priority },
      req,
    });

    // Notifications (fire-and-forget)
    notifyUser(uid, NOTIFICATION_TYPES.TICKET_CREATED,
      `Ticket Created: ${ticketId}`,
      `Your support ticket "${parsed.data.subject}" has been submitted. We'll respond within ${sla.slaFirstResponseHours}h.`,
      ticketId
    );
    notifyStaff(NOTIFICATION_TYPES.NEW_TICKET,
      `New Ticket: ${ticketId}`,
      `${ticketData.userName} opened a new ${parsed.data.priority} priority ticket: "${parsed.data.subject}"`,
      ticketId
    );

    res.status(201).json({ message: 'Ticket created successfully', ticket: ticketData });
  } catch (err) {
    console.error('[Helpdesk] Create ticket error:', err);
    res.status(500).json({ message: 'Failed to create ticket', error: err.message });
  }
});

/**
 * GET /api/helpdesk/tickets
 * List all tickets with filtering & pagination. (Agents/Admins only)
 */
router.get('/tickets', authenticate, requireRole(...ROLES.AGENT_PLUS), async (req, res) => {
  try {
    const {
      status, priority, category, assignedTo,
      userId, limit = 20,
      orderBy = 'createdAt', order = 'desc',
    } = req.query;

    // Build in-memory filters (no composite indexes needed)
    const filters = { isDeleted: false };
    if (status)     filters.status = status.toUpperCase();
    if (priority)   filters.priority = priority.toUpperCase();
    if (category)   filters.category = category;
    if (assignedTo) filters.assignedTo = assignedTo;
    if (userId)     filters.userId = userId;

    const result = await fetchAndFilter('tickets', filters, { limit, orderByField: orderBy, orderDirection: order });

    res.json(result);
  } catch (err) {
    console.error('[Helpdesk] List tickets error:', err);
    res.status(500).json({ message: 'Failed to list tickets', error: err.message });
  }
});

/**
 * GET /api/helpdesk/my-tickets
 * List tickets belonging to the authenticated user.
 */
router.get('/my-tickets', authenticate, async (req, res) => {
  try {
    const { status, limit = 20, order = 'desc' } = req.query;

    const filters = { userId: req.user.uid, isDeleted: false };
    if (status) filters.status = status.toUpperCase();

    const result = await fetchAndFilter('tickets', filters, { limit, orderByField: 'createdAt', orderDirection: order });

    res.json(result);
  } catch (err) {
    console.error('[Helpdesk] My tickets error:', err);
    res.status(500).json({ message: 'Failed to fetch your tickets', error: err.message });
  }
});

/**
 * GET /api/helpdesk/tickets/:id
 * Get full ticket details. Owner or agent+.
 */
router.get('/tickets/:id', authenticate, requireOwnerOrAgent, async (req, res) => {
  try {
    const db = getDb();
    const ticketDoc = req.ticket
      ? { id: req.ticket.id, ...req.ticket }
      : await (async () => {
          const d = await db.collection('tickets').doc(req.params.id).get();
          return d.exists ? { id: d.id, ...d.data() } : null;
        })();

    if (!ticketDoc || ticketDoc.isDeleted) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    res.json(ticketDoc);
  } catch (err) {
    console.error('[Helpdesk] Get ticket error:', err);
    res.status(500).json({ message: 'Failed to get ticket', error: err.message });
  }
});

/**
 * PATCH /api/helpdesk/tickets/:id/status
 * Change ticket status. Enforces valid transitions.
 */
router.patch('/tickets/:id/status', authenticate, requireRole(...ROLES.AGENT_PLUS), async (req, res) => {
  try {
    const parsed = changeStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });

    const db = getDb();
    const { status: newStatus, reason } = parsed.data;
    const ticketRef = db.collection('tickets').doc(req.params.id);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists || ticketDoc.data().isDeleted) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const ticket = ticketDoc.data();
    const currentStatus = ticket.status;

    // Enforce valid transitions
    const allowed = STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({
        message: `Invalid status transition: ${currentStatus} → ${newStatus}`,
        allowed,
      });
    }

    const now = new Date().toISOString();
    const updates = {
      status: newStatus,
      updatedAt: now,
    };

    if (newStatus === 'CLOSED')    updates.closedAt   = now;
    if (newStatus === 'RESOLVED')  updates.resolvedAt = now;

    // Check resolution SLA breach
    if (newStatus === 'RESOLVED' && isResolutionBreached(ticket.slaResolution, now)) {
      updates.slaBreached = true;
      notifyStaff(NOTIFICATION_TYPES.SLA_BREACH, `SLA Breached: ${req.params.id}`,
        `Ticket ${req.params.id} was resolved after the SLA deadline.`, req.params.id);
    }

    await ticketRef.update(updates);

    // Status history
    await db.collection('ticket_status_history').add({
      ticketId: req.params.id,
      fromStatus: currentStatus,
      toStatus: newStatus,
      changedBy: req.user.uid,
      changedByRole: req.userRole,
      reason,
      createdAt: now,
    });

    // Audit
    await logAudit({ action: AUDIT_ACTIONS.STATUS_CHANGED, performedBy: req.user.uid,
      performedByRole: req.userRole, ticketId: req.params.id,
      oldValue: currentStatus, newValue: newStatus, req });

    // Notify ticket owner
    notifyUser(ticket.userId, NOTIFICATION_TYPES.STATUS_CHANGED,
      `Ticket Status Updated: ${req.params.id}`,
      `Your ticket "${ticket.subject}" status changed from ${currentStatus} to ${newStatus}.`,
      req.params.id
    );

    if (newStatus === 'CLOSED') {
      notifyUser(ticket.userId, NOTIFICATION_TYPES.TICKET_CLOSED,
        `Ticket Closed: ${req.params.id}`,
        `Your ticket "${ticket.subject}" has been closed. You can reopen it within ${REOPEN_WINDOW_DAYS} days if needed.`,
        req.params.id
      );
    }

    res.json({ message: `Status updated to ${newStatus}`, ticketId: req.params.id });
  } catch (err) {
    console.error('[Helpdesk] Change status error:', err);
    res.status(500).json({ message: 'Failed to update status', error: err.message });
  }
});

/**
 * PATCH /api/helpdesk/tickets/:id/priority
 * Change ticket priority. Agents+ only.
 */
router.patch('/tickets/:id/priority', authenticate, requireRole(...ROLES.AGENT_PLUS), async (req, res) => {
  try {
    const parsed = changePrioritySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });

    const db = getDb();
    const { priority: newPriority, reason } = parsed.data;
    const ticketRef = db.collection('tickets').doc(req.params.id);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists || ticketDoc.data().isDeleted) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const ticket = ticketDoc.data();
    const oldPriority = ticket.priority;
    const now = new Date().toISOString();

    await ticketRef.update({ priority: newPriority, updatedAt: now });

    // Priority history
    await db.collection('ticket_priority_history').add({
      ticketId: req.params.id,
      fromPriority: oldPriority,
      toPriority: newPriority,
      changedBy: req.user.uid,
      reason,
      createdAt: now,
    });

    // Audit
    await logAudit({ action: AUDIT_ACTIONS.PRIORITY_CHANGED, performedBy: req.user.uid,
      performedByRole: req.userRole, ticketId: req.params.id,
      oldValue: oldPriority, newValue: newPriority, req });

    // Notify
    notifyUser(ticket.userId, NOTIFICATION_TYPES.PRIORITY_CHANGED,
      `Ticket Priority Changed: ${req.params.id}`,
      `Priority for "${ticket.subject}" changed from ${oldPriority} to ${newPriority}.`,
      req.params.id
    );

    res.json({ message: `Priority updated to ${newPriority}`, ticketId: req.params.id });
  } catch (err) {
    console.error('[Helpdesk] Change priority error:', err);
    res.status(500).json({ message: 'Failed to update priority', error: err.message });
  }
});

/**
 * POST /api/helpdesk/tickets/:id/assign
 * Assign ticket to a support agent. Managers+ only.
 */
router.post('/tickets/:id/assign', authenticate, requireRole(...ROLES.MANAGER_PLUS), async (req, res) => {
  try {
    const parsed = assignTicketSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });

    const db = getDb();
    const { assignedTo, team, department } = parsed.data;
    const ticketRef = db.collection('tickets').doc(req.params.id);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists || ticketDoc.data().isDeleted) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Verify assignee exists
    const assigneeDoc = await db.collection('users').doc(assignedTo).get();
    if (!assigneeDoc.exists) return res.status(404).json({ message: 'Assignee user not found' });

    const now = new Date().toISOString();
    await ticketRef.update({ assignedTo, assignedTeam: team, updatedAt: now });

    // Assignment history
    await db.collection('ticket_assignments').add({
      ticketId: req.params.id,
      assignedTo,
      assignedBy: req.user.uid,
      team,
      department,
      assignedAt: now,
    });

    // Audit
    await logAudit({ action: AUDIT_ACTIONS.TICKET_ASSIGNED, performedBy: req.user.uid,
      performedByRole: req.userRole, ticketId: req.params.id,
      newValue: { assignedTo, team }, req });

    const ticket = ticketDoc.data();
    // Notify assignee
    notifyUser(assignedTo, NOTIFICATION_TYPES.ASSIGNED_TO_YOU,
      `Ticket Assigned to You: ${req.params.id}`,
      `You have been assigned ticket "${ticket.subject}".`,
      req.params.id
    );
    // Notify ticket owner
    notifyUser(ticket.userId, NOTIFICATION_TYPES.TICKET_ASSIGNED,
      `Your Ticket Was Assigned: ${req.params.id}`,
      `Your ticket "${ticket.subject}" has been assigned to a support agent.`,
      req.params.id
    );

    res.json({ message: 'Ticket assigned successfully', assignedTo });
  } catch (err) {
    console.error('[Helpdesk] Assign ticket error:', err);
    res.status(500).json({ message: 'Failed to assign ticket', error: err.message });
  }
});

/**
 * POST /api/helpdesk/tickets/:id/escalate
 * Escalate ticket. Managers+ only.
 */
router.post('/tickets/:id/escalate', authenticate, requireRole(...ROLES.MANAGER_PLUS), async (req, res) => {
  try {
    const parsed = escalateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });

    const db = getDb();
    const { reason, escalationLevel } = parsed.data;
    const ticketRef = db.collection('tickets').doc(req.params.id);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists || ticketDoc.data().isDeleted) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const ticket = ticketDoc.data();
    const newLevel = escalationLevel || (ticket.escalationLevel || 0) + 1;

    if (newLevel > 4) {
      return res.status(400).json({ message: 'Maximum escalation level (4) already reached' });
    }

    const now = new Date().toISOString();
    await ticketRef.update({ status: 'ESCALATED', escalationLevel: newLevel, updatedAt: now });

    // Escalation history
    await db.collection('ticket_escalations').add({
      ticketId: req.params.id,
      escalatedBy: req.user.uid,
      escalationLevel: newLevel,
      reason,
      escalatedAt: now,
    });

    // Status history
    await db.collection('ticket_status_history').add({
      ticketId: req.params.id,
      fromStatus: ticket.status,
      toStatus: 'ESCALATED',
      changedBy: req.user.uid,
      changedByRole: req.userRole,
      reason: `Escalated to Level ${newLevel}: ${reason}`,
      createdAt: now,
    });

    // Audit
    await logAudit({ action: AUDIT_ACTIONS.TICKET_ESCALATED, performedBy: req.user.uid,
      performedByRole: req.userRole, ticketId: req.params.id,
      newValue: { escalationLevel: newLevel, reason }, req });

    // Notify
    notifyAdmins(NOTIFICATION_TYPES.TICKET_ESCALATED,
      `Ticket Escalated to Level ${newLevel}: ${req.params.id}`,
      `Ticket "${ticket.subject}" has been escalated. Reason: ${reason}`,
      req.params.id
    );
    notifyUser(ticket.userId, NOTIFICATION_TYPES.STATUS_CHANGED,
      `Ticket Escalated: ${req.params.id}`,
      `Your ticket "${ticket.subject}" has been escalated to a higher support level.`,
      req.params.id
    );

    res.json({ message: `Ticket escalated to Level ${newLevel}`, escalationLevel: newLevel });
  } catch (err) {
    console.error('[Helpdesk] Escalate ticket error:', err);
    res.status(500).json({ message: 'Failed to escalate ticket', error: err.message });
  }
});

/**
 * POST /api/helpdesk/tickets/:id/reopen
 * Reopen a closed/resolved ticket. Ticket owner only.
 */
router.post('/tickets/:id/reopen', authenticate, async (req, res) => {
  try {
    const parsed = reopenSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });

    const db = getDb();
    const { reason } = parsed.data;
    const ticketRef = db.collection('tickets').doc(req.params.id);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists || ticketDoc.data().isDeleted) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const ticket = ticketDoc.data();

    // Only the owner can reopen (or admin)
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userRole = userDoc.exists ? userDoc.data().role : 'investor';
    const isAdmin = ROLES.AGENT_PLUS.includes(userRole);

    if (!isAdmin && ticket.userId !== req.user.uid) {
      return res.status(403).json({ message: 'Only the ticket owner can reopen this ticket' });
    }

    // Check if ticket is in a reopenable state
    if (!['CLOSED', 'RESOLVED'].includes(ticket.status)) {
      return res.status(400).json({ message: `Cannot reopen a ticket with status: ${ticket.status}` });
    }

    // Enforce reopen window (30 days from close)
    if (!isAdmin && ticket.closedAt) {
      const closedAt = new Date(ticket.closedAt).getTime();
      const windowMs = REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (Date.now() - closedAt > windowMs) {
        return res.status(400).json({
          message: `Reopen window has expired. Tickets can only be reopened within ${REOPEN_WINDOW_DAYS} days of closure.`,
        });
      }
    }

    const now = new Date().toISOString();
    const newReopenCount = (ticket.reopenCount || 0) + 1;

    // Recompute SLA for the reopened ticket
    const sla = await computeSlaDeadlines(ticket.priority, new Date());

    await ticketRef.update({
      status: 'REOPENED',
      reopenCount: newReopenCount,
      closedAt: null,
      resolvedAt: null,
      slaFirstResponse: sla.slaFirstResponse,
      slaResolution: sla.slaResolution,
      slaBreached: false,
      updatedAt: now,
    });

    // Reopen history
    await db.collection('ticket_reopen_history').add({
      ticketId: req.params.id,
      reopenedBy: req.user.uid,
      reason,
      reopenedAt: now,
      previousStatus: ticket.status,
    });

    // Status history
    await db.collection('ticket_status_history').add({
      ticketId: req.params.id,
      fromStatus: ticket.status,
      toStatus: 'REOPENED',
      changedBy: req.user.uid,
      changedByRole: userRole,
      reason,
      createdAt: now,
    });

    // Audit
    await logAudit({ action: AUDIT_ACTIONS.TICKET_REOPENED, performedBy: req.user.uid,
      performedByRole: userRole, ticketId: req.params.id,
      newValue: { reason, reopenCount: newReopenCount }, req });

    // Notify staff
    notifyStaff(NOTIFICATION_TYPES.TICKET_REOPENED,
      `Ticket Reopened: ${req.params.id}`,
      `${ticket.userName} reopened ticket "${ticket.subject}". Reason: ${reason}`,
      req.params.id
    );

    res.json({ message: 'Ticket reopened successfully', reopenCount: newReopenCount });
  } catch (err) {
    console.error('[Helpdesk] Reopen ticket error:', err);
    res.status(500).json({ message: 'Failed to reopen ticket', error: err.message });
  }
});

/**
 * DELETE /api/helpdesk/tickets/:id
 * Soft delete a ticket. Admins only.
 */
router.delete('/tickets/:id', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const ticketRef = db.collection('tickets').doc(req.params.id);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) return res.status(404).json({ message: 'Ticket not found' });

    await ticketRef.update({ isDeleted: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    await logAudit({ action: AUDIT_ACTIONS.TICKET_DELETED, performedBy: req.user.uid,
      performedByRole: req.userRole, ticketId: req.params.id, req });

    res.json({ message: 'Ticket soft-deleted successfully' });
  } catch (err) {
    console.error('[Helpdesk] Delete ticket error:', err);
    res.status(500).json({ message: 'Failed to delete ticket', error: err.message });
  }
});

// ─── Conversations (Messages) ──────────────────────────────────────────────────

/**
 * POST /api/helpdesk/tickets/:id/messages
 * Send a message or internal note on a ticket.
 */
router.post('/tickets/:id/messages', authenticate, requireOwnerOrAgent, messageLimiter, async (req, res) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error.flatten() });

    const db = getDb();
    const { message, isInternal, attachments } = parsed.data;

    // Fetch ticket
    const ticketRef = db.collection('tickets').doc(req.params.id);
    const ticketDoc = req.ticket ? { data: () => req.ticket } : await ticketRef.get();

    if (!ticketDoc.data || !ticketDoc.data()) {
      const td = await ticketRef.get();
      if (!td.exists || td.data().isDeleted) return res.status(404).json({ message: 'Ticket not found' });
    }

    const ticket = req.ticket || (await ticketRef.get()).data();

    // Only agents/admins can post internal notes
    if (isInternal && !ROLES.AGENT_PLUS.includes(req.userRole)) {
      return res.status(403).json({ message: 'Only support agents can add internal notes' });
    }

    // Determine sender type
    let senderType = 'USER';
    if (ROLES.ADMIN_PLUS.includes(req.userRole)) senderType = 'ADMIN';
    else if (ROLES.AGENT_PLUS.includes(req.userRole)) senderType = 'AGENT';

    const now = new Date().toISOString();
    const sanitizedMessage = sanitize(message);

    // Write message
    const msgRef = await db.collection('ticket_messages').add({
      ticketId: req.params.id,
      senderId: req.user.uid,
      senderType,
      senderName: req.userData?.fullName || req.userData?.companyName || 'Support',
      message: sanitizedMessage,
      isInternal,
      attachments,
      editedAt: null,
      isDeleted: false,
      createdAt: now,
    });

    // Write attachments to separate collection
    if (attachments && attachments.length > 0) {
      const batch = db.batch();
      attachments.forEach((att) => {
        const attRef = db.collection('ticket_attachments').doc();
        batch.set(attRef, {
          ticketId: req.params.id,
          messageId: msgRef.id,
          ...att,
          uploadedBy: req.user.uid,
          uploadedAt: now,
        });
      });
      await batch.commit();
    }

    // Update ticket metadata
    const ticketUpdates = { lastResponseAt: now, updatedAt: now };

    // Track first agent/admin response for SLA
    if (!ticket.firstResponseAt && senderType !== 'USER') {
      ticketUpdates.firstResponseAt = now;
      if (isFirstResponseBreached(ticket.slaFirstResponse, now)) {
        ticketUpdates.slaBreached = true;
        notifyStaff(NOTIFICATION_TYPES.SLA_BREACH,
          `First Response SLA Breached: ${req.params.id}`,
          `Ticket "${ticket.subject}" first response exceeded the SLA deadline.`,
          req.params.id
        );
      }
    }

    // If ticket was WAITING_FOR_USER and user replies, move to IN_PROGRESS
    if (ticket.status === 'WAITING_FOR_USER' && senderType === 'USER') {
      ticketUpdates.status = 'IN_PROGRESS';
      await db.collection('ticket_status_history').add({
        ticketId: req.params.id,
        fromStatus: 'WAITING_FOR_USER',
        toStatus: 'IN_PROGRESS',
        changedBy: req.user.uid,
        changedByRole: req.userRole,
        reason: 'User replied to ticket',
        createdAt: now,
      });
    }

    await ticketRef.update(ticketUpdates);

    // Audit
    await logAudit({
      action: isInternal ? AUDIT_ACTIONS.INTERNAL_NOTE_ADDED : AUDIT_ACTIONS.MESSAGE_ADDED,
      performedBy: req.user.uid, performedByRole: req.userRole,
      ticketId: req.params.id, req,
    });

    // Notifications (only for non-internal messages)
    if (!isInternal) {
      if (senderType === 'USER') {
        // User replied — notify staff
        notifyStaff(NOTIFICATION_TYPES.USER_REPLIED,
          `User Reply on Ticket: ${req.params.id}`,
          `${ticket.userName} replied on "${ticket.subject}".`,
          req.params.id
        );
      } else {
        // Agent/Admin replied — notify ticket owner
        notifyUser(ticket.userId, NOTIFICATION_TYPES.TICKET_REPLIED,
          `New Reply on Your Ticket: ${req.params.id}`,
          `Support has responded to your ticket "${ticket.subject}".`,
          req.params.id
        );
      }
    }

    res.status(201).json({ message: 'Message sent', messageId: msgRef.id });
  } catch (err) {
    console.error('[Helpdesk] Send message error:', err);
    res.status(500).json({ message: 'Failed to send message', error: err.message });
  }
});

/**
 * GET /api/helpdesk/tickets/:id/messages
 * Get conversation thread for a ticket.
 * Regular users cannot see internal notes.
 */
router.get('/tickets/:id/messages', authenticate, requireOwnerOrAgent, async (req, res) => {
  try {
    const db = getDb();
    const { limit = 50 } = req.query;
    const isAgent = ROLES.AGENT_PLUS.includes(req.userRole);

    // Single-field query — no composite index needed
    const snapshot = await db.collection('ticket_messages')
      .where('ticketId', '==', req.params.id)
      .get();

    // Filter and sort in memory
    let messages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    messages = messages.filter((m) => !m.isDeleted);
    if (!isAgent) messages = messages.filter((m) => !m.isInternal);
    messages.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
    messages = messages.slice(0, Number(limit));

    res.json({ data: messages, count: messages.length });
  } catch (err) {
    console.error('[Helpdesk] Get messages error:', err);
    res.status(500).json({ message: 'Failed to get messages', error: err.message });
  }
});

/**
 * GET /api/helpdesk/tickets/:id/history
 * Full ticket history: status changes, priority changes, assignments, escalations, reopens.
 */
router.get('/tickets/:id/history', authenticate, requireRole(...ROLES.AGENT_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const ticketId = req.params.id;

    const [statusSnap, prioritySnap, assignSnap, escalateSnap, reopenSnap] = await Promise.all([
      db.collection('ticket_status_history').where('ticketId', '==', ticketId).orderBy('createdAt', 'asc').get(),
      db.collection('ticket_priority_history').where('ticketId', '==', ticketId).orderBy('createdAt', 'asc').get(),
      db.collection('ticket_assignments').where('ticketId', '==', ticketId).orderBy('assignedAt', 'asc').get(),
      db.collection('ticket_escalations').where('ticketId', '==', ticketId).orderBy('escalatedAt', 'asc').get(),
      db.collection('ticket_reopen_history').where('ticketId', '==', ticketId).orderBy('reopenedAt', 'asc').get(),
    ]);

    res.json({
      statusHistory:   statusSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      priorityHistory: prioritySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      assignments:     assignSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      escalations:     escalateSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      reopenHistory:   reopenSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  } catch (err) {
    console.error('[Helpdesk] Get history error:', err);
    res.status(500).json({ message: 'Failed to get ticket history', error: err.message });
  }
});

// ─── Dashboard & Analytics ────────────────────────────────────────────────────

/**
 * GET /api/helpdesk/dashboard
 * Admin dashboard — ticket counts by status, priority, SLA breaches, avg resolution time.
 */
router.get('/dashboard', authenticate, requireRole(...ROLES.AGENT_PLUS), async (req, res) => {
  try {
    const db = getDb();

    // Single-field query only — filter everything in memory
    const allSnap = await db.collection('tickets').where('isDeleted', '==', false).get();
    const allTickets = allSnap.docs.map((d) => d.data());

    const statusCounts = {};
    VALID_STATUSES.forEach((s) => { statusCounts[s] = allTickets.filter((t) => t.status === s).length; });

    const priorityCounts = {};
    VALID_PRIORITIES.forEach((p) => { priorityCounts[p] = allTickets.filter((t) => t.priority === p).length; });

    const slaBreaches = allTickets.filter((t) => t.slaBreached === true).length;

    const resolvedTickets = allTickets.filter((t) => t.status === 'RESOLVED' && t.resolvedAt && t.createdAt);
    let totalResolutionMs = 0;
    resolvedTickets.forEach((t) => { totalResolutionMs += new Date(t.resolvedAt) - new Date(t.createdAt); });
    const avgResolutionHours = resolvedTickets.length > 0
      ? Math.round(totalResolutionMs / resolvedTickets.length / 3600000 * 10) / 10
      : null;

    res.json({
      total: allTickets.length,
      byStatus: statusCounts,
      byPriority: { ...priorityCounts, colors: PRIORITY_COLORS },
      slaBreaches,
      avgResolutionHours,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Helpdesk] Dashboard error:', err);
    res.status(500).json({ message: 'Failed to load dashboard', error: err.message });
  }
});

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * GET /api/helpdesk/search
 * Advanced ticket search. Agents+ only.
 * Supports filter by ticketId, userEmail, userMobile, status, priority, category, date range.
 */
router.get('/search', authenticate, requireRole(...ROLES.AGENT_PLUS), searchLimiter, async (req, res) => {
  try {
    const db = getDb();
    const { ticketId, userEmail, userMobile, status, priority, category, from, to, limit = 20 } = req.query;

    // Single-field query — all filtering done in memory
    const snapshot = await db.collection('tickets').where('isDeleted', '==', false).get();
    let tickets = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (ticketId)  tickets = tickets.filter((t) => t.ticketId === ticketId);
    if (userEmail) tickets = tickets.filter((t) => t.userEmail === userEmail);
    if (userMobile) tickets = tickets.filter((t) => t.userMobile === userMobile);
    if (status)    tickets = tickets.filter((t) => t.status === status.toUpperCase());
    if (priority)  tickets = tickets.filter((t) => t.priority === priority.toUpperCase());
    if (category)  tickets = tickets.filter((t) => t.category === category);
    if (from)      tickets = tickets.filter((t) => t.createdAt >= from);
    if (to)        tickets = tickets.filter((t) => t.createdAt <= to);

    tickets.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    tickets = tickets.slice(0, Number(limit));

    res.json({ data: tickets, count: tickets.length });
  } catch (err) {
    console.error('[Helpdesk] Search error:', err);
    res.status(500).json({ message: 'Search failed', error: err.message });
  }
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────

/**
 * GET /api/helpdesk/audit-logs
 * View audit logs. Admins only.
 */
router.get('/audit-logs', authenticate, requireRole(...ROLES.ADMIN_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const { ticketId, action, from, to, limit = 50 } = req.query;

    let query = db.collection('audit_logs');

    if (ticketId) query = query.where('ticketId', '==', ticketId);
    if (action)   query = query.where('action', '==', action);
    if (from)     query = query.where('timestamp', '>=', from);
    if (to)       query = query.where('timestamp', '<=', to);

    const snapshot = await query.orderBy('timestamp', 'desc').limit(Number(limit)).get();
    const logs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    res.json({ data: logs, count: logs.length });
  } catch (err) {
    console.error('[Helpdesk] Audit logs error:', err);
    res.status(500).json({ message: 'Failed to fetch audit logs', error: err.message });
  }
});

// ─── Upload URL ───────────────────────────────────────────────────────────────

/**
 * POST /api/helpdesk/attachments/upload-url
 * Returns a Firebase Storage path for client-side upload.
 * Client uses Firebase Client SDK to upload, then sends back the download URL with the message.
 */
router.post('/attachments/upload-url', authenticate, async (req, res) => {
  try {
    const { fileName, mimeType, ticketId } = req.body;

    if (!fileName || !mimeType) {
      return res.status(400).json({ message: 'fileName and mimeType are required' });
    }

    // Validate allowed MIME types
    const ALLOWED_TYPES = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip', 'application/x-zip-compressed',
      'text/plain',
    ];

    if (!ALLOWED_TYPES.includes(mimeType)) {
      return res.status(400).json({ message: 'File type not allowed', allowed: ALLOWED_TYPES });
    }

    const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
    if (req.body.fileSize && req.body.fileSize > MAX_SIZE_BYTES) {
      return res.status(400).json({ message: 'File size exceeds 10MB limit' });
    }

    const ext = fileName.split('.').pop();
    const safeName = `${Date.now()}_${req.user.uid}.${ext}`;
    const storagePath = `helpdesk/${ticketId || 'general'}/${safeName}`;

    // Return the storage path for client-side upload via Firebase SDK
    res.json({
      storagePath,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${require('../firebase').admin.app().options.projectId}.appspot.com`,
      message: 'Use Firebase Client SDK to upload to this path, then include the download URL in your message.',
    });
  } catch (err) {
    console.error('[Helpdesk] Upload URL error:', err);
    res.status(500).json({ message: 'Failed to generate upload reference', error: err.message });
  }
});

module.exports = router;
