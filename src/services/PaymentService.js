const StripeGateway = require('../gateways/StripeGateway');
const PaymentRepository = require('../repositories/PaymentRepository');
const { CreatePaymentSchema, ConfirmPaymentSchema } = require('../models/payment');
const { logPaymentAudit, PAYMENT_AUDIT_ACTIONS } = require('../utils/paymentAudit');
const { getDb } = require('../firebase');

class PaymentService {
  constructor(gateway = new StripeGateway(), repository = PaymentRepository) {
    this.gateway = gateway;
    this.repository = repository;
  }

  /**
   * Helper to format generic payment response DTO
   */
  _mapToPaymentResponse(payment) {
    return {
      paymentId: payment.id,
      paymentNumber: payment.paymentNumber,
      clientSecret: payment.clientSecret || null,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      paymentPurpose: payment.paymentPurpose,
      referenceType: payment.referenceType,
      referenceId: payment.referenceId
    };
  }

  /**
   * Create a centralized payment intent record
   */
  async createPayment(data, req = null) {
    // 1. Validate inputs
    const parsed = CreatePaymentSchema.parse(data);
    const { userId, amount, currency, paymentPurpose, referenceType, referenceId, metadata } = parsed;

    // 2. Prevent duplicate payment creation for an active item
    const existingPayments = await this.repository.getByReference(referenceType, referenceId);
    const activePayment = existingPayments.find(p => ['SUCCEEDED', 'PENDING', 'PROCESSING'].includes(p.status));
    
    if (activePayment) {
      if (activePayment.status === 'SUCCEEDED') {
        throw new Error(`Payment for reference ${referenceType}:${referenceId} has already succeeded.`);
      }
      // If payment is pending/processing, return the existing clientSecret for the frontend to resume
      return this._mapToPaymentResponse(activePayment);
    }

    // 3. Resolve or Create Gateway Customer
    const db = getDb();
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    // If user doc doesn't exist yet (e.g., registration still in progress), proceed without Stripe customer
    const userData = userDoc.exists ? userDoc.data() : {};
    let customerId = userData.stripeCustomerId || null;

    if (!customerId) {
      const email = userData.email || `user-${userId}@investate.com`;
      const name = userData.fullName || userData.companyName || 'Investate Customer';
      try {
        const customer = await this.gateway.createCustomer(email, name, { userId });
        customerId = customer.id;
        // Use set+merge so it works even if the user doc doesn't exist yet
        await userRef.set({ stripeCustomerId: customerId, updatedAt: new Date().toISOString() }, { merge: true });
      } catch (custErr) {
        console.error('[PaymentService] Failed to create gateway customer:', custErr.message);
        // Fallback: Proceed without customer mapping if it fails
      }
    }

    // 4. Create Gateway Payment Intent
    const gatewayIntent = await this.gateway.createPaymentIntent(
      amount,
      currency,
      {
        userId,
        paymentPurpose,
        referenceType,
        referenceId,
        ...metadata
      },
      customerId
    );

    // 5. Save payment record in DB
    const paymentRecord = {
      stripePaymentIntentId: gatewayIntent.id,
      stripeChargeId: gatewayIntent.chargeId || null,
      stripeCustomerId: customerId,
      userId,
      amount,
      currency: currency.toLowerCase(),
      paymentPurpose,
      referenceType,
      referenceId,
      status: gatewayIntent.status,
      paymentMethod: 'card',
      transactionType: 'CHARGE',
      gateway: 'STRIPE',
      receiptUrl: gatewayIntent.receiptUrl || null,
      invoiceUrl: null,
      failureReason: null,
      metadata: metadata || {},
      clientSecret: gatewayIntent.clientSecret,
      createdBy: userId
    };

    const saved = await this.repository.create(paymentRecord);

    // 6. Transaction Logging
    await logPaymentAudit({
      paymentId: saved.id,
      action: PAYMENT_AUDIT_ACTIONS.PAYMENT_CREATED,
      performedBy: userId,
      performedByRole: userData.role || 'user',
      newValue: { status: saved.status, amount: saved.amount },
      details: `Payment record created for purpose: ${paymentPurpose}`,
      req
    });

    await logPaymentAudit({
      paymentId: saved.id,
      action: PAYMENT_AUDIT_ACTIONS.PAYMENT_INTENT_CREATED,
      performedBy: userId,
      performedByRole: userData.role || 'user',
      newValue: { stripePaymentIntentId: gatewayIntent.id },
      details: `Stripe Payment Intent created: ${gatewayIntent.id}`,
      req
    });

    return this._mapToPaymentResponse(saved);
  }

