/**
 * Input Validation Middleware
 * 
 * Provides JSON Schema validation for API endpoints and request sanitization.
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { createErrorResponse } = require('../utils/mcp');
const { logger } = require('../utils/logger');
const { logValidationFailure } = require('../utils/securityLogger');

// Initialize AJV with additional options
const ajv = new Ajv({
    allErrors: true,
    removeAdditional: 'all',  // Remove additional properties not in schema
    useDefaults: true,        // Apply default values from schema
    coerceTypes: true         // Convert data types when possible
});

// Add format validators (email, date, uri, etc.)
addFormats(ajv);

/**
 * Creates a validation middleware for a specific schema
 * 
 * @param {Object} schema - JSON Schema object to validate against
 * @param {string} property - Request property to validate (body, query, params)
 * @returns {Function} Express middleware function
 */
const validateSchema = (schema, property = 'body') => {
    const validate = ajv.compile(schema);

    return (req, res, next) => {
        const data = req[property];
        const valid = validate(data);

        if (!valid) {
            // Format validation errors for response
            const formattedErrors = formatValidationErrors(validate.errors);

            // Regular logging
            logger.warn(`Validation error for ${req.method} ${req.path}: ${JSON.stringify(formattedErrors)}`);

            // Security logging
            const clientIp = req.ip || req.connection.remoteAddress;
            const userId = req.auth ? (req.auth.user ? req.auth.user.id : null) : null;

            // Log each validation error separately
            Object.keys(formattedErrors).forEach(field => {
                logValidationFailure({
                    ip: clientIp,
                    userId,
                    endpoint: req.path,
                    method: req.method,
                    violationType: 'schema_validation',
                    inputField: field
                });
            });

            const errorResponse = createErrorResponse(
                'Validation failed',
                'VALIDATION_ERROR',
                400,
                formattedErrors
            );

            return res.status(errorResponse.status).json({ error: errorResponse.error });
        }

        next();
    };
};

/**
 * Format validation errors into a more user-friendly structure
 * 
 * @param {Array} errors - AJV validation errors
 * @returns {Object} Formatted errors by field
 */
const formatValidationErrors = (errors) => {
    const formattedErrors = {};

    for (const error of errors) {
        // Extract the field name from the error path
        const path = error.instancePath.substring(1).split('/');
        const field = path.length ? path[path.length - 1] : error.params.missingProperty || 'value';

        // Initialize the field in the errors object if it doesn't exist
        if (!formattedErrors[field]) {
            formattedErrors[field] = [];
        }

        // Add the error message for this field
        let message = error.message;

        // Customize messages for specific error types
        if (error.keyword === 'required') {
            message = `Missing required field: ${error.params.missingProperty}`;
        } else if (error.keyword === 'additionalProperties') {
            message = `Unexpected field: ${error.params.additionalProperty}`;
        }

        formattedErrors[field].push(message);
    }

    return formattedErrors;
};

/**
 * Sanitize input data to prevent injection attacks
 * 
 * @param {*} data - Data to sanitize
 * @returns {*} Sanitized data
 */
const sanitizeInput = (data) => {
    if (typeof data === 'string') {
        // Basic sanitization for strings
        return data
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;')
            .replace(/`/g, '&#96;');
    }

    if (data && typeof data === 'object') {
        if (Array.isArray(data)) {
            // Recursively sanitize array items
            return data.map(item => sanitizeInput(item));
        } else {
            // Recursively sanitize object properties
            const sanitized = {};
            for (const [key, value] of Object.entries(data)) {
                sanitized[key] = sanitizeInput(value);
            }
            return sanitized;
        }
    }

    // Return non-string, non-object values as is
    return data;
};

/**
 * Creates a sanitization middleware
 * 
 * @param {string} property - Request property to sanitize (body, query, params)
 * @returns {Function} Express middleware function
 */
const sanitizeRequest = (property = 'body') => {
    return (req, res, next) => {
        if (req[property]) {
            req[property] = sanitizeInput(req[property]);
        }
        next();
    };
};

/**
 * Validate workflow-specific inputs
 */
const validateWorkflow = (req, res, next) => {
    const { name, description } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress;
    const userId = req.auth?.userId || 'anonymous';

    // Name must be provided
    if (!name) {
        // Log validation failure
        logValidationFailure({
            ip: clientIp,
            userId,
            endpoint: req.path,
            method: req.method,
            violationType: 'required_field_missing',
            inputField: 'name'
        });

        const errorResponse = createErrorResponse(
            'Workflow name is required',
            'MISSING_REQUIRED_FIELD',
            400
        );

        return res.status(400).json({ error: errorResponse.error });
    }

    // Name length validation
    if (name.length > 100) {
        // Log validation failure
        logValidationFailure({
            ip: clientIp,
            userId,
            endpoint: req.path,
            method: req.method,
            violationType: 'field_too_long',
            inputField: 'name'
        });

        const errorResponse = createErrorResponse(
            'Workflow name cannot exceed 100 characters',
            'FIELD_TOO_LONG',
            400
        );

        return res.status(400).json({ error: errorResponse.error });
    }

    // Description length validation
    if (description && description.length > 500) {
        // Log validation failure
        logValidationFailure({
            ip: clientIp,
            userId,
            endpoint: req.path,
            method: req.method,
            violationType: 'field_too_long',
            inputField: 'description'
        });

        const errorResponse = createErrorResponse(
            'Workflow description cannot exceed 500 characters',
            'FIELD_TOO_LONG',
            400
        );

        return res.status(400).json({ error: errorResponse.error });
    }

    next();
};

module.exports = {
    validateSchema,
    sanitizeRequest,
    sanitizeInput,
    formatValidationErrors,
    validateWorkflow
}; 