/**
 * Application-wide configuration parameters
 */
module.exports = {
  // Website/product launch date.
  // Format: YYYY-MM-DD
  // Free trial premium membership is available for 1 year from this date.
  PRODUCT_LAUNCH_DATE: process.env.PRODUCT_LAUNCH_DATE || "2026-06-29",

  // Coupon configuration
  // Maximum number of users who can receive the launch coupon automatically
  COUPON_USER_LIMIT: parseInt(process.env.COUPON_USER_LIMIT || "100", 10),

  // Number of days after product launch date during which coupons are active/eligible to be assigned
  COUPON_VALID_DAYS_AFTER_LAUNCH: parseInt(process.env.COUPON_VALID_DAYS_AFTER_LAUNCH || "365", 10)
};
