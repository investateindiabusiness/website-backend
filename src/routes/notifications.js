const express = require('express');
const { getDb } = require('../firebase');
const { authenticate } = require('./auth');
const { requireRole, ROLES } = require('../middleware/rbac');

const router = express.Router();

/**
 * GET /api/notifications
 * Get notifications - filtered by role
 * - Admins: admin-specific + system-wide notifications (NOT role-specific like builder/investor)
 * - Regular users: their own + their role-based notifications
 * Query params: limit, lastDocId, isRead (true|false|all)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const { limit = 20, lastDocId, isRead } = req.query;

    // Check user role to determine notification scope
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userRole = userDoc.exists ? userDoc.data().role : 'investor';
    const isAdmin = ROLES.AGENT_PLUS.includes(userRole);

    // Fetch all notifications
    let snapshot = await db.collection('notifications').get();
    let notifications = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Filter by role
    const adminRoles = ['admin', 'super_admin', 'support_manager', 'support_agent'];
    if (isAdmin) {
      // Admins see:
      // 1. Their own notifications
      // 2. Notifications explicitly marked for admin roles
      notifications = notifications.filter(n => {
        const roles = Array.isArray(n.targetRoles) ? n.targetRoles : [];
        if (n.userId === req.user.uid) return true;
        return roles.some(r => adminRoles.includes(r));
      });
    } else {
      // Regular users only see their own notifications (userId must match).
      // targetRoles is only used for admin-side visibility — not for broadcasting
      // the same notification to every member of a role.
      notifications = notifications.filter(n => n.userId === req.user.uid);
    }

    // Apply isRead filter
    if (isRead === 'true') {
      notifications = notifications.filter(n => n.isRead === true);
    } else if (isRead === 'false') {
      notifications = notifications.filter(n => n.isRead === false);
    }

    // Sort in memory descending by createdAt
    notifications.sort((a, b) => {
      const aTime = a.createdAt || '';
      const bTime = b.createdAt || '';
      return bTime > aTime ? 1 : -1;
    });

    // Pagination
    let startIndex = 0;
    if (lastDocId) {
      const lastIndex = notifications.findIndex(n => n.id === lastDocId);
      if (lastIndex !== -1) {
        startIndex = lastIndex + 1;
      }
    }

    const limited = notifications.slice(startIndex, startIndex + Number(limit));

    res.json({
      data: limited,
      pagination: {
        count: limited.length,
        limit: Number(limit),
        lastDocId: limited.length > 0 ? limited[limited.length - 1].id : null,
        hasMore: startIndex + Number(limit) < notifications.length,
      },
    });
  } catch (err) {
    console.error('[Notifications] List error:', err);
    res.status(500).json({ message: 'Failed to fetch notifications', error: err.message });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get unread notification count for the bell badge.
 * For regular users: count of their own + role-based unread notifications
 * For admins: count of all unread notifications in the system
 */
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userRole = userDoc.exists ? userDoc.data().role : 'investor';
    const isAdmin = ROLES.AGENT_PLUS.includes(userRole);

    let snapshot;
    // Always fetch unread notifications, then filter by role/user
    snapshot = await db.collection('notifications')
      .where('isRead', '==', false)
      .get();

    let notifications = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const adminRoles = ['admin', 'super_admin', 'support_manager', 'support_agent'];

    if (isAdmin) {
      // Admins see their own unread and admin-targeted unread notifications only
      notifications = notifications.filter(n => {
        if (n.userId === req.user.uid) return true;
        const roles = Array.isArray(n.targetRoles) ? n.targetRoles : [];
        return roles.some(r => adminRoles.includes(r));
      });
    } else {
      notifications = notifications.filter(n => {
        if (n.userId === req.user.uid) return true;
        const roles = Array.isArray(n.targetRoles) ? n.targetRoles : [];
        return roles.includes(userRole);
      });
    }

    res.json({ count: notifications.length });
  } catch (err) {
    console.error('[Notifications] Unread count error:', err);
    res.status(500).json({ message: 'Failed to get unread count', error: err.message });
  }
});

/**
 * GET /api/notifications/admin/all
 * Get ALL notifications in the system (Admin/Agent only).
 * Query params: limit, lastDocId, isRead (true|false|all), userId (optional filter)
 */
