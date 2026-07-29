const { getDb } = require('../firebase');

/**
 * Role hierarchy — higher number = more permissions
 */
const ROLE_LEVELS = {
  super_admin: 5,
  admin: 4,
  support_manager: 3,
  support_agent: 2,
  builder: 1,
  investor: 1,
  serviceProvider: 1,
};

/**
 * Convenience role groups
 */
const ROLES = {
  ANY_USER: ['investor', 'builder', 'serviceProvider', 'support_agent', 'support_manager', 'admin', 'super_admin'],
  AGENT_PLUS: ['support_agent', 'support_manager', 'admin', 'super_admin'],
  MANAGER_PLUS: ['support_manager', 'admin', 'super_admin'],
  ADMIN_PLUS: ['admin', 'super_admin'],
  SUPER_ADMIN: ['super_admin', 'admin'], // treat admin as super_admin for helpdesk
};

/**
 * Middleware factory — requires authenticated user with one of the allowed roles.
 * Must be placed AFTER the `authenticate` middleware from auth.js.
 *
 * Usage: router.get('/route', authenticate, requireRole(...ROLES.AGENT_PLUS), handler)
 */
const requireRole = (...allowedRoles) => async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized: No token provided' });
  }

  try {
    const db = getDb();
    const userDoc = await db.collection('users').doc(req.user.uid).get();

    if (!userDoc.exists) {
      return res.status(403).json({ message: 'Forbidden: User record not found' });
    }

    const userData = userDoc.data();
    const userRole = userData.role || 'investor';

    // Attach full user data for use in route handlers
    req.userRole = userRole;
    req.userData = userData;

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        message: 'Forbidden: Insufficient permissions',
        yourRole: userRole,
        requiredOneOf: allowedRoles,
      });
    }

    next();
  } catch (err) {
    console.error('[RBAC] Error during role check:', err);
    res.status(500).json({ message: 'Authorization error' });
  }
};

/**
 * Middleware — verifies the authenticated user owns the ticket,
 * OR has at least support_agent role. Used on ticket detail/message routes.
 */
const requireOwnerOrAgent = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const db = getDb();
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) return res.status(403).json({ message: 'User not found' });

    const userData = userDoc.data();
    const userRole = userData.role || 'investor';

    req.userRole = userRole;
    req.userData = userData;

    // Agents and above skip the ownership check
    if (ROLES.AGENT_PLUS.includes(userRole)) return next();

    // For regular users, check ticket ownership
    const ticketId = req.params.id || req.params.ticketId;
    if (!ticketId) return res.status(400).json({ message: 'Ticket ID required' });

    const ticketDoc = await db.collection('tickets').doc(ticketId).get();
    if (!ticketDoc.exists) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = ticketDoc.data();
    if (ticket.userId !== req.user.uid) {
      return res.status(403).json({ message: 'Forbidden: You do not own this ticket' });
    }

    req.ticket = { id: ticketDoc.id, ...ticket };
    next();
  } catch (err) {
    console.error('[RBAC] Owner/Agent check error:', err);
    res.status(500).json({ message: 'Authorization error' });
  }
};

module.exports = { requireRole, requireOwnerOrAgent, ROLES };
