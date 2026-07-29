/**
 * Abstract Payment Gateway Interface
 */
class PaymentGateway {
  /**
   * Create a Payment Intent
   * @param {number} amount - Amount in decimal units (e.g. 10.50)
   * @param {string} currency - 3-letter currency code (e.g. 'usd')
   * @param {object} metadata - Key-value pair metadata
   * @param {string} [customerId] - Gateway Customer ID
   * @returns {Promise<object>} Payment Intent Details
   */
  async createPaymentIntent(amount, currency, metadata, customerId) {
    throw new Error('Method "createPaymentIntent" must be implemented');
  }

  /**
   * Retrieve a Payment Intent details
   * @param {string} id - Gateway Payment Intent ID
   * @returns {Promise<object>} Payment Intent Details
   */
  async retrievePaymentIntent(id) {
    throw new Error('Method "retrievePaymentIntent" must be implemented');
  }

  /**
   * Cancel a Payment Intent
   * @param {string} id - Gateway Payment Intent ID
   * @returns {Promise<object>} Cancelled Payment Intent Details
   */
  async cancelPaymentIntent(id) {
    throw new Error('Method "cancelPaymentIntent" must be implemented');
  }

  /**
   * Create a Customer in the Gateway
   * @param {string} email - Customer email
   * @param {string} name - Customer name
   * @param {object} metadata - Key-value metadata
   * @returns {Promise<object>} Customer details
   */
  async createCustomer(email, name, metadata) {
    throw new Error('Method "createCustomer" must be implemented');
  }

  /**
   * Retrieve Customer details from the Gateway
   * @param {string} id - Gateway Customer ID
   * @returns {Promise<object>} Customer details
   */
  async retrieveCustomer(id) {
    throw new Error('Method "retrieveCustomer" must be implemented');
  }
}

module.exports = PaymentGateway;
