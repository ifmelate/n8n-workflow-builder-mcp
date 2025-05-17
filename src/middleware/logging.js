/**
 * Logging Middleware
 * 
 * Contains middleware functions for HTTP request logging
 */

const { logger } = require('../utils/logger');
const { logSecurityEvent } = require('../utils/securityLogger');

/**
 * Logs MCP requests for debugging and security purposes
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const logMcpRequest = (req, res, next) => {
    // Log basic request info
    logger.debug(`MCP Request: ${req.method} ${req.path}`);

    // Extract user ID if available
    const userId = req.auth?.user?.id || 'anonymous';

    // Log request details without sensitive information
    if (req.body && Object.keys(req.body).length > 0) {
        // Create a sanitized copy of the request body for logging
        const sanitizedBody = { ...req.body };

        // Redact sensitive information from parameters
        if (sanitizedBody.parameters) {
            const sensitiveKeys = ['apiKey', 'token', 'password', 'secret', 'key', 'auth'];

            for (const key of Object.keys(sanitizedBody.parameters)) {
                if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
                    sanitizedBody.parameters[key] = '[REDACTED]';
                }
            }
        }

        logger.debug(`Request Body: ${JSON.stringify(sanitizedBody)}`);
    }

    // Log security event for non-GET requests
    if (req.method !== 'GET') {
        logSecurityEvent({
            level: 'info',
            eventType: 'mcp_request',
            userId,
            ip: req.ip || req.connection.remoteAddress,
            details: {
                method: req.method,
                path: req.path,
                userAgent: req.headers['user-agent'] || 'unknown'
            }
        });
    }

    // Call next middleware
    next();
};

module.exports = {
    logMcpRequest
}; 