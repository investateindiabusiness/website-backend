const { getDb } = require('../firebase');

/**
 * Payment Audit Actions
 */
const PAYMENT_AUDIT_ACTIONS = {
  PAYMENT_CREATED: 'PAYMENT_CREATED',
  PAYMENT_INTENT_CREATED: 'PAYMENT_INTENT_CREATED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  WEBHOOK_RECEIVED: 'WEBHOOK_RECEIVED'
};

/**
 * Log a payment audit trail entry
 */
const logPaymentAudit = async ({
  paymentId,
  action,
  performedBy = 'system',
  performedByRole = 'system',
  oldValue = null,
  newValue = null,
  details = '',
  req = null
}) => {
  try {
    const db = getDb();
    
    // IP Extraction
    const ipAddress =
      (req && (req.headers['x-forwarded-for'] || req.socket?.remoteAddress)) ||
      'unknown';

    await db.collection('payment_audit_logs').add({
      paymentId,
      action,
      performedBy,
      performedByRole,
      oldValue,
      newValue,
      details,
      ipAddress,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    // Avoid blocking execution if auditing fails
    console.error('[PaymentAudit] Failed to write audit log:', err.message);
  }
};

module.exports = {
  logPaymentAudit,
  PAYMENT_AUDIT_ACTIONS
};
