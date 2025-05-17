/**
 * Authorization Middleware
 * 
 * Handles role-based authorization for the MCP server.
 */

const { PERMISSIONS, hasPermission } = require('../models/user');
const { createErrorResponse } = require('../utils/mcp');
const { logger } = require('../utils/logger');

/**
 * Authorization middleware to check if the user has the required permission
 * 
 * @param {String} permission - The permission required for the operation
 * @returns {Function} Express middleware function
 */
const authorize = (permission) => {
    return (req, res, next) => {
        if (!req.auth) {
            // No authentication data available
            const errorResponse = createErrorResponse(
                'Authorization requires authentication',
                'AUTHENTICATION_REQUIRED',
                401
            );
            return res.status(errorResponse.status).json({ error: errorResponse.error });
        }

        // For API key auth, assign default admin role
        // In a real-world scenario, API keys would have specific permissions associated with them
        if (req.auth.type === 'apikey') {
            req.user = {
                roles: ['admin']
            };
            return next();
        }

        // For JWT auth, use the user data from the token
        if (req.auth.type === 'jwt') {
            // User data should be available in req.auth.user
            const user = req.auth.user;

            // If no roles in the token, access is denied
            if (!user || !user.roles) {
                const errorResponse = createErrorResponse(
                    'User has no defined roles',
                    'MISSING_ROLES',
                    403
                );
                return res.status(errorResponse.status).json({ error: errorResponse.error });
            }

            // Store the user object for use in other middleware/routes
            req.user = user;

            // Skip permission check if no specific permission required
            if (!permission) {
                return next();
            }

            // Check if user has the required permission
            if (hasPermission(user, permission)) {
                return next();
            }

            // Permission denied
            logger.warn(`Access denied: User lacks permission: ${permission}`);
            const errorResponse = createErrorResponse(
                `You don't have permission to perform this action`,
                'PERMISSION_DENIED',
                403
            );
            return res.status(errorResponse.status).json({ error: errorResponse.error });
        }

        // Unsupported auth type
        const errorResponse = createErrorResponse(
            'Unsupported authentication type',
            'UNSUPPORTED_AUTH_TYPE',
            401
        );
        return res.status(errorResponse.status).json({ error: errorResponse.error });
    };
};

/**
 * Middleware to handle workflow permissions
 */
const authorizeWorkflow = {
    // Permission middleware for viewing workflows
    view: authorize(PERMISSIONS.WORKFLOW_VIEW),

    // Permission middleware for creating workflows
    create: authorize(PERMISSIONS.WORKFLOW_CREATE),

    // Permission middleware for editing workflows
    edit: authorize(PERMISSIONS.WORKFLOW_EDIT),

    // Permission middleware for deleting workflows
    delete: authorize(PERMISSIONS.WORKFLOW_DELETE),

    // Permission middleware for executing workflows
    execute: authorize(PERMISSIONS.WORKFLOW_EXECUTE)
};

/**
 * Middleware to handle node permissions
 */
const authorizeNode = {
    // Permission middleware for viewing nodes
    view: authorize(PERMISSIONS.NODE_VIEW),

    // Permission middleware for adding nodes
    add: authorize(PERMISSIONS.NODE_ADD),

    // Permission middleware for editing nodes
    edit: authorize(PERMISSIONS.NODE_EDIT),

    // Permission middleware for deleting nodes
    delete: authorize(PERMISSIONS.NODE_DELETE)
};

/**
 * Middleware to handle connection permissions
 */
const authorizeConnection = {
    // Permission middleware for viewing connections
    view: authorize(PERMISSIONS.CONNECTION_VIEW),

    // Permission middleware for creating connections
    create: authorize(PERMISSIONS.CONNECTION_CREATE),

    // Permission middleware for deleting connections
    delete: authorize(PERMISSIONS.CONNECTION_DELETE)
};

/**
 * Middleware to handle credential permissions
 */
const authorizeCredential = {
    // Permission middleware for viewing credentials
    view: authorize(PERMISSIONS.CREDENTIAL_VIEW),

    // Permission middleware for creating credentials
    create: authorize(PERMISSIONS.CREDENTIAL_CREATE),

    // Permission middleware for editing credentials
    edit: authorize(PERMISSIONS.CREDENTIAL_EDIT),

    // Permission middleware for deleting credentials
    delete: authorize(PERMISSIONS.CREDENTIAL_DELETE)
};

/**
 * Middleware for system admin permissions
 */
const authorizeAdmin = authorize(PERMISSIONS.SYSTEM_ADMIN);

/**
 * Get middleware that logs access attempts and enforces permission check
 * 
 * @param {String} permission - Permission required for the operation
 * @param {String} operation - Description of the operation for logging
 * @returns {Function} Express middleware function
 */
const logAndAuthorize = (permission, operation) => {
    return (req, res, next) => {
        logger.info(`Access attempt: ${operation}, User: ${req.auth?.user?.id || 'API Key'}`);

        // Use the authorize middleware with the specified permission
        authorize(permission)(req, res, next);
    };
};

module.exports = {
    authorize,
    authorizeWorkflow,
    authorizeNode,
    authorizeConnection,
    authorizeCredential,
    authorizeAdmin,
    logAndAuthorize
}; 