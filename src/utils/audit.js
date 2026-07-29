const { getDb } = require('../firebase');

/**
 * Audit action constants
 */
const AUDIT_ACTIONS = {
  TICKET_CREATED:     'TICKET_CREATED',
  TICKET_UPDATED:     'TICKET_UPDATED',
  STATUS_CHANGED:     'STATUS_CHANGED',
  PRIORITY_CHANGED:   'PRIORITY_CHANGED',
  TICKET_ASSIGNED:    'TICKET_ASSIGNED',
  TICKET_ESCALATED:   'TICKET_ESCALATED',
  TICKET_REOPENED:    'TICKET_REOPENED',
  TICKET_CLOSED:      'TICKET_CLOSED',
  TICKET_DELETED:     'TICKET_DELETED',
  MESSAGE_ADDED:      'MESSAGE_ADDED',
  INTERNAL_NOTE_ADDED:'INTERNAL_NOTE_ADDED',
  ATTACHMENT_ADDED:   'ATTACHMENT_ADDED',
  ATTACHMENT_DELETED: 'ATTACHMENT_DELETED',
  CATEGORY_CREATED:   'CATEGORY_CREATED',
  CATEGORY_UPDATED:   'CATEGORY_UPDATED',
  CATEGORY_DELETED:   'CATEGORY_DELETED',
  SLA_UPDATED:        'SLA_UPDATED',
  SLA_BREACH:         'SLA_BREACH',
};

/**
 * Write an immutable audit log entry to Firestore.
 * Audit logs are NEVER updated or deleted — only appended.
 *
 * @param {object} params
 * @param {string} params.action         - One of AUDIT_ACTIONS
 * @param {string} params.performedBy    - UID of user who performed the action
 * @param {string} params.performedByRole
 * @param {string} [params.ticketId]
 * @param {*}      [params.oldValue]
 * @param {*}      [params.newValue]
 * @param {object} [params.req]          - Express request (for IP extraction)
 * @param {object} [params.meta]         - Any extra metadata
 */
const logAudit = async ({
  action,
  performedBy,
  performedByRole = 'unknown',
  ticketId = null,
  oldValue = null,
  newValue = null,
  req = null,
  meta = {},
}) => {
  try {
    const db = getDb();

    const ipAddress =
      (req && (req.headers['x-forwarded-for'] || req.socket?.remoteAddress)) ||
      'unknown';

    await db.collection('audit_logs').add({
      action,
      performedBy,
      performedByRole,
      ticketId,
      oldValue,
      newValue,
      ipAddress,
      meta,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Audit failures must never block the main request
    console.error('[Audit] Failed to write audit log:', err.message);
  }
};

module.exports = { logAudit, AUDIT_ACTIONS };
