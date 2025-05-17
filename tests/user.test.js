/**
 * User Model Tests
 * 
 * Tests for the user roles and permissions model
 */

const {
    PERMISSIONS,
    ROLES,
    ROLE_PERMISSIONS,
    hasPermission,
    getUserPermissions,
    validateRole
} = require('../src/models/user');

describe('User Model', () => {
    describe('PERMISSIONS', () => {
        it('should define all necessary permission constants', () => {
            // Workflow permissions
            expect(PERMISSIONS.WORKFLOW_VIEW).toBeDefined();
            expect(PERMISSIONS.WORKFLOW_CREATE).toBeDefined();
            expect(PERMISSIONS.WORKFLOW_EDIT).toBeDefined();
            expect(PERMISSIONS.WORKFLOW_DELETE).toBeDefined();
            expect(PERMISSIONS.WORKFLOW_EXECUTE).toBeDefined();

            // Node permissions
            expect(PERMISSIONS.NODE_VIEW).toBeDefined();
            expect(PERMISSIONS.NODE_ADD).toBeDefined();
            expect(PERMISSIONS.NODE_EDIT).toBeDefined();
            expect(PERMISSIONS.NODE_DELETE).toBeDefined();

            // Connection permissions
            expect(PERMISSIONS.CONNECTION_VIEW).toBeDefined();
            expect(PERMISSIONS.CONNECTION_CREATE).toBeDefined();
            expect(PERMISSIONS.CONNECTION_DELETE).toBeDefined();

            // Credential permissions
            expect(PERMISSIONS.CREDENTIAL_VIEW).toBeDefined();
            expect(PERMISSIONS.CREDENTIAL_CREATE).toBeDefined();
            expect(PERMISSIONS.CREDENTIAL_EDIT).toBeDefined();
            expect(PERMISSIONS.CREDENTIAL_DELETE).toBeDefined();

            // System permissions
            expect(PERMISSIONS.SYSTEM_ADMIN).toBeDefined();
        });
    });

    describe('ROLES', () => {
        it('should define all necessary roles', () => {
            expect(ROLES.ADMIN).toBeDefined();
            expect(ROLES.EDITOR).toBeDefined();
            expect(ROLES.VIEWER).toBeDefined();
        });
    });

    describe('ROLE_PERMISSIONS', () => {
        it('should define permissions for admin role', () => {
            const adminPerms = ROLE_PERMISSIONS[ROLES.ADMIN];
            expect(adminPerms).toBeDefined();
            expect(adminPerms).toContain(PERMISSIONS.SYSTEM_ADMIN);
            expect(adminPerms).toContain(PERMISSIONS.WORKFLOW_DELETE);
            expect(adminPerms).toContain(PERMISSIONS.CREDENTIAL_EDIT);
        });

        it('should define permissions for editor role', () => {
            const editorPerms = ROLE_PERMISSIONS[ROLES.EDITOR];
            expect(editorPerms).toBeDefined();
            expect(editorPerms).toContain(PERMISSIONS.WORKFLOW_EDIT);
            expect(editorPerms).toContain(PERMISSIONS.NODE_EDIT);
            expect(editorPerms).not.toContain(PERMISSIONS.WORKFLOW_DELETE);
            expect(editorPerms).not.toContain(PERMISSIONS.SYSTEM_ADMIN);
        });

        it('should define permissions for viewer role', () => {
            const viewerPerms = ROLE_PERMISSIONS[ROLES.VIEWER];
            expect(viewerPerms).toBeDefined();
            expect(viewerPerms).toContain(PERMISSIONS.WORKFLOW_VIEW);
            expect(viewerPerms).toContain(PERMISSIONS.NODE_VIEW);
            expect(viewerPerms).not.toContain(PERMISSIONS.WORKFLOW_EDIT);
            expect(viewerPerms).not.toContain(PERMISSIONS.NODE_EDIT);
        });
    });

    describe('hasPermission()', () => {
        it('should return false for undefined user', () => {
            expect(hasPermission(undefined, PERMISSIONS.WORKFLOW_VIEW)).toBe(false);
        });

        it('should return false for user without roles', () => {
            const user = { id: 'user123' };
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_VIEW)).toBe(false);
        });

        it('should return false if user has no matching role', () => {
            const user = { id: 'user123', roles: ['unknown-role'] };
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_VIEW)).toBe(false);
        });

        it('should return true for admin with any permission', () => {
            const user = { id: 'admin123', roles: [ROLES.ADMIN] };
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_DELETE)).toBe(true);
            expect(hasPermission(user, PERMISSIONS.CREDENTIAL_EDIT)).toBe(true);
            expect(hasPermission(user, PERMISSIONS.SYSTEM_ADMIN)).toBe(true);
        });

        it('should return correct permissions for editor role', () => {
            const user = { id: 'editor123', roles: [ROLES.EDITOR] };
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_EDIT)).toBe(true);
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_DELETE)).toBe(false);
        });

        it('should return correct permissions for viewer role', () => {
            const user = { id: 'viewer123', roles: [ROLES.VIEWER] };
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_VIEW)).toBe(true);
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_EDIT)).toBe(false);
        });

        it('should check permissions across multiple roles', () => {
            const user = { id: 'multi123', roles: [ROLES.VIEWER, ROLES.EDITOR] };
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_VIEW)).toBe(true);
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_EDIT)).toBe(true);
            expect(hasPermission(user, PERMISSIONS.WORKFLOW_DELETE)).toBe(false);
        });
    });

    describe('getUserPermissions()', () => {
        it('should return empty array for undefined user', () => {
            expect(getUserPermissions(undefined)).toEqual([]);
        });

        it('should return empty array for user without roles', () => {
            const user = { id: 'user123' };
            expect(getUserPermissions(user)).toEqual([]);
        });

        it('should return all permissions for admin', () => {
            const user = { id: 'admin123', roles: [ROLES.ADMIN] };
            const permissions = getUserPermissions(user);

            expect(permissions).toContain(PERMISSIONS.SYSTEM_ADMIN);
            expect(permissions).toContain(PERMISSIONS.WORKFLOW_DELETE);
            expect(permissions).toContain(PERMISSIONS.CREDENTIAL_EDIT);
            expect(permissions.length).toBe(ROLE_PERMISSIONS[ROLES.ADMIN].length);
        });

        it('should return combined permissions for multiple roles', () => {
            const user = { id: 'multi123', roles: [ROLES.VIEWER, ROLES.EDITOR] };
            const permissions = getUserPermissions(user);

            // Should include viewer permissions
            expect(permissions).toContain(PERMISSIONS.WORKFLOW_VIEW);

            // Should include editor permissions
            expect(permissions).toContain(PERMISSIONS.WORKFLOW_EDIT);

            // Should not include admin permissions
            expect(permissions).not.toContain(PERMISSIONS.SYSTEM_ADMIN);

            // Should deduplicate permissions
            const uniquePermissions = new Set([
                ...ROLE_PERMISSIONS[ROLES.VIEWER],
                ...ROLE_PERMISSIONS[ROLES.EDITOR]
            ]);
            expect(permissions.length).toBe(uniquePermissions.size);
        });
    });

    describe('validateRole()', () => {
        it('should return true for valid roles', () => {
            expect(validateRole(ROLES.ADMIN)).toBe(true);
            expect(validateRole(ROLES.EDITOR)).toBe(true);
            expect(validateRole(ROLES.VIEWER)).toBe(true);
        });

        it('should return false for invalid roles', () => {
            expect(validateRole('invalid-role')).toBe(false);
            expect(validateRole('')).toBe(false);
            expect(validateRole(undefined)).toBe(false);
        });
    });
}); 