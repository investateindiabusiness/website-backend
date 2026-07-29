const { getDb } = require('../firebase');
const { sendMail, buildTemplate } = require('./emailHelper');

/**
 * Notification types
 */
const NOTIFICATION_TYPES = {
  // User-facing
  TICKET_CREATED:        'TICKET_CREATED',
  TICKET_REPLIED:        'TICKET_REPLIED',
  STATUS_CHANGED:        'STATUS_CHANGED',
  PRIORITY_CHANGED:      'PRIORITY_CHANGED',
  TICKET_ASSIGNED:       'TICKET_ASSIGNED',
  TICKET_RESOLVED:       'TICKET_RESOLVED',
  TICKET_CLOSED:         'TICKET_CLOSED',
  TICKET_REOPENED:       'TICKET_REOPENED',
  // Admin/Agent-facing
  NEW_TICKET:            'NEW_TICKET',
  USER_REPLIED:          'USER_REPLIED',
  TICKET_ESCALATED:      'TICKET_ESCALATED',
  SLA_BREACH:            'SLA_BREACH',
  ASSIGNED_TO_YOU:       'ASSIGNED_TO_YOU',
  // Admin-specific
  KYC_PENDING_REVIEW:    'KYC_PENDING_REVIEW',
  KYC_APPROVED:          'KYC_APPROVED',
  KYC_REJECTED:          'KYC_REJECTED',
  AD_PENDING_REVIEW:     'AD_PENDING_REVIEW',
  AD_APPROVED:           'AD_APPROVED',
  AD_REJECTED:           'AD_REJECTED',
  AD_RESUBMITTED:        'AD_RESUBMITTED',
  NEW_AD_BOOKING:        'NEW_AD_BOOKING',
  // Builder/Investor notifications
  CAMPAIGN_APPROVED:     'CAMPAIGN_APPROVED',
  CAMPAIGN_REJECTED:     'CAMPAIGN_REJECTED',
  PAYMENT_CONFIRMED:     'PAYMENT_CONFIRMED',
  // SP Outreach Messaging
  SP_MESSAGE_PENDING:    'SP_MESSAGE_PENDING',
  SP_MESSAGE_ACCEPTED:   'SP_MESSAGE_ACCEPTED',
  SP_MESSAGE_REJECTED:   'SP_MESSAGE_REJECTED',
  SP_MESSAGE_RECEIVED:   'SP_MESSAGE_RECEIVED',
  SP_REPLY_RECEIVED:     'SP_REPLY_RECEIVED',
  // Account Status
  USER_VERIFIED:         'USER_VERIFIED',
  USER_SUSPENDED:        'USER_SUSPENDED',
  COUPON_ASSIGNED:       'COUPON_ASSIGNED',
  MEMBERSHIP_ACTIVATED:  'MEMBERSHIP_ACTIVATED',
};

/**
 * Send a notification to a single user (writes in-app notif & emails the user).
 */
const notifyUser = async (userId, type, title, message, ticketId = null, meta = {}, targetRoles = []) => {
  if (!userId) return;

  try {
    const db = getDb();
    
    // 1. Write the persistent in-app notification to Firestore
    await db.collection('notifications').add({
      userId,
      type,
      title,
      message,
      ticketId,
      meta,
      targetRoles,
      isRead: false,
      createdAt: new Date().toISOString(),
    });

    // 2. Fetch user's email to send matching email notification
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      const email = userData.email || '';
      
      if (email) {
        const name = userData.fullName || userData.companyName || 'Valued User';
        const html = buildTemplate(
          title,
          `
            <p>Dear ${name},</p>
            <p>${message}</p>
            ${ticketId ? `<p><strong>Ticket ID:</strong> ${ticketId}</p>` : ''}
            <p style="margin-top: 20px;">Best regards,<br/><strong>Investate India Team</strong></p>
          `
        );
        
        // Send email asynchronously in the background
        sendMail(email, `[Investate India] ${title}`, message, html).catch(err => {
          console.error('[Notifications] Background email sending failed:', err.message);
        });
      }
    }
  } catch (err) {
    console.error('[Notifications] Failed to process notifyUser:', err.message);
  }
};

/**
 * Send a notification to all admin and support_manager users (writes in-app notifs & emails them).
 */
const notifyAdmins = async (type, title, message, ticketId = null, meta = {}, targetRoles = ['admin', 'super_admin', 'support_manager']) => {
  try {
    const db = getDb();
    const adminRoles = ['admin', 'super_admin', 'support_manager'];

    const snapshot = await db
      .collection('users')
      .where('role', 'in', adminRoles)
      .get();

    if (snapshot.empty) return;

    const batch = db.batch();
    const now = new Date().toISOString();
    const adminEmails = [];

    snapshot.docs.forEach((doc) => {
      const ref = db.collection('notifications').doc();
      const userData = doc.data();
      
      batch.set(ref, {
        userId: doc.id,
        type,
        title,
        message,
        ticketId,
        meta,
        targetRoles,
        isRead: false,
        createdAt: now,
      });

      if (userData.email) {
        adminEmails.push(userData.email);
      }
    });

    await batch.commit();

    // Send emails to admins
    if (adminEmails.length > 0) {
      const html = buildTemplate(
        title,
        `
          <p>Hello Admin Team,</p>
          <p><strong>System Alert:</strong> ${message}</p>
          ${ticketId ? `<p><strong>Ticket ID:</strong> ${ticketId}</p>` : ''}
          <p style="margin-top: 20px; font-size: 13px; color: #64748b;">Please review this in the Admin Panel.</p>
        `
      );

      adminEmails.forEach((email) => {
        sendMail(email, `[Admin Alert] ${title}`, message, html).catch(err => {
          console.error(`[Notifications] Admin email sending failed for ${email}:`, err.message);
        });
      });
    }
  } catch (err) {
    console.error('[Notifications] Failed to notify admins:', err.message);
  }
};

/**
 * Send a notification to all support_agents.
 */
const notifyAgents = async (type, title, message, ticketId = null, meta = {}, targetRoles = ['support_agent']) => {
  try {
    const db = getDb();
    const snapshot = await db
      .collection('users')
      .where('role', '==', 'support_agent')
      .get();

    if (snapshot.empty) return;

    const batch = db.batch();
    const now = new Date().toISOString();
    const agentEmails = [];

    snapshot.docs.forEach((doc) => {
      const ref = db.collection('notifications').doc();
      const userData = doc.data();
      
      batch.set(ref, {
        userId: doc.id,
        type,
        title,
        message,
        ticketId,
        meta,
        targetRoles,
        isRead: false,
        createdAt: now,
      });

      if (userData.email) {
        agentEmails.push(userData.email);
      }
    });

    await batch.commit();

    // Send emails to agents
    if (agentEmails.length > 0) {
      const html = buildTemplate(
        title,
        `
          <p>Hello Support Agent,</p>
          <p><strong>Ticket Alert:</strong> ${message}</p>
          ${ticketId ? `<p><strong>Ticket ID:</strong> ${ticketId}</p>` : ''}
          <p style="margin-top: 20px; font-size: 13px; color: #64748b;">Please check your helpdesk tickets queue.</p>
        `
      );

      agentEmails.forEach((email) => {
        sendMail(email, `[Support Alert] ${title}`, message, html).catch(err => {
          console.error(`[Notifications] Agent email sending failed for ${email}:`, err.message);
        });
      });
    }
  } catch (err) {
    console.error('[Notifications] Failed to notify agents:', err.message);
  }
};

/**
 * Notify admins + agents (support staff) together.
 */
const notifyStaff = async (type, title, message, ticketId = null, meta = {}) => {
  await Promise.allSettled([
    notifyAdmins(type, title, message, ticketId, meta),
    notifyAgents(type, title, message, ticketId, meta),
  ]);
};

module.exports = {
  notifyUser,
  notifyAdmins,
  notifyAgents,
  notifyStaff,
  NOTIFICATION_TYPES,
};