  /**
   * Confirm payment status from Stripe (Verifies & completes payment on backend)
   */
  async confirmPayment(paymentId, stripePaymentIntentId, req = null) {
    let payment = null;
    
    // Find payment record
    if (paymentId) {
      payment = await this.repository.getById(paymentId);
    } else if (stripePaymentIntentId) {
      payment = await this.repository.getByPaymentIntentId(stripePaymentIntentId);
    }

    if (!payment) {
      throw new Error(`Payment record not found for paymentId: ${paymentId} or intent: ${stripePaymentIntentId}`);
    }

    if (payment.status === 'SUCCEEDED') {
      return this._mapToPaymentResponse(payment);
    }

    const intentId = stripePaymentIntentId || payment.stripePaymentIntentId;
    
    // 1. Retrieve the latest status from Gateway
    const gatewayIntent = await this.gateway.retrievePaymentIntent(intentId);

    // 2. Security validation: check amount to prevent tampering
    if (Math.round(payment.amount * 100) !== Math.round(gatewayIntent.amount * 100)) {
      await logPaymentAudit({
        paymentId: payment.id,
        action: PAYMENT_AUDIT_ACTIONS.PAYMENT_FAILED,
        newValue: { status: 'FAILED', reason: 'Amount mismatch / tampering detected' },
        details: `Tampering Check Failed: expected ${payment.amount}, gateway returned ${gatewayIntent.amount}`,
        req
      });
      throw new Error('Security Error: Payment amount mismatch detected.');
    }

    // 3. Update payment status in local repository
    const statusBefore = payment.status;
    const updateData = {
      status: gatewayIntent.status,
      stripeChargeId: gatewayIntent.chargeId || payment.stripeChargeId || null,
      receiptUrl: gatewayIntent.receiptUrl || payment.receiptUrl || null
    };

    const updated = await this.repository.update(payment.id, updateData);

    // 4. Write audit log
    if (updated.status === 'SUCCEEDED') {
      await logPaymentAudit({
        paymentId: payment.id,
        action: PAYMENT_AUDIT_ACTIONS.PAYMENT_CONFIRMED,
        oldValue: { status: statusBefore },
        newValue: { status: updated.status, chargeId: updated.stripeChargeId },
        details: `Payment confirmed successfully. Charge: ${updated.stripeChargeId}`,
        req
      });

      // 5. Trigger post-payment success hook
      await this._handleReferenceCallback(updated);
    } else {
      await logPaymentAudit({
        paymentId: payment.id,
        action: PAYMENT_AUDIT_ACTIONS.PAYMENT_FAILED,
        oldValue: { status: statusBefore },
        newValue: { status: updated.status },
        details: `Gateway reported payment status: ${gatewayIntent.stripeStatus}`,
        req
      });
    }

    return this._mapToPaymentResponse(updated);
  }

  /**
   * Retrieve single payment details
   */
  async getPayment(id) {
    const payment = await this.repository.getById(id);
    if (!payment) return null;
    return payment;
  }

  /**
   * Fetch payments history with filters & pagination
   */
  async getPayments(filters) {
    return await this.repository.find(filters);
  }

  /**
   * Get payments filtered by user
   */
  async getPaymentsByUser(userId, pagination = { page: 1, limit: 10 }) {
    return await this.repository.find({ userId, ...pagination });
  }

  /**
   * Get payments filtered by reference
   */
  async getPaymentsByReference(referenceType, referenceId) {
    return await this.repository.getByReference(referenceType, referenceId);
  }

  /**
   * Verify status of a payment (pulls from gateway)
   */
  async verifyPayment(paymentId) {
    const payment = await this.repository.getById(paymentId);
    if (!payment) throw new Error('Payment not found');
    
    const gatewayIntent = await this.gateway.retrievePaymentIntent(payment.stripePaymentIntentId);
    if (gatewayIntent.status !== payment.status) {
      return await this.repository.update(paymentId, { status: gatewayIntent.status });
    }
    return payment;
  }

  /**
   * Cancel pending payment
   */
  async cancelPayment(paymentId, req = null) {
    const payment = await this.repository.getById(paymentId);
    if (!payment) throw new Error('Payment not found');
    if (payment.status !== 'PENDING' && payment.status !== 'CREATED') {
      throw new Error(`Cannot cancel payment with status: ${payment.status}`);
    }

    const cancelledIntent = await this.gateway.cancelPaymentIntent(payment.stripePaymentIntentId);
    const updated = await this.repository.update(paymentId, { status: 'CANCELLED' });

    await logPaymentAudit({
      paymentId: payment.id,
      action: PAYMENT_AUDIT_ACTIONS.PAYMENT_CANCELLED,
      oldValue: { status: payment.status },
      newValue: { status: 'CANCELLED' },
      details: 'Payment intent cancelled by user/system',
      req
    });

    return this._mapToPaymentResponse(updated);
  }

