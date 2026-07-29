const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter — 500 requests per 15 minutes per IP
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
});

/**
 * Ticket creation limiter — max 20 tickets per hour per IP
 */
const ticketCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'You have created too many tickets. Please wait before creating another.' },
});

/**
 * Message send limiter — max 200 messages per hour per IP
 */
const messageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Message rate limit exceeded. Please wait before sending more.' },
});

/**
 * Search/query limiter — max 100 requests per minute per IP
 */
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Search rate limit exceeded.' },
});

module.exports = { generalLimiter, ticketCreateLimiter, messageLimiter, searchLimiter };
