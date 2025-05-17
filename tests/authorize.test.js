/**
 * Authorization Middleware Tests
 * 
 * Tests for the role-based authorization middleware
 */

const {
    authorize,
    authorizeWorkflow,
    authorizeNode,
    authorizeConnection,
    authorizeCredential,
    authorizeAdmin
} = require('../src/middleware/authorize');
const { PERMISSIONS, ROLES } = require('../src/models/user');
const { createErrorResponse } = require('../src/utils/mcp');
const { logger } = require('../src/utils/logger');

// Mock dependencies
jest.mock('../src/utils/mcp', () => ({
    createErrorResponse: jest.fn((message, code, status) => ({
        error: { message, code },
        status
    }))
}));

jest.mock('../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn()
    }
}));

describe('Authorization Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Mock Express request, response, and next function
        req = {
            auth: null,
            user: null
        };

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };

        next = jest.fn();
    });

    describe('authorize()', () => {
        it('should return 401 if no auth data is available', () => {
            req.auth = null;
            const middleware = authorize(PERMISSIONS.WORKFLOW_VIEW);

            middleware(req, res, next);

            expect(createErrorResponse).toHaveBeenCalledWith(
                'Authorization requires authentication',
                'AUTHENTICATION_REQUIRED',
                401
            );
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
        });

        it('should automatically assign admin role for API key auth', () => {
            req.auth = { type: 'apikey', key: 'test-api-key' };
            const middleware = authorize(PERMISSIONS.SYSTEM_ADMIN);

            middleware(req, res, next);

            expect(req.user).toEqual({ roles: ['admin'] });
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should return 403 if JWT user has no roles', () => {
            req.auth = { type: 'jwt', user: { id: 'user123' } };
            const middleware = authorize(PERMISSIONS.WORKFLOW_VIEW);

            middleware(req, res, next);

            expect(createErrorResponse).toHaveBeenCalledWith(
                'User has no defined roles',
                'MISSING_ROLES',
                403
            );
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
        });

        it('should pass middleware if permission is not required', () => {
            req.auth = {
                type: 'jwt',
                user: {
                    id: 'user123',
                    roles: [ROLES.VIEWER]
                }
            };
            const middleware = authorize(); // No permission required

            middleware(req, res, next);

            expect(req.user).toEqual(req.auth.user);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should pass middleware if user has required permission', () => {
            req.auth = {
                type: 'jwt',
                user: {
                    id: 'user123',
                    roles: [ROLES.VIEWER]
                }
            };
            const middleware = authorize(PERMISSIONS.WORKFLOW_VIEW);

            middleware(req, res, next);

            expect(req.user).toEqual(req.auth.user);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should return 403 if user lacks required permission', () => {
            req.auth = {
                type: 'jwt',
                user: {
                    id: 'user123',
                    roles: [ROLES.VIEWER]
                }
            };
            const middleware = authorize(PERMISSIONS.WORKFLOW_EDIT);

            middleware(req, res, next);

            expect(logger.warn).toHaveBeenCalled();
            expect(createErrorResponse).toHaveBeenCalledWith(
                'You don\'t have permission to perform this action',
                'PERMISSION_DENIED',
                403
            );
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
        });

        it('should return 401 for unsupported auth type', () => {
            req.auth = { type: 'unsupported' };
            const middleware = authorize(PERMISSIONS.WORKFLOW_VIEW);

            middleware(req, res, next);

            expect(createErrorResponse).toHaveBeenCalledWith(
                'Unsupported authentication type',
                'UNSUPPORTED_AUTH_TYPE',
                401
            );
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('Resource-specific authorization middlewares', () => {
        it('should have workflow authorization middlewares with correct permissions', () => {
            expect(authorizeWorkflow.view).toBeDefined();
            expect(authorizeWorkflow.create).toBeDefined();
            expect(authorizeWorkflow.edit).toBeDefined();
            expect(authorizeWorkflow.delete).toBeDefined();
            expect(authorizeWorkflow.execute).toBeDefined();
        });

        it('should have node authorization middlewares with correct permissions', () => {
            expect(authorizeNode.view).toBeDefined();
            expect(authorizeNode.add).toBeDefined();
            expect(authorizeNode.edit).toBeDefined();
            expect(authorizeNode.delete).toBeDefined();
        });

        it('should have connection authorization middlewares with correct permissions', () => {
            expect(authorizeConnection.view).toBeDefined();
            expect(authorizeConnection.create).toBeDefined();
            expect(authorizeConnection.delete).toBeDefined();
        });

        it('should have credential authorization middlewares with correct permissions', () => {
            expect(authorizeCredential.view).toBeDefined();
            expect(authorizeCredential.create).toBeDefined();
            expect(authorizeCredential.edit).toBeDefined();
            expect(authorizeCredential.delete).toBeDefined();
        });

        it('should have admin authorization middleware', () => {
            expect(authorizeAdmin).toBeDefined();
        });
    });
}); 