  /**
   * Retry a failed payment (re-creates payment intent for references that failed)
   */
  async retryPayment(paymentId, req = null) {
    const payment = await this.repository.getById(paymentId);
    if (!payment) throw new Error('Payment not found');
    if (payment.status !== 'FAILED' && payment.status !== 'CANCELLED') {
      throw new Error(`Payment is in status ${payment.status} and does not need retry.`);
    }

    // Re-create payment with the same parameters
    return await this.createPayment({
      userId: payment.userId,
      amount: payment.amount,
      currency: payment.currency,
      paymentPurpose: payment.paymentPurpose,
      referenceType: payment.referenceType,
      referenceId: payment.referenceId,
      metadata: payment.metadata
    }, req);
  }

  /**
   * Update payment status directly (for Admin adjustments or direct webhooks)
   */
  async updatePaymentStatus(paymentId, status, details = '', req = null) {
    const payment = await this.repository.getById(paymentId);
    if (!payment) throw new Error('Payment not found');

    const statusBefore = payment.status;
    const updated = await this.repository.update(paymentId, { status });

    await logPaymentAudit({
      paymentId: payment.id,
      action: PAYMENT_AUDIT_ACTIONS.PAYMENT_CONFIRMED, // generic update
      oldValue: { status: statusBefore },
      newValue: { status },
      details: `Direct payment status update: ${details}`,
      req
    });

    if (status === 'SUCCEEDED' && statusBefore !== 'SUCCEEDED') {
      await this._handleReferenceCallback(updated);
    }

    return updated;
  }

  /**
   * Refund payment (Future-ready stub)
   */
  async refundPayment(paymentId) {
    throw new Error('Refund method is future-ready and not implemented currently.');
  }

  /**
   * Central Callback Router: Activates features upon payment success
   */
  async _handleReferenceCallback(payment) {
    try {
      const db = getDb();
      const now = new Date().toISOString();

      switch (payment.referenceType) {
        case 'MEMBERSHIP': {
          // referenceId is the userId (potentially suffixed with _year or _timestamp)
          const userId = payment.referenceId.split('_')[0];
          const userRef = db.collection('users').doc(userId);
          const userDoc = await userRef.get();

          if (userDoc.exists) {
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);

            await userRef.update({
              membershipStatus: 'active',
              membershipExpiry: expiryDate.toISOString(),
              membershipPaidAt: now,
              membershipAmount: payment.amount,
              membershipCurrency: 'usd',
              updatedAt: now
            });
            console.log(`[PaymentService Hook] Membership activated for user: ${userId} — expires ${expiryDate.toISOString()}`);
          }
          break;
        }

        case 'ADVERTISEMENT': {
          const campaignId = payment.referenceId;
          const campaignRef = db.collection('advertisement_campaigns').doc(campaignId);
          const campaignDoc = await campaignRef.get();
          
          if (campaignDoc.exists) {
            await campaignRef.update({
              paymentStatus: 'paid',
              approvalStatus: 'pending_review',
              updatedAt: now
            });
            console.log(`[PaymentService Hook] Activated ADVERTISEMENT campaign: ${campaignId}`);

            // Notify admins of new PAID booking
            try {
              const { notifyAdmins } = require('../utils/notificationHelper');
              await notifyAdmins(
                'NEW_AD_BOOKING',
                'New Advertisement Campaign Booked & Paid',
                `A new advertisement campaign has been booked for zone ${campaignDoc.data().zoneId} by user ID ${payment.userId} and payment was confirmed. Awaiting approval.`,
                null,
                { campaignId }
              );
            } catch (notifErr) {
              console.error('[PaymentService Hook] Admin notification failed:', notifErr.message);
            }
          }
          break;
        }

        case 'USER_REGISTRATION':
        case 'BUILDER_REGISTRATION':
        case 'INVESTOR_REGISTRATION': {
          const userId = payment.referenceId;
          const userRef = db.collection('users').doc(userId);
          const userDoc = await userRef.get();
          
          if (userDoc.exists) {
            await userRef.update({
              onboardingStatus: 'payment_complete',
              isVerified: true,
              updatedAt: now
            });
            console.log(`[PaymentService Hook] Activated Registration for user: ${userId}`);
          }
          break;
        }

        default:
          console.log(`[PaymentService Hook] No handler configured for referenceType: ${payment.referenceType}`);
          break;
      }
    } catch (err) {
      console.error(`[PaymentService Hook] Failed to execute callback for payment ${payment.id}:`, err.message);
      // We don't crash the confirmPayment call, but log the error
    }
  }
}

module.exports = new PaymentService();
