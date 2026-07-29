const paymentService = require('./PaymentService');
const { logPaymentAudit, PAYMENT_AUDIT_ACTIONS } = require('../utils/paymentAudit');

class WebhookService {
  /**
   * Main entry point for webhook events
   */
  async handleWebhook(event, req = null) {
    const paymentIntent = event.data.object;
    const stripePaymentIntentId = paymentIntent.id;

    console.log(`[WebhookService] Processing Stripe webhook event "${event.type}" for intent ${stripePaymentIntentId}`);

    // Audit the webhook raw event
    await logPaymentAudit({
      paymentId: stripePaymentIntentId, // fallback as payment ID might not exist yet in local DB if webhook comes extremely fast
      action: PAYMENT_AUDIT_ACTIONS.WEBHOOK_RECEIVED,
      newValue: { eventType: event.type },
      details: `Received Stripe Webhook: ${event.type}`,
      req
    });

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.paymentSucceeded(stripePaymentIntentId, paymentIntent, req);
        break;
      case 'payment_intent.payment_failed':
        await this.paymentFailed(stripePaymentIntentId, paymentIntent, req);
        break;
      case 'charge.refunded':
        await this.refundCreated(stripePaymentIntentId, paymentIntent, req);
        break;
      default:
        console.log(`[WebhookService] Unhandled webhook event type: ${event.type}`);
        break;
    }
  }

  /**
   * Action when payment is marked succeeded in gateway
   */
  async paymentSucceeded(stripePaymentIntentId, stripeIntent, req = null) {
    try {
      // confirmPayment maps and verifies amounts automatically, handles callback hook
      const payment = await paymentService.confirmPayment(null, stripePaymentIntentId, req);
      console.log(`[WebhookService] Webhook: Payment succeeded & verified: ${payment.paymentNumber}`);

      // Increment coupon usedCount if a coupon was applied to this campaign (deferred from booking time)
      try {
        const { getDb } = require('../firebase');
        const db = getDb();

        // Find the campaign linked to this payment's referenceId
        const referenceId = payment.referenceId || payment.metadata?.campaignId;
        if (referenceId) {
          const campaignDoc = await db.collection('advertisement_campaigns').doc(referenceId).get();
          if (campaignDoc.exists) {
            const campaign = campaignDoc.data();
            if (campaign.couponApplied && campaign.couponApplied.id && campaign.finalCost > 0) {
              const couponRef = db.collection('coupons').doc(campaign.couponApplied.id);
              const couponDoc = await couponRef.get();
              if (couponDoc.exists) {
                const c = couponDoc.data();
                await couponRef.update({
                  usedCount: (c.usedCount || 0) + 1,
                  updatedAt: new Date().toISOString()
                });
                console.log(`[WebhookService] Coupon ${campaign.couponApplied.code} usedCount incremented after payment.`);
              }
            }
          }
        }
      } catch (couponErr) {
        console.error('[WebhookService] Failed to increment coupon usedCount after payment:', couponErr.message);
      }

    } catch (err) {
      console.error(`[WebhookService] Error confirming payment on webhook:`, err.message);
    }
  }

  /**
   * Action when payment fails in gateway
   */
  async paymentFailed(stripePaymentIntentId, stripeIntent, req = null) {
    try {
      const payment = await paymentService.repository.getByPaymentIntentId(stripePaymentIntentId);
      if (payment) {
        const failureReason = stripeIntent.last_payment_error
          ? stripeIntent.last_payment_error.message
          : 'Card declined / Payment failed';

        await paymentService.updatePaymentStatus(
          payment.id,
          'FAILED',
          `Stripe payment failed: ${failureReason}`,
          req
        );
        console.log(`[WebhookService] Webhook: Payment marked as FAILED for payment ${payment.paymentNumber}`);
      }
    } catch (err) {
      console.error(`[WebhookService] Error handling payment failure webhook:`, err.message);
    }
  }

  /**
   * Hook for Refund events
   */
  async refundCreated(stripePaymentIntentId, stripeCharge, req = null) {
    try {
      const payment = await paymentService.repository.getByPaymentIntentId(stripePaymentIntentId);
      if (payment) {
        await paymentService.updatePaymentStatus(
          payment.id,
          'REFUNDED',
          'Webhook refund event processed.',
          req
        );
        console.log(`[WebhookService] Webhook: Payment marked as REFUNDED for payment ${payment.paymentNumber}`);
      }
    } catch (err) {
      console.error(`[WebhookService] Error handling refund webhook:`, err.message);
    }
  }

  /**
   * Hook for dispute events
   */
  async disputeCreated(event, req = null) {
    console.log('[WebhookService] Dispute webhook triggered (future-ready stub)');
  }
}

module.exports = new WebhookService();
