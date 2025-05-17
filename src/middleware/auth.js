/**
 * Authentication Middleware
 * 
 * Handles authentication for API requests
 */

const { logger } = require('../utils/logger');
const { createErrorResponse } = require('../utils/mcp');
const { logSecurityEvent } = require('../utils/securityLogger');

// Get API key from environment
const API_KEY = process.env.MCP_API_KEY || 'development-key';

/**
 * Authenticate API requests using API key
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;

    // Check if auth header is present
    if (!authHeader) {
        logSecurityEvent({
            level: 'warn',
            eventType: 'authentication_failure',
            ip: req.ip || req.connection.remoteAddress,
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

    // Check auth header format - should be "Bearer <api-key>"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        logSecurityEvent({
            level: 'warn',
            eventType: 'authentication_failure',
            ip: req.ip || req.connection.remoteAddress,
            details: {
                reason: 'Invalid authorization format',
                endpoint: req.path
            }
        });

        const errorResponse = createErrorResponse(
            'Invalid authorization format',
            'INVALID_AUTH_FORMAT',
            401
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }

    const apiKey = parts[1];

    // Validate API key
    if (apiKey !== API_KEY) {
        logSecurityEvent({
            level: 'warn',
            eventType: 'authentication_failure',
            ip: req.ip || req.connection.remoteAddress,
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

    // Add auth info to request for downstream middleware/routes
    req.auth = {
        authenticated: true,
        // Add additional auth info as needed, e.g., user ID, roles, etc.
        user: {
            id: 'system' // Default system user for API access
        }
    };

    // Log successful authentication
    logger.debug(`Authenticated request to ${req.path}`);

    // Continue to next middleware
    next();
};

module.exports = {
    authenticate
}; 