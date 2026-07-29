const express = require('express');
const stripe = require('stripe');
const { authenticate } = require('./auth');
const { requireRole, ROLES } = require('../middleware/rbac');
const paymentService = require('../services/PaymentService');
const webhookService = require('../services/WebhookService');
const { CreatePaymentSchema, ConfirmPaymentSchema, PaymentHistoryFilterSchema } = require('../models/payment');

const router = express.Router();

/**
 * Helper to wrap route handlers in try/catch block
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * @swagger
 * /api/payments:
 *   post:
 *     summary: Create a Stripe Payment Intent and local payment record
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - paymentPurpose
 *               - referenceType
 *               - referenceId
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 99.99
 *               currency:
 *                 type: string
 *                 example: usd
 *               paymentPurpose:
 *                 type: string
 *                 example: ADVERTISEMENT
 *               referenceType:
 *                 type: string
 *                 example: ADVERTISEMENT
 *               referenceId:
 *                 type: string
 *                 example: campaign_slot_123
 *               metadata:
 *                 type: object
 *                 example: { "campaignName": "Spring Sale Banner" }
 *     responses:
 *       201:
 *         description: Payment Intent created successfully
 *       400:
 *         description: Validation failed or duplicate active payment exists
 */
router.post('/', authenticate, requireRole(...ROLES.ANY_USER), asyncHandler(async (req, res) => {
  // Bind the authenticated user to the payment creation
  const payload = {
    ...req.body,
    userId: req.user.uid
  };

  const paymentResponse = await paymentService.createPayment(payload, req);
  res.status(201).json({
    success: true,
    data: paymentResponse
  });
}));

/**
 * @swagger
 * /api/payments/confirm:
 *   post:
 *     summary: Confirm backend state after payment success on frontend
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stripePaymentIntentId
 *             properties:
 *               paymentId:
 *                 type: string
 *               stripePaymentIntentId:
 *                 type: string
 *                 example: pi_3N12345...
 *     responses:
 *       200:
 *         description: Payment confirmed and callback processed
 *       400:
 *         description: Validation or verification failed (e.g. amount mismatch)
 */
router.post('/confirm', authenticate, requireRole(...ROLES.ANY_USER), asyncHandler(async (req, res) => {
  const parsed = ConfirmPaymentSchema.parse(req.body);
  const { paymentId, stripePaymentIntentId } = parsed;

  const paymentResponse = await paymentService.confirmPayment(paymentId, stripePaymentIntentId, req);
  res.status(200).json({
    success: true,
    data: paymentResponse
  });
}));

/**
 * @swagger
 * /api/payments/history:
 *   get:
 *     summary: Retrieve history of payments
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema:
 *           type: integer
 *           default: 1
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 10
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *       - name: paymentPurpose
 *         in: query
 *         schema:
 *           type: string
 *       - name: referenceType
 *         in: query
 *         schema:
 *           type: string
 *       - name: referenceId
 *         in: query
 *         schema:
 *           type: string
 *       - name: startDate
 *         in: query
 *         schema:
 *           type: string
 *       - name: endDate
 *         in: query
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of payments with pagination details
 */
router.get('/history', authenticate, requireRole(...ROLES.ANY_USER), asyncHandler(async (req, res) => {
  // Parse query parameters using the validator schema
  const filters = PaymentHistoryFilterSchema.parse(req.query);

  // Security: Non-admins can only see their own payment history
  const isAdmin = ROLES.ADMIN_PLUS.includes(req.userRole);
  if (!isAdmin) {
    filters.userId = req.user.uid;
  }

  const result = await paymentService.getPayments(filters);
  res.status(200).json({
    success: true,
    ...result
  });
}));

/**
 * @swagger
 * /api/payments/{id}:
 *   get:
 *     summary: Get details of a single payment record
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment details returned
 *       403:
 *         description: Forbidden (insufficient roles to see another user's record)
 *       404:
 *         description: Payment not found
 */
router.get('/:id', authenticate, requireRole(...ROLES.ANY_USER), asyncHandler(async (req, res) => {
  const payment = await paymentService.getPayment(req.params.id);
  if (!payment) {
    return res.status(404).json({ success: false, message: 'Payment not found.' });
  }

  // Security check: only owners or admins can see this document
  const isAdmin = ROLES.ADMIN_PLUS.includes(req.userRole);
  if (!isAdmin && payment.userId !== req.user.uid) {
    return res.status(403).json({ success: false, message: 'Forbidden: Access to this resource is denied.' });
  }

  res.status(200).json({
    success: true,
    data: payment
  });
}));

/**
 * @swagger
 * /api/payments/{id}/cancel:
 *   post:
 *     summary: Cancel a pending payment
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment successfully cancelled
 */
router.post('/:id/cancel', authenticate, requireRole(...ROLES.ANY_USER), asyncHandler(async (req, res) => {
  const payment = await paymentService.getPayment(req.params.id);
  if (!payment) {
    return res.status(404).json({ success: false, message: 'Payment not found.' });
  }

  const isAdmin = ROLES.ADMIN_PLUS.includes(req.userRole);
  if (!isAdmin && payment.userId !== req.user.uid) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const paymentResponse = await paymentService.cancelPayment(payment.id, req);
  res.status(200).json({
    success: true,
    data: paymentResponse
  });
}));

/**
 * @swagger
 * /api/payments/{id}/retry:
 *   post:
 *     summary: Retry a failed or cancelled payment
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: New Payment Intent generated for retry
 */
router.post('/:id/retry', authenticate, requireRole(...ROLES.ANY_USER), asyncHandler(async (req, res) => {
  const payment = await paymentService.getPayment(req.params.id);
  if (!payment) {
    return res.status(404).json({ success: false, message: 'Payment not found.' });
  }

  const isAdmin = ROLES.ADMIN_PLUS.includes(req.userRole);
  if (!isAdmin && payment.userId !== req.user.uid) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const paymentResponse = await paymentService.retryPayment(payment.id, req);
  res.status(201).json({
    success: true,
    data: paymentResponse
  });
}));

/**
 * Public Stripe Webhook Endpoint (does not require authentication middleware)
 */
router.post('/webhook', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;

  if (process.env.STRIPE_WEBHOOK_SECRET && signature) {
    try {
      // Re-construct event securely using raw body buffer and signing secret
      const stripeClient = new stripe(process.env.STRIPE_SECRET_KEY);
      event = stripeClient.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error(`[Webhook] Signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Development fallback (only if webhook secret is not set)
    console.warn('[Webhook] Signature verification skipped (STRIPE_WEBHOOK_SECRET not set)');
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }

  // Handle event in WebhookService
  await webhookService.handleWebhook(event, req);

  res.status(200).json({ received: true });
}));

module.exports = router;
