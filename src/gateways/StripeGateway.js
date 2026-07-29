const PaymentGateway = require('./PaymentGateway');
const stripe = require('stripe');

class StripeGateway extends PaymentGateway {
  constructor() {
    super();
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is missing from environment variables.');
    }
    this.stripeClient = stripe(process.env.STRIPE_SECRET_KEY);
  }

  /**
   * Map Stripe status string to local PAYMENT_STATUS
   */
  _mapStripeStatus(stripeStatus) {
    switch (stripeStatus) {
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':
        return 'PENDING';
      case 'processing':
        return 'PROCESSING';
      case 'succeeded':
        return 'SUCCEEDED';
      case 'requires_capture':
        return 'SUCCEEDED'; // Captured automatically in automatic mode
      case 'canceled':
        return 'CANCELLED';
      default:
        return 'FAILED';
    }
  }

  /**
   * Create Stripe Payment Intent
   */
  async createPaymentIntent(amount, currency, metadata, customerId) {
    const params = {
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      payment_method_types: (process.env.STRIPE_PAYMENT_METHOD_TYPES || 'card').split(','),
      capture_method: process.env.STRIPE_CAPTURE_METHOD || 'automatic',
      confirmation_method: process.env.STRIPE_CONFIRMATION_METHOD || 'automatic',
      metadata: metadata || {}
    };

    if (customerId) {
      params.customer = customerId;
    }

    const intent = await this.stripeClient.paymentIntents.create(params);
    
    const charge = intent.charges && intent.charges.data && intent.charges.data[0];
    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      amount: intent.amount / 100,
      currency: intent.currency,
      status: this._mapStripeStatus(intent.status),
      stripeStatus: intent.status,
      receiptUrl: charge ? charge.receipt_url : null,
      chargeId: intent.latest_charge || (charge ? charge.id : null),
      raw: intent
    };
  }

  /**
   * Retrieve Stripe Payment Intent Details
   */
  async retrievePaymentIntent(id) {
    const intent = await this.stripeClient.paymentIntents.retrieve(id);
    const charge = intent.charges && intent.charges.data && intent.charges.data[0];
    
    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      amount: intent.amount / 100,
      currency: intent.currency,
      status: this._mapStripeStatus(intent.status),
      stripeStatus: intent.status,
      receiptUrl: charge ? charge.receipt_url : null,
      chargeId: intent.latest_charge || (charge ? charge.id : null),
      raw: intent
    };
  }

  /**
   * Cancel Stripe Payment Intent
   */
  async cancelPaymentIntent(id) {
    const intent = await this.stripeClient.paymentIntents.cancel(id);
    return {
      id: intent.id,
      status: this._mapStripeStatus(intent.status),
      stripeStatus: intent.status,
      raw: intent
    };
  }

  /**
   * Create Customer in Stripe
   */
  async createCustomer(email, name, metadata) {
    const customer = await this.stripeClient.customers.create({
      email,
      name,
      metadata: metadata || {}
    });
    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      raw: customer
    };
  }

  /**
   * Retrieve Customer Details from Stripe
   */
  async retrieveCustomer(id) {
    const customer = await this.stripeClient.customers.retrieve(id);
    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      raw: customer
    };
  }
}

module.exports = StripeGateway;