router.get('/admin/all', authenticate, requireRole(...ROLES.AGENT_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const { limit = 20, lastDocId, isRead, userId } = req.query;

    // Build filters - start with isRead if specified
    let snapshot;
    if (isRead === 'true') {
      snapshot = await db.collection('notifications')
        .where('isRead', '==', true)
        .get();
    } else if (isRead === 'false') {
      snapshot = await db.collection('notifications')
        .where('isRead', '==', false)
        .get();
    } else {
      // Get all notifications (no filter)
      snapshot = await db.collection('notifications').get();
    }

    let notifications = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Apply userId filter in memory if provided
    if (userId) {
      notifications = notifications.filter(n => n.userId === userId);
    }

    // Sort in memory descending by createdAt
    notifications.sort((a, b) => {
      const aTime = a.createdAt || '';
      const bTime = b.createdAt || '';
      return bTime > aTime ? 1 : -1;
    });

    // Pagination
    let startIndex = 0;
    if (lastDocId) {
      const lastIndex = notifications.findIndex(n => n.id === lastDocId);
      if (lastIndex !== -1) {
        startIndex = lastIndex + 1;
      }
    }

    const limited = notifications.slice(startIndex, startIndex + Number(limit));

    res.json({
      data: limited,
      pagination: {
        count: limited.length,
        limit: Number(limit),
        lastDocId: limited.length > 0 ? limited[limited.length - 1].id : null,
        hasMore: startIndex + Number(limit) < notifications.length,
      },
    });
  } catch (err) {
    console.error('[Notifications] Admin list all error:', err);
    res.status(500).json({ message: 'Failed to fetch all notifications', error: err.message });
  }
});

/**
 * GET /api/notifications/admin/stats
 * Get notification statistics (Admin/Agent only).
 */
router.get('/admin/stats', authenticate, requireRole(...ROLES.AGENT_PLUS), async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('notifications').get();
    const allNotifications = snapshot.docs.map(doc => doc.data());

    const stats = {
      total: allNotifications.length,
      unread: allNotifications.filter(n => !n.isRead).length,
      read: allNotifications.filter(n => n.isRead).length,
      byType: {},
      byUser: {},
    };

    // Count by type
    allNotifications.forEach(n => {
      const type = n.type || 'UNKNOWN';
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    });

    // Count by user
    allNotifications.forEach(n => {
      const userId = n.userId || 'unknown';
      stats.byUser[userId] = (stats.byUser[userId] || 0) + 1;
    });

    res.json(stats);
  } catch (err) {
    console.error('[Notifications] Admin stats error:', err);
    res.status(500).json({ message: 'Failed to fetch notification stats', error: err.message });
  }
});

/**
 * PATCH /api/notifications/read-all
 * Mark ALL unread notifications as read for the authenticated user.
 * Must come BEFORE the /:id route to match correctly.
 */
router.patch('/read-all', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userRole = userDoc.exists ? userDoc.data().role : 'investor';
    const isAdmin = ROLES.AGENT_PLUS.includes(userRole);

    let snapshot;
    if (isAdmin) {
      // Admins mark ALL unread notifications as read in the system
      snapshot = await db.collection('notifications')
        .where('isRead', '==', false)
        .get();
    } else {
      // Regular users mark only their own unread notifications
      snapshot = await db.collection('notifications')
        .where('userId', '==', req.user.uid)
        .where('isRead', '==', false)
        .get();
    }

    if (snapshot.empty) return res.json({ message: 'No unread notifications', updated: 0 });

    const batch = db.batch();
    const now = new Date().toISOString();
    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, { isRead: true, readAt: now });
    });

    await batch.commit();
    res.json({ message: 'All notifications marked as read', updated: snapshot.size });
  } catch (err) {
    console.error('[Notifications] Mark all read error:', err);
    res.status(500).json({ message: 'Failed to mark all notifications as read', error: err.message });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read.
 */
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('notifications').doc(req.params.id);
    const doc = await ref.get();

    if (!doc.exists) return res.status(404).json({ message: 'Notification not found' });

    // Security: Users can only mark their own notifications
    if (doc.data().userId !== req.user.uid) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await ref.update({ isRead: true, readAt: new Date().toISOString() });
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    console.error('[Notifications] Mark read error:', err);
    res.status(500).json({ message: 'Failed to mark notification as read', error: err.message });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a single notification for the authenticated user.
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('notifications').doc(req.params.id);
    const doc = await ref.get();

    if (!doc.exists) return res.status(404).json({ message: 'Notification not found' });
    if (doc.data().userId !== req.user.uid) return res.status(403).json({ message: 'Forbidden' });

    await ref.delete();
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    console.error('[Notifications] Delete error:', err);
    res.status(500).json({ message: 'Failed to delete notification', error: err.message });
  }
});

module.exports = router;
