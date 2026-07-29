const { z } = require('zod');

/**
 * Standard Payment Statuses
 */
const PAYMENT_STATUS = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED'
};

/**
 * Supported Gateways
 */
const PAYMENT_GATEWAY = {
  STRIPE: 'STRIPE'
};

/**
 * Standard Transaction Types
 */
const TRANSACTION_TYPE = {
  CHARGE: 'CHARGE'
};

/**
 * Validation schema for creating a payment intent
 */
const CreatePaymentSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  amount: z.number().positive('Amount must be greater than zero'),
  currency: z.string().min(3).max(3).default('usd'),
  paymentPurpose: z.string().min(1, 'Payment purpose is required'),
  referenceType: z.string().min(1, 'Reference type is required'),
  referenceId: z.string().min(1, 'Reference ID is required'),
  metadata: z.record(z.any()).optional().default({})
});

/**
 * Validation schema for confirming payment on the server
 */
const ConfirmPaymentSchema = z.object({
  paymentId: z.string().optional(),
  stripePaymentIntentId: z.string().min(1, 'Stripe Payment Intent ID is required')
});

/**
 * Validation schema for querying/filtering payments
 */
const PaymentHistoryFilterSchema = z.object({
  userId: z.string().optional(),
  status: z.nativeEnum(PAYMENT_STATUS).optional(),
  paymentPurpose: z.string().optional(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  startDate: z.string().datetime({ precision: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  endDate: z.string().datetime({ precision: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  limit: z.preprocess((val) => parseInt(val, 10), z.number().int().positive()).optional().default(10),
  page: z.preprocess((val) => parseInt(val, 10), z.number().int().positive()).optional().default(1),
  sortBy: z.string().optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

module.exports = {
  PAYMENT_STATUS,
  PAYMENT_GATEWAY,
  TRANSACTION_TYPE,
  CreatePaymentSchema,
  ConfirmPaymentSchema,
  PaymentHistoryFilterSchema
};
