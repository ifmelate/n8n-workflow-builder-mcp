/**
 * MCP Protocol Middleware
 * 
 * Handles validation and processing of MCP protocol requests
 */

const Ajv = require('ajv');
const { logger } = require('../utils/logger');
const { createErrorResponse } = require('../utils/mcp');
const { logValidationFailure } = require('../utils/securityLogger');
const { toolDefinitions } = require('../tools/toolDefinitions');

// Initialize AJV
const ajv = new Ajv({ allErrors: true });

// Create schema for MCP requests
const toolRequestSchema = {
    type: 'object',
    required: ['name', 'parameters'],
    additionalProperties: false,
    properties: {
        name: { type: 'string' },
        parameters: {
            type: 'object',
            additionalProperties: true
        }
    }
};

/**
 * Validate tool request against schema
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validateToolRequest = (req, res, next) => {
    // Extract tool info from request
    const { name, parameters = {} } = req.body;

    // Basic request format validation
    const validate = ajv.compile(toolRequestSchema);
    const valid = validate(req.body);

    if (!valid) {
        const errors = validate.errors.map(err =>
            `${err.instancePath} ${err.message}`
        ).join('; ');

        // Log the validation error
        logger.warn(`MCP protocol validation error: ${errors}`);

        // Security logging
        const clientIp = req.ip || req.connection.remoteAddress;
        const userId = req.auth ? (req.auth.user ? req.auth.user.id : null) : null;

        logValidationFailure({
            ip: clientIp,
            userId,
            endpoint: req.path,
            method: req.method,
            violationType: 'mcp_protocol_validation',
            inputField: 'request_format'
        });

        const errorResponse = createErrorResponse(
            `Invalid request format: ${errors}`,
            'INVALID_REQUEST_FORMAT',
            400
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    }

    // Validate tool existence and parameter types if tool exists
    const toolDef = toolDefinitions[name];
    if (toolDef) {
        // Create a validator for this tool's input schema
        if (toolDef.input_schema && toolDef.input_schema.properties) {
            try {
                const inputValidator = ajv.compile(toolDef.input_schema);
                const paramsValid = inputValidator(parameters);

                if (!paramsValid) {
                    const paramErrors = inputValidator.errors.map(err =>
                        `${err.instancePath} ${err.message}`
                    ).join('; ');

                    // Log the validation error
                    logger.warn(`Tool parameter validation error for ${name}: ${paramErrors}`);

                    // Security logging
                    const clientIp = req.ip || req.connection.remoteAddress;
                    const userId = req.auth ? (req.auth.user ? req.auth.user.id : null) : null;

                    logValidationFailure({
                        ip: clientIp,
                        userId,
                        endpoint: req.path,
                        method: req.method,
                        violationType: 'tool_parameter_validation',
                        inputField: name
                    });

                    const errorResponse = createErrorResponse(
                        `Invalid parameters for tool ${name}: ${paramErrors}`,
                        'INVALID_TOOL_PARAMETERS',
                        400
                    );
                    return res.status(errorResponse.status).json({ error: errorResponse.error });
                }
            } catch (err) {
                logger.error(`Error validating parameters for tool ${name}: ${err.message}`);
            }
        }
    }

    // Continue to the next middleware
    next();
};

/**
 * Sanitizes input parameters to prevent injection attacks
 */
const sanitizeParameters = (parameters) => {
    // Recursive function to sanitize all string values
    const sanitizeObject = (obj) => {
        for (const key in obj) {
            const value = obj[key];

            if (typeof value === 'string') {
                // Basic sanitization for strings
                obj[key] = sanitizeString(value);
            } else if (value !== null && typeof value === 'object') {
                // Recursively sanitize nested objects and arrays
                sanitizeObject(value);
            }
        }
    };

    sanitizeObject(parameters);
};

/**
 * Sanitizes a string to prevent common injection attacks
 */
const sanitizeString = (str) => {
    // Replace potentially dangerous characters/patterns
    // This is a simple example - in production, use a proper sanitization library
    return str
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
};

/**
 * Logs MCP requests for debugging
 */
const logMcpRequest = (req, res, next) => {
    // Only run in development mode
    if (process.env.NODE_ENV !== 'production') {
        logger.debug(`MCP Request: ${req.method} ${req.path}`);
        if (req.body && Object.keys(req.body).length > 0) {
            // Avoid logging sensitive data in parameters
            const sanitizedBody = { ...req.body };
            if (sanitizedBody.parameters) {
                // Replace potentially sensitive parameter values with "[REDACTED]"
                const sensitiveKeys = ['apiKey', 'token', 'password', 'secret'];
                for (const key of Object.keys(sanitizedBody.parameters)) {
                    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
                        sanitizedBody.parameters[key] = '[REDACTED]';
                    }
                }
            }
            logger.debug(`Request Body: ${JSON.stringify(sanitizedBody)}`);
        }
    }
    next();
};

module.exports = {
    validateToolRequest,
    logMcpRequest,
    sanitizeParameters,
    sanitizeString
}; 