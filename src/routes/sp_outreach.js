const express = require('express');
const { getDb, admin } = require('../firebase');
const { authenticate } = require('./auth');
const { requireRole } = require('../middleware/rbac');
const {
  notifyUser,
  notifyAdmins,
  NOTIFICATION_TYPES,
} = require('../utils/notificationHelper');

const router = express.Router();
const db = getDb();

// ─────────────────────────────────────────────────────────────
// PRIVACY FIELDS — always stripped before returning to SP
// ─────────────────────────────────────────────────────────────
const PRIVATE_FIELDS = [
  'email',
  'contactNumber',
  'phone',
  'whatsApp',
  'whatsapp',
  'address',
  'password',
  'panNumber',
  'aadhaarNumber',
  'passportNumber',
  'bankAccount',
  'kycPassportUrl',
];

const stripPrivateFields = (obj) => {
  const safe = { ...obj };
  PRIVATE_FIELDS.forEach((f) => delete safe[f]);
  return safe;
};

// ─────────────────────────────────────────────────────────────
// 1. GET /api/sp-outreach/directory
//    Service Provider: browse privacy-safe investor + builder list
//    Include the current outreach status for each user
// ─────────────────────────────────────────────────────────────
router.get(
  '/directory',
  authenticate,
  requireRole('serviceProvider'),
  async (req, res, next) => {
    try {
      const {
        page = 1,
        limit = 20,
        search = '',
        role = 'all', // 'investor' | 'builder' | 'all'
        type = 'all',
      } = req.query;

      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      let results = [];

      const fetchByRole = async (targetRole) => {
        let query = db.collection('users').where('role', '==', targetRole);

        // Only show verified / complete-onboarding users
        query = query.where('onboardingStatus', '==', 'complete');

        const snapshot = await query.get();
        return snapshot.docs.map((doc) => {
          const safe = stripPrivateFields(doc.data());
          return { id: doc.id, ...safe };
        });
      };

      if (role === 'all') {
        const [investors, builders] = await Promise.all([
          fetchByRole('investor'),
          fetchByRole('builder'),
        ]);
        results = [...investors, ...builders];
      } else {
        results = await fetchByRole(role);
      }

      // Investor type filter (only meaningful for investors)
      if (type !== 'all') {
        results = results.filter((u) => u.investorType === type);
      }

      // In-memory search (name, city, state, companyName, serviceCategory)
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        results = results.filter(
          (u) =>
            (u.fullName || u.name || '').toLowerCase().includes(q) ||
            (u.city || '').toLowerCase().includes(q) ||
            (u.state || '').toLowerCase().includes(q) ||
            (u.companyName || '').toLowerCase().includes(q) ||
            (u.investorType || '').toLowerCase().includes(q)
        );
      }

      // Sort alphabetically
      results.sort((a, b) =>
        (a.fullName || a.name || '').localeCompare(b.fullName || b.name || '')
      );

      // Fetch all of this SP's sent messages to check active outreach statuses in-memory
      const sentSnapshot = await db
        .collection('sp_outreach_messages')
        .where('spId', '==', req.user.uid)
        .get();
      
      const sentOutreaches = {};
      sentSnapshot.docs.forEach((doc) => {
        const d = doc.data();
        // Keep the latest or most active status if multiple exist (though schema prevents it)
        sentOutreaches[d.recipientId] = {
          id: doc.id,
          status: d.status,
          hasRecipientReplied: d.hasRecipientReplied || false,
        };
      });

      // Map outreach info to directory users
      results = results.map((u) => {
        const out = sentOutreaches[u.id];
        return {
          ...u,
          outreachId: out ? out.id : null,
          outreachStatus: out ? out.status : null,
          hasRecipientReplied: out ? out.hasRecipientReplied : false,
        };
      });

      const total = results.length;
      const offset = (pageNum - 1) * limitNum;
      const paginated = results.slice(offset, offset + limitNum);

      res.json({
        success: true,
        data: paginated,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 2. POST /api/sp-outreach/messages
//    Service Provider: send a message (queued for admin review)
// ─────────────────────────────────────────────────────────────
router.post(
  '/messages',
  authenticate,
  requireRole('serviceProvider'),
  async (req, res, next) => {
    try {
      const { recipientId, subject, body } = req.body;

      if (!recipientId || !subject || !body) {
        return res
          .status(400)
          .json({ message: 'recipientId, subject, and body are required.' });
      }

      if (subject.trim().length < 5 || subject.trim().length > 150) {
        return res
          .status(400)
          .json({ message: 'Subject must be between 5 and 150 characters.' });
      }

      if (body.trim().length < 20 || body.trim().length > 3000) {
        return res
          .status(400)
          .json({ message: 'Message body must be between 20 and 3000 characters.' });
      }

      // Check if there is already an existing conversation/message that isn't rejected
      const existingSnapshot = await db
        .collection('sp_outreach_messages')
        .where('spId', '==', req.user.uid)
        .where('recipientId', '==', recipientId)
        .get();

      if (!existingSnapshot.empty) {
        // Find if there is any active message (status not rejected)
        const active = existingSnapshot.docs.find(doc => doc.data().status !== 'rejected');
        if (active) {
          const actData = active.data();
          if (actData.status === 'pending_review') {
            return res.status(400).json({ message: 'A message to this user is already pending admin review.' });
          }
          if (actData.status === 'blocked') {
            return res.status(400).json({ message: 'The conversation with this user has been blocked by the admin.' });
          }
          if (actData.status === 'delivered') {
            if (!actData.hasRecipientReplied) {
              return res.status(400).json({ message: 'You have already sent an outreach. You cannot message them again until they respond.' });
            } else {
              return res.status(400).json({ message: 'An active conversation already exists. Please continue replying from your Outreach inbox.' });
            }
          }
        }
      }

      // Fetch recipient basic info
      const recipientDoc = await db
        .collection('users')
        .doc(recipientId)
        .get();

      if (!recipientDoc.exists) {
        return res.status(404).json({ message: 'Recipient not found.' });
      }

      const recipientData = recipientDoc.data();
      if (!['investor', 'builder'].includes(recipientData.role)) {
        return res
          .status(400)
          .json({ message: 'You can only message investors or builders.' });
      }

      // Fetch SP info
      const spDoc = await db
        .collection('users')
        .doc(req.user.uid)
        .get();
      const spData = spDoc.data();

      const newMessage = {
        spId: req.user.uid,
        spName: spData.fullName || spData.name || 'Service Provider',
        spCompany: spData.companyName || spData.businessName || '',
        recipientId,
        recipientName:
          recipientData.fullName || recipientData.name || 'User',
        recipientRole: recipientData.role,
        subject: subject.trim(),
        body: body.trim(),
        status: 'pending_review', // pending_review | delivered | rejected | blocked
        adminNote: '',
        adminReviewedBy: '',
        adminReviewedAt: null,
        hasRecipientReplied: false,
        lastSenderId: req.user.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const docRef = await db
        .collection('sp_outreach_messages')
        .add(newMessage);

      // Notify all admins
      await notifyAdmins(
        NOTIFICATION_TYPES.SP_MESSAGE_PENDING,
        'New SP Outreach Message',
        `${newMessage.spName} sent a message to ${newMessage.recipientName} — pending your review.`,
        null,
        { messageId: docRef.id }
      );

      res.status(201).json({
        success: true,
        message: 'Message submitted for admin review.',
        id: docRef.id,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 3. GET /api/sp-outreach/messages/my-sent
//    Service Provider: see their own sent messages with statuses
// ─────────────────────────────────────────────────────────────
router.get(
  '/messages/my-sent',
  authenticate,
  requireRole('serviceProvider'),
  async (req, res, next) => {
    try {
      const snapshot = await db
        .collection('sp_outreach_messages')
        .where('spId', '==', req.user.uid)
        .get();

      let messages = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Sort newest first
      messages.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      res.json({ success: true, data: messages });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 4. GET /api/sp-outreach/messages/:id/replies
//    Service Provider / Recipient: view replies on a message
// ─────────────────────────────────────────────────────────────
router.get(
  '/messages/:id/replies',
  authenticate,
  requireRole('serviceProvider', 'investor', 'builder'),
  async (req, res, next) => {
    try {
      // Verify ownership (either SP or recipient of the message)
      const msgDoc = await db
        .collection('sp_outreach_messages')
        .doc(req.params.id)
        .get();

      if (!msgDoc.exists) {
        return res.status(404).json({ message: 'Message not found.' });
      }

      const msgData = msgDoc.data();
      if (msgData.spId !== req.user.uid && msgData.recipientId !== req.user.uid) {
        return res.status(403).json({ message: 'Forbidden.' });
      }

      const snapshot = await db
        .collection('sp_outreach_replies')
        .where('messageId', '==', req.params.id)
        .get();

      const replies = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

      res.json({
        success: true,
        message: { id: msgDoc.id, ...msgDoc.data() },
        replies,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 5. GET /api/sp-outreach/admin/messages
//    Admin: list all outreach messages (with filter)
// ─────────────────────────────────────────────────────────────
router.get(
  '/admin/messages',
  authenticate,
  requireRole('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const { status = 'all', page = 1, limit = 25, search = '' } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      let query = db.collection('sp_outreach_messages');

      if (status !== 'all') {
        query = query.where('status', '==', status);
      }

      const snapshot = await query.get();
      let messages = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // In-memory search
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        messages = messages.filter(
          (m) =>
            (m.spName || '').toLowerCase().includes(q) ||
            (m.recipientName || '').toLowerCase().includes(q) ||
            (m.subject || '').toLowerCase().includes(q)
        );
      }

      // Sort newest first
      messages.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const total = messages.length;
      const offset = (pageNum - 1) * limitNum;
      const paginated = messages.slice(offset, offset + limitNum);

      res.json({
        success: true,
        data: paginated,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 6. PATCH /api/sp-outreach/admin/messages/:id/review
//    Admin: accept or reject a pending message
// ─────────────────────────────────────────────────────────────
router.patch(
  '/admin/messages/:id/review',
  authenticate,
  requireRole('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const { action, adminNote = '' } = req.body; // action: 'accept' | 'reject'

      if (!['accept', 'reject'].includes(action)) {
        return res
          .status(400)
          .json({ message: "action must be 'accept' or 'reject'." });
      }

      const msgRef = db.collection('sp_outreach_messages').doc(req.params.id);
      const msgDoc = await msgRef.get();

      if (!msgDoc.exists) {
        return res.status(404).json({ message: 'Message not found.' });
      }

      const msgData = msgDoc.data();

      if (msgData.status !== 'pending_review') {
        return res
          .status(400)
          .json({ message: 'Only pending_review messages can be reviewed.' });
      }

      const newStatus = action === 'accept' ? 'delivered' : 'rejected';

      const adminUserDoc = await db
        .collection('users')
        .doc(req.user.uid)
        .get();
      const adminName =
        adminUserDoc.data()?.fullName ||
        adminUserDoc.data()?.name ||
        'Admin';

      await msgRef.update({
        status: newStatus,
        adminNote: adminNote.trim(),
        adminReviewedBy: adminName,
        adminReviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      if (action === 'accept') {
        // Notify recipient (investor/builder)
        await notifyUser(
          msgData.recipientId,
          NOTIFICATION_TYPES.SP_MESSAGE_RECEIVED,
          'New Message from a Service Provider',
          `You have received a message from ${msgData.spName}: "${msgData.subject}"`,
          null,
          { messageId: req.params.id }
        );
        // Notify SP
        await notifyUser(
          msgData.spId,
          NOTIFICATION_TYPES.SP_MESSAGE_ACCEPTED,
          'Your message was approved & delivered',
          `Your message to ${msgData.recipientName} ("${msgData.subject}") has been approved and delivered.`,
          null,
          { messageId: req.params.id }
        );
      } else {
        // Notify SP of rejection
        await notifyUser(
          msgData.spId,
          NOTIFICATION_TYPES.SP_MESSAGE_REJECTED,
          'Your message was not approved',
          `Your message to ${msgData.recipientName} ("${msgData.subject}") was rejected${adminNote ? `: ${adminNote}` : '.'}`,
          null,
          { messageId: req.params.id }
        );
      }

      res.json({
        success: true,
        message: `Message ${newStatus === 'delivered' ? 'accepted and delivered' : 'rejected'}.`,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 7. GET /api/sp-outreach/admin/messages/:id
//    Admin: full thread detail (message + all replies)
// ─────────────────────────────────────────────────────────────
router.get(
  '/admin/messages/:id',
  authenticate,
  requireRole('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const msgDoc = await db
        .collection('sp_outreach_messages')
        .doc(req.params.id)
        .get();

      if (!msgDoc.exists) {
        return res.status(404).json({ message: 'Message not found.' });
      }

      const repliesSnapshot = await db
        .collection('sp_outreach_replies')
        .where('messageId', '==', req.params.id)
        .get();

      const replies = repliesSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

      res.json({
        success: true,
        message: { id: msgDoc.id, ...msgDoc.data() },
        replies,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 8. GET /api/sp-outreach/inbox
//    Investor / Builder: see messages delivered to them
// ─────────────────────────────────────────────────────────────
router.get(
  '/inbox',
  authenticate,
  requireRole('investor', 'builder'),
  async (req, res, next) => {
    try {
      const snapshot = await db
        .collection('sp_outreach_messages')
        .where('recipientId', '==', req.user.uid)
        .where('status', '==', 'delivered')
        .get();

      const messages = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      res.json({ success: true, data: messages });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 9. POST /api/sp-outreach/messages/:id/reply
//    Investor / Builder: reply to an accepted message
// ─────────────────────────────────────────────────────────────
router.post(
  '/messages/:id/reply',
  authenticate,
  requireRole('investor', 'builder'),
  async (req, res, next) => {
    try {
      const { body } = req.body;

      if (!body || body.trim().length < 5) {
        return res
          .status(400)
          .json({ message: 'Reply must be at least 5 characters.' });
      }

      if (body.trim().length > 3000) {
        return res
          .status(400)
          .json({ message: 'Reply cannot exceed 3000 characters.' });
      }

      const msgRef = db.collection('sp_outreach_messages').doc(req.params.id);
      const msgDoc = await msgRef.get();

      if (!msgDoc.exists) {
        return res.status(404).json({ message: 'Message not found.' });
      }

      const msgData = msgDoc.data();

      if (msgData.recipientId !== req.user.uid) {
        return res.status(403).json({ message: 'Forbidden.' });
      }

      if (msgData.status !== 'delivered') {
        return res
          .status(400)
          .json({ message: 'You can only reply to active, delivered messages.' });
      }

      // Fetch sender info
      const senderDoc = await db
        .collection('users')
        .doc(req.user.uid)
        .get();
      const senderData = senderDoc.data();

      const reply = {
        messageId: req.params.id,
        senderId: req.user.uid,
        senderName: senderData.fullName || senderData.name || 'User',
        senderRole: senderData.role,
        spId: msgData.spId,
        body: body.trim(),
        status: 'delivered',
        createdAt: new Date().toISOString(),
      };

      const replyRef = await db
        .collection('sp_outreach_replies')
        .add(reply);

      // Update parent message state
      await msgRef.update({
        hasRecipientReplied: true,
        lastSenderId: req.user.uid,
        updatedAt: new Date().toISOString(),
      });

      // Notify SP of the reply
      await notifyUser(
        msgData.spId,
        NOTIFICATION_TYPES.SP_REPLY_RECEIVED,
        'You have a new reply',
        `${reply.senderName} replied to your message: "${msgData.subject}"`,
        null,
        { messageId: req.params.id, replyId: replyRef.id }
      );

      // Notify admins for monitoring
      await notifyAdmins(
        NOTIFICATION_TYPES.SP_REPLY_RECEIVED,
        'SP Outreach Reply Received',
        `${reply.senderName} replied to an SP outreach message ("${msgData.subject}").`,
        null,
        { messageId: req.params.id, replyId: replyRef.id }
      );

      res.status(201).json({ success: true, message: 'Reply sent.', id: replyRef.id });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 10. POST /api/sp-outreach/messages/:id/sp-reply
//     Service Provider: reply back to recipient in established loop
// ─────────────────────────────────────────────────────────────
router.post(
  '/messages/:id/sp-reply',
  authenticate,
  requireRole('serviceProvider'),
  async (req, res, next) => {
    try {
      const { body } = req.body;

      if (!body || body.trim().length < 5) {
        return res
          .status(400)
          .json({ message: 'Reply must be at least 5 characters.' });
      }

      if (body.trim().length > 3000) {
        return res
          .status(400)
          .json({ message: 'Reply cannot exceed 3000 characters.' });
      }

      const msgRef = db.collection('sp_outreach_messages').doc(req.params.id);
      const msgDoc = await msgRef.get();

      if (!msgDoc.exists) {
        return res.status(404).json({ message: 'Message not found.' });
      }

      const msgData = msgDoc.data();

      if (msgData.spId !== req.user.uid) {
        return res.status(403).json({ message: 'Forbidden.' });
      }

      if (msgData.status !== 'delivered') {
        return res
          .status(400)
          .json({ message: 'This conversation is not active.' });
      }

      if (!msgData.hasRecipientReplied) {
        return res
          .status(400)
          .json({ message: 'You cannot reply yet. The recipient has not responded to your outreach.' });
      }

      // Fetch SP info
      const spDoc = await db
        .collection('users')
        .doc(req.user.uid)
        .get();
      const spData = spDoc.data();

      const reply = {
        messageId: req.params.id,
        senderId: req.user.uid,
        senderName: spData.fullName || spData.name || 'Service Provider',
        senderRole: 'serviceProvider',
        spId: req.user.uid,
        body: body.trim(),
        status: 'delivered',
        createdAt: new Date().toISOString(),
      };

      const replyRef = await db
        .collection('sp_outreach_replies')
        .add(reply);

      // Update parent message state
      await msgRef.update({
        lastSenderId: req.user.uid,
        updatedAt: new Date().toISOString(),
      });

      // Notify recipient (investor/builder)
      await notifyUser(
        msgData.recipientId,
        NOTIFICATION_TYPES.SP_MESSAGE_RECEIVED,
        'New reply from Service Provider',
        `${reply.senderName} replied to your thread: "${msgData.subject}"`,
        null,
        { messageId: req.params.id, replyId: replyRef.id }
      );

      // Notify admins for monitoring
      await notifyAdmins(
        NOTIFICATION_TYPES.SP_REPLY_RECEIVED,
        'SP Response Sent',
        `Service Provider ${reply.senderName} replied to recipient ${msgData.recipientName} in thread "${msgData.subject}".`,
        null,
        { messageId: req.params.id, replyId: replyRef.id }
      );

      res.status(201).json({ success: true, message: 'Reply sent.', id: replyRef.id });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 11. PATCH /api/sp-outreach/admin/messages/:id/block
//     Admin: stop/block or unblock an outreach conversation
// ─────────────────────────────────────────────────────────────
router.patch(
  '/admin/messages/:id/block',
  authenticate,
  requireRole('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const { block, reason } = req.body;

      if (block && (!reason || !reason.trim())) {
        return res
          .status(400)
          .json({ message: 'A reason is required to block a conversation.' });
      }

      const msgRef = db.collection('sp_outreach_messages').doc(req.params.id);
      const msgDoc = await msgRef.get();

      if (!msgDoc.exists) {
        return res.status(404).json({ message: 'Conversation not found.' });
      }

      const msgData = msgDoc.data();
      const newStatus = block ? 'blocked' : 'delivered';

      const adminUserDoc = await db
        .collection('users')
        .doc(req.user.uid)
        .get();
      const adminName =
        adminUserDoc.data()?.fullName ||
        adminUserDoc.data()?.name ||
        'Admin';

      await msgRef.update({
        status: newStatus,
        adminNote: block ? reason.trim() : '',
        adminReviewedBy: adminName,
        adminReviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Notify both parties
      const title = block ? 'Conversation Blocked by Admin' : 'Conversation Reactivated';
      const msgText = block
        ? `Your conversation regarding "${msgData.subject}" has been stopped by admin. Reason: ${reason}`
        : `Your conversation regarding "${msgData.subject}" has been reactivated.`;

      await Promise.all([
        notifyUser(msgData.spId, NOTIFICATION_TYPES.STATUS_CHANGED, title, msgText, null, { messageId: req.params.id }),
        notifyUser(msgData.recipientId, NOTIFICATION_TYPES.STATUS_CHANGED, title, msgText, null, { messageId: req.params.id })
      ]);

      res.json({
        success: true,
        message: `Conversation status updated to ${newStatus}.`,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
