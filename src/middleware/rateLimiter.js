/**
 * Rate Limiter Middleware
 * 
 * Protects the API from excessive requests
 */

const { logger } = require('../utils/logger');
const { createErrorResponse } = require('../utils/mcp');
const { logSecurityEvent } = require('../utils/securityLogger');

// In-memory store for rate limiting (in production, use Redis or similar)
const requestCounts = {};

// Constants
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100; // 100 requests per minute

/**
 * Simple rate limiter middleware
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const rateLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    // Initialize or reset window
    if (!requestCounts[ip] || requestCounts[ip].windowStart < now - WINDOW_MS) {
        requestCounts[ip] = {
            windowStart: now,
            count: 1
        };
        return next();
    }

    // Increment count for existing window
    requestCounts[ip].count++;

    // Check if too many requests
    if (requestCounts[ip].count > MAX_REQUESTS_PER_WINDOW) {
        // Log rate limit
        logger.warn(`Rate limit exceeded for IP: ${ip}`);

        // Security log
        logSecurityEvent({
            level: 'warn',
            eventType: 'rate_limit_exceeded',
            ip,
            details: {
                count: requestCounts[ip].count,
                window: WINDOW_MS,
                limit: MAX_REQUESTS_PER_WINDOW
            }
        });

        // Create error response
        const errorResponse = createErrorResponse(
            'Too many requests, please try again later',
            'RATE_LIMIT_EXCEEDED',
            429,
            {
                retryAfter: Math.ceil((requestCounts[ip].windowStart + WINDOW_MS - now) / 1000)
            }
        );

        // Set retry header
        res.setHeader(
            'Retry-After',
            Math.ceil((requestCounts[ip].windowStart + WINDOW_MS - now) / 1000)
        );

        return res.status(429).json({ error: errorResponse.error });
    }

    next();
};

module.exports = {
    rateLimiter
}; 