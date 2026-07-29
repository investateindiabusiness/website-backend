const { PRODUCT_LAUNCH_DATE, COUPON_USER_LIMIT, COUPON_VALID_DAYS_AFTER_LAUNCH } = require('../config/appConfig');

/**
 * Calculates premium access status and remaining trial days based on the launch date.
 * All users get 1 year of free premium access starting from the PRODUCT_LAUNCH_DATE.
 */
const getPremiumStatus = () => {
  const launchDate = new Date(PRODUCT_LAUNCH_DATE);
  
  // Expiry date is exactly 1 year from the product launch date
  const freeTrialExpiry = new Date(launchDate.getTime());
  freeTrialExpiry.setFullYear(freeTrialExpiry.getFullYear() + 1);
  
  const currentDate = new Date();
  
  // Premium access is active if the current date is before or equal to the expiry date
  const isPremiumActive = currentDate <= freeTrialExpiry;
  
  // Calculate remaining days
  const diffTime = freeTrialExpiry.getTime() - currentDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const remainingDays = isPremiumActive ? Math.max(0, diffDays) : 0;
  
  return {
    isPremium: isPremiumActive,
    remainingDays,
    launchDate: PRODUCT_LAUNCH_DATE,
    freeTrialExpiryDate: freeTrialExpiry.toISOString().split('T')[0]
  };
};

/**
 * Checks if coupon assignment for new users is active.
 * Assignment is active if the registered user count is within limits AND we are within the allowed days after launch.
 */
const isCouponAssignmentActive = (userCount) => {
  const launchDate = new Date(PRODUCT_LAUNCH_DATE);
  
  const expiryDate = new Date(launchDate.getTime());
  expiryDate.setDate(expiryDate.getDate() + COUPON_VALID_DAYS_AFTER_LAUNCH);
  
  const currentDate = new Date();
  
  const withinUserLimit = userCount <= COUPON_USER_LIMIT;
  const withinDateWindow = currentDate <= expiryDate;
  
  return withinUserLimit && withinDateWindow;
};

module.exports = {
  getPremiumStatus,
  isCouponAssignmentActive
};
