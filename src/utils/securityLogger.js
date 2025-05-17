/**
 * Security Logger
 * 
 * Specialized logger for security-related events with structured data
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

// Configuration
const SECURITY_LOG_DIR = process.env.SECURITY_LOG_DIR || path.join(process.cwd(), 'logs');
const SECURITY_LOG_FILE = path.join(SECURITY_LOG_DIR, 'security.log');

// Ensure logs directory exists
if (!fs.existsSync(SECURITY_LOG_DIR)) {
    try {
        fs.mkdirSync(SECURITY_LOG_DIR, { recursive: true });
    } catch (error) {
        logger.error(`Failed to create security log directory: ${error.message}`);
    }
}

/**
 * Log a security event to the security log file
 * 
 * @param {Object} options - Event details
 * @param {string} options.level - Log level (info, warn, error)
 * @param {string} options.eventType - Type of security event
 * @param {string} options.userId - User who performed the action (if known)
 * @param {string} options.ip - IP address of the request
 * @param {Object} options.details - Additional event details
 */
const logSecurityEvent = (options) => {
    const {
        level = 'info',
        eventType,
        userId = 'anonymous',
        ip = 'unknown',
        details = {}
    } = options;

    // Create structured log entry
    const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        eventType,
        userId,
        ip,
        details
    };

    // Write to security log file
    try {
        fs.appendFileSync(
            SECURITY_LOG_FILE,
            JSON.stringify(logEntry) + '\n'
        );
    } catch (error) {
        logger.error(`Failed to write to security log: ${error.message}`);
    }

    // Also log to regular logger
    logger[level](`Security event: ${eventType}`, {
        userId,
        ip,
        ...details
    });
};

/**
 * Log validation failures (special case of security events)
 * 
 * @param {Object} options - Validation failure details
 * @param {string} options.ip - Client IP address
 * @param {string} options.userId - User ID if authenticated
 * @param {string} options.endpoint - API endpoint
 * @param {string} options.method - HTTP method
 * @param {string} options.violationType - Type of validation violation
 * @param {string} options.inputField - Field that caused the violation
 */
const logValidationFailure = (options) => {
    const {
        ip,
        userId,
        endpoint,
        method,
        violationType,
        inputField
    } = options;

    logSecurityEvent({
        level: 'warn',
        eventType: 'validation_failure',
        userId,
        ip,
        details: {
            endpoint,
            method,
            violationType,
            inputField
        }
    });
};

module.exports = {
    logSecurityEvent,
    logValidationFailure
}; 