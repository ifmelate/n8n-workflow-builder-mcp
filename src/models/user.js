/**
 * User and Permissions Model
 * 
 * Defines user roles and permissions for role-based access control.
 */

// Define permission constants
const PERMISSIONS = {
    // Workflow permissions
    WORKFLOW_VIEW: 'workflow:view',
    WORKFLOW_CREATE: 'workflow:create',
    WORKFLOW_EDIT: 'workflow:edit',
    WORKFLOW_DELETE: 'workflow:delete',
    WORKFLOW_EXECUTE: 'workflow:execute',

    // Node permissions
    NODE_VIEW: 'node:view',
    NODE_ADD: 'node:add',
    NODE_EDIT: 'node:edit',
    NODE_DELETE: 'node:delete',

    // Connection permissions
    CONNECTION_VIEW: 'connection:view',
    CONNECTION_CREATE: 'connection:create',
    CONNECTION_DELETE: 'connection:delete',

    // Credential permissions
    CREDENTIAL_VIEW: 'credential:view',
    CREDENTIAL_CREATE: 'credential:create',
    CREDENTIAL_EDIT: 'credential:edit',
    CREDENTIAL_DELETE: 'credential:delete',

    // System permissions
    SYSTEM_ADMIN: 'system:admin'
};

// Define user roles with associated permissions
const ROLES = {
    ADMIN: 'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer'
};

// Permission sets for each role
const ROLE_PERMISSIONS = {
    [ROLES.ADMIN]: [
        // System admin has all permissions
        PERMISSIONS.SYSTEM_ADMIN,
        PERMISSIONS.WORKFLOW_VIEW,
        PERMISSIONS.WORKFLOW_CREATE,
        PERMISSIONS.WORKFLOW_EDIT,
        PERMISSIONS.WORKFLOW_DELETE,
        PERMISSIONS.WORKFLOW_EXECUTE,
        PERMISSIONS.NODE_VIEW,
        PERMISSIONS.NODE_ADD,
        PERMISSIONS.NODE_EDIT,
        PERMISSIONS.NODE_DELETE,
        PERMISSIONS.CONNECTION_VIEW,
        PERMISSIONS.CONNECTION_CREATE,
        PERMISSIONS.CONNECTION_DELETE,
        PERMISSIONS.CREDENTIAL_VIEW,
        PERMISSIONS.CREDENTIAL_CREATE,
        PERMISSIONS.CREDENTIAL_EDIT,
        PERMISSIONS.CREDENTIAL_DELETE
    ],
    [ROLES.EDITOR]: [
        // Editor can do everything except delete workflows and manage credentials
        PERMISSIONS.WORKFLOW_VIEW,
        PERMISSIONS.WORKFLOW_CREATE,
        PERMISSIONS.WORKFLOW_EDIT,
        PERMISSIONS.WORKFLOW_EXECUTE,
        PERMISSIONS.NODE_VIEW,
        PERMISSIONS.NODE_ADD,
        PERMISSIONS.NODE_EDIT,
        PERMISSIONS.NODE_DELETE,
        PERMISSIONS.CONNECTION_VIEW,
        PERMISSIONS.CONNECTION_CREATE,
        PERMISSIONS.CONNECTION_DELETE,
        PERMISSIONS.CREDENTIAL_VIEW
    ],
    [ROLES.VIEWER]: [
        // Viewer has read-only access
        PERMISSIONS.WORKFLOW_VIEW,
        PERMISSIONS.NODE_VIEW,
        PERMISSIONS.CONNECTION_VIEW
    ]
};

/**
 * Check if a user has a specific permission
 * 
 * @param {Object} user - User object with roles property
 * @param {String} permission - Permission to check
 * @returns {Boolean} - Whether user has the permission
 */
const hasPermission = (user, permission) => {
    // If no user or roles provided, no permissions
    if (!user || !user.roles || !Array.isArray(user.roles)) {
        return false;
    }

    // Check if any of the user's roles grant the required permission
    return user.roles.some(role => {
        const rolePermissions = ROLE_PERMISSIONS[role];

        // If role doesn't exist or has no permissions, skip
        if (!rolePermissions) {
            return false;
        }

        // System admin permission grants access to everything
        if (rolePermissions.includes(PERMISSIONS.SYSTEM_ADMIN)) {
            return true;
        }

        // Check for specific permission
        return rolePermissions.includes(permission);
    });
};

/**
 * Get all permissions for a user based on their roles
 * 
 * @param {Object} user - User object with roles property
 * @returns {String[]} - Array of permission strings
 */
const getUserPermissions = (user) => {
    // If no user or roles provided, no permissions
    if (!user || !user.roles || !Array.isArray(user.roles)) {
        return [];
    }

    // Create a Set to avoid duplicate permissions
    const permissionsSet = new Set();

    // Add all permissions from all user roles
    user.roles.forEach(role => {
        const rolePermissions = ROLE_PERMISSIONS[role];
        if (rolePermissions) {
            rolePermissions.forEach(permission => permissionsSet.add(permission));
        }
    });

    return [...permissionsSet];
};

/**
 * Validate if a role exists
 * 
 * @param {String} role - Role to validate
 * @returns {Boolean} - Whether the role exists
 */
const validateRole = (role) => {
    return Object.values(ROLES).includes(role);
};

module.exports = {
    PERMISSIONS,
    ROLES,
    ROLE_PERMISSIONS,
    hasPermission,
    getUserPermissions,
    validateRole
}; 