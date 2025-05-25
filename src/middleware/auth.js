/**
 * Authentication Middleware
 * 
 * Handles authentication for API requests
 */

const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');
const { createErrorResponse } = require('../utils/mcp');
const { logSecurityEvent } = require('../utils/securityLogger');

// Get API key from environment
const API_KEY = process.env.MCP_API_KEY || 'development-key';

// Rate limiting storage
const rateLimitStore = new Map();

/**
 * Validate API key against environment variables or config
 * @param {string} apiKey - The API key to validate
 * @returns {boolean} - True if valid, false otherwise
 */
const validateApiKey = (apiKey) => {
    // Check environment variables first
    if (process.env.API_KEYS) {
        const validKeys = process.env.API_KEYS.split(',').map(key => key.trim());
        return validKeys.includes(apiKey);
    }

    // Check config if available
    try {
        const config = require('../../config/default');
        if (config.auth && config.auth.apiKeys && Array.isArray(config.auth.apiKeys)) {
            return config.auth.apiKeys.includes(apiKey);
        }
    } catch (error) {
        // Config not available, fall back to default
    }

    // Fall back to default API key
    return apiKey === API_KEY;
};

/**
 * Check rate limiting for an IP address
 * @param {string} ip - The IP address to check
 * @returns {boolean} - True if rate limited, false otherwise
 */
const isRateLimited = (ip) => {
    const attempts = rateLimitStore.get(ip) || 0;
    return attempts >= 5;
};

/**
 * Increment failed attempts for an IP address
 * @param {string} ip - The IP address to track
 */
const trackFailedAttempt = (ip) => {
    const attempts = rateLimitStore.get(ip) || 0;
    rateLimitStore.set(ip, attempts + 1);

    // Clean up after 1 hour
    setTimeout(() => {
        rateLimitStore.delete(ip);
    }, 3600000);
};

/**
 * API Key authentication middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';

    // Check rate limiting
    if (isRateLimited(ip)) {
        const errorResponse = createErrorResponse(
            'Too many failed attempts',
            'RATE_LIMITED',
            429
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }

    if (!apiKey) {
        trackFailedAttempt(ip);
        logSecurityEvent({
            level: 'warn',
            eventType: 'authentication_failure',
            ip,
            details: {
                reason: 'Missing API key',
                endpoint: req.path
            }
        });

        const errorResponse = createErrorResponse(
            'API key required',
            'MISSING_API_KEY',
            401
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }

    if (!validateApiKey(apiKey)) {
        trackFailedAttempt(ip);
        logSecurityEvent({
            level: 'warn',
            eventType: 'authentication_failure',
            ip,
            details: {
                reason: 'Invalid API key',
                endpoint: req.path
            }
        });

        const errorResponse = createErrorResponse(
            'Invalid API key',
            'INVALID_API_KEY',
            401
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }

    // Set auth info
    req.auth = {
        type: 'apikey',
        key: apiKey
    };

    next();
};

/**
 * JWT authentication middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const jwtAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';

    // Check rate limiting
    if (isRateLimited(ip)) {
        const errorResponse = createErrorResponse(
            'Too many failed attempts',
            'RATE_LIMITED',
            429
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }

    if (!authHeader) {
        trackFailedAttempt(ip);
        const errorResponse = createErrorResponse(
            'JWT token required',
            'MISSING_JWT_TOKEN',
            401
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        trackFailedAttempt(ip);
        const errorResponse = createErrorResponse(
            'JWT token required',
            'MISSING_JWT_TOKEN',
            401
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }

    const token = parts[1];

    try {
        // Use a default secret if not configured
        const secret = process.env.JWT_SECRET || 'default-secret';
        const decoded = jwt.verify(token, secret);

        req.auth = {
            type: 'jwt',
            user: decoded
        };

        next();
    } catch (error) {
        trackFailedAttempt(ip);

        let errorCode = 'INVALID_JWT_TOKEN';
        let message = 'Invalid JWT token';

        if (error.name === 'TokenExpiredError') {
            errorCode = 'EXPIRED_JWT_TOKEN';
            message = 'JWT token has expired';
        } else if (error.name === 'JsonWebTokenError') {
            if (error.message.includes('invalid signature')) {
                errorCode = 'INVALID_JWT_SIGNATURE';
                message = 'Invalid JWT signature';
            } else if (error.message.includes('malformed')) {
                errorCode = 'MALFORMED_JWT_TOKEN';
                message = 'Malformed JWT token';
            }
        }

        const errorResponse = createErrorResponse(message, errorCode, 401);
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }
};

/**
 * Main authentication middleware - supports both API key and JWT
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const authenticate = (req, res, next) => {
    // Set MCP version header
    res.setHeader('X-MCP-Version', '1.0');

    // Skip authentication in development if configured
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
        logger.warn('Authentication bypassed in development mode');
        req.auth = {
            type: 'development',
            user: { id: 'dev-user' }
        };
        return next();
    }

    const apiKey = req.headers['x-api-key'];
    const authHeader = req.headers.authorization;

    if (apiKey) {
        // Use API key authentication
        return apiKeyAuth(req, res, next);
    } else if (authHeader) {
        // Use JWT authentication
        return jwtAuth(req, res, next);
    } else {
        // No authentication method provided
        const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';

        logSecurityEvent({
            level: 'warn',
            eventType: 'authentication_failure',
            ip,
            details: {
                reason: 'Missing authorization header',
                endpoint: req.path
            }
        });

        const errorResponse = createErrorResponse(
            'Authentication required',
            'AUTHENTICATION_REQUIRED',
            401
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }
};

module.exports = {
    authenticate,
    apiKeyAuth,
    jwtAuth,
    validateApiKey,
    rateLimitStore // Export for testing
}; 