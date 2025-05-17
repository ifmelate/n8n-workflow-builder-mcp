/**
 * Authentication Middleware Tests
 * 
 * Tests for the API key and JWT authentication middleware
 */

const jwt = require('jsonwebtoken');
const { authenticate, apiKeyAuth, jwtAuth, validateApiKey } = require('../src/middleware/auth');
const config = require('../config/default');
const { logger } = require('../src/utils/logger');

// Mock logger
jest.mock('../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn()
    }
}));

// Mock response and request objects
const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    return res;
};

// Mock next function
const mockNext = jest.fn();

// Original environment variables
const originalEnv = process.env;

describe('Authentication Middleware', () => {
    // Reset mocks and environment before each test
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
    });

    // Restore original environment after tests
    afterAll(() => {
        process.env = originalEnv;
    });

    describe('validateApiKey', () => {
        it('should validate API key from environment variables', () => {
            process.env.API_KEYS = 'key1,key2,key3';
            expect(validateApiKey('key1')).toBe(true);
            expect(validateApiKey('key2')).toBe(true);
            expect(validateApiKey('key3')).toBe(true);
            expect(validateApiKey('invalid-key')).toBe(false);
        });

        it('should validate API key from config if not in environment', () => {
            delete process.env.API_KEYS;
            // Mock the config API keys
            const originalApiKeys = config.auth.apiKeys;
            config.auth.apiKeys = ['config-key1', 'config-key2'];

            expect(validateApiKey('config-key1')).toBe(true);
            expect(validateApiKey('config-key2')).toBe(true);
            expect(validateApiKey('invalid-key')).toBe(false);

            // Restore original config
            config.auth.apiKeys = originalApiKeys;
        });
    });

    describe('apiKeyAuth', () => {
        it('should return 401 if API key is missing', () => {
            const req = { headers: {}, ip: '127.0.0.1' };
            const res = mockResponse();

            apiKeyAuth(req, res, mockNext);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'MISSING_API_KEY'
                })
            }));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should return 401 if API key is invalid', () => {
            const req = { headers: { 'x-api-key': 'invalid-key' }, ip: '127.0.0.1' };
            const res = mockResponse();

            process.env.API_KEYS = 'valid-key';

            apiKeyAuth(req, res, mockNext);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'INVALID_API_KEY'
                })
            }));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should call next and set auth info if API key is valid', () => {
            const validKey = 'valid-key';
            const req = { headers: { 'x-api-key': validKey }, ip: '127.0.0.1' };
            const res = mockResponse();

            process.env.API_KEYS = validKey;

            apiKeyAuth(req, res, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(req.auth).toEqual({
                type: 'apikey',
                key: validKey
            });
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should implement rate limiting after multiple failed attempts', () => {
            const req = { headers: { 'x-api-key': 'invalid-key' }, ip: '127.0.0.2' };
            const res = mockResponse();

            process.env.API_KEYS = 'valid-key';

            // Make 5 failed attempts
            for (let i = 0; i < 5; i++) {
                apiKeyAuth(req, res, mockNext);
                expect(res.status).toHaveBeenCalledWith(401);
                jest.clearAllMocks();
            }

            // Next attempt should be rate limited
            apiKeyAuth(req, res, mockNext);
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'RATE_LIMITED'
                })
            }));
        });
    });

    describe('jwtAuth', () => {
        it('should return 401 if authorization header is missing', () => {
            const req = { headers: {}, ip: '127.0.0.1' };
            const res = mockResponse();

            jwtAuth(req, res, mockNext);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'MISSING_JWT_TOKEN'
                })
            }));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should return 401 if authorization header format is invalid', () => {
            const req = { headers: { authorization: 'InvalidFormat token' }, ip: '127.0.0.1' };
            const res = mockResponse();

            jwtAuth(req, res, mockNext);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'MISSING_JWT_TOKEN'
                })
            }));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should return 401 if JWT token is invalid', () => {
            const req = { headers: { authorization: 'Bearer invalid-token' }, ip: '127.0.0.1' };
            const res = mockResponse();

            jwtAuth(req, res, mockNext);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'INVALID_JWT_TOKEN'
                })
            }));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should return 401 with specific error if JWT token is expired', () => {
            // Create an expired token
            const payload = { user: 'test-user', exp: Math.floor(Date.now() / 1000) - 3600 };
            const expiredToken = jwt.sign(payload, config.auth.jwtSecret);

            const req = { headers: { authorization: `Bearer ${expiredToken}` }, ip: '127.0.0.1' };
            const res = mockResponse();

            jwtAuth(req, res, mockNext);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'EXPIRED_JWT_TOKEN'
                })
            }));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should handle invalid JWT signatures with specific error code', () => {
            // Create a token with a different secret to cause signature failure
            const payload = { user: 'test-user' };
            const invalidToken = jwt.sign(payload, 'wrong-secret');

            const req = { headers: { authorization: `Bearer ${invalidToken}` }, ip: '127.0.0.1' };
            const res = mockResponse();

            jwtAuth(req, res, mockNext);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'INVALID_JWT_SIGNATURE'
                })
            }));
        });

        it('should handle malformed JWT tokens with specific error code', () => {
            const req = { headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiIsIn.INVALID.FORMAT' }, ip: '127.0.0.1' };
            const res = mockResponse();

            jwtAuth(req, res, mockNext);

            expect(res.status).toHaveBeenCalledWith(401);
            // May be either INVALID_JWT_TOKEN or MALFORMED_JWT_TOKEN depending on how jwt.verify handles it
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: expect.stringMatching(/INVALID_JWT_TOKEN|MALFORMED_JWT_TOKEN/)
                })
            }));
        });

        it('should call next and set auth info if JWT token is valid', () => {
            const userData = { id: 1, username: 'test-user' };
            const validToken = jwt.sign(userData, config.auth.jwtSecret);

            const req = { headers: { authorization: `Bearer ${validToken}` }, ip: '127.0.0.1' };
            const res = mockResponse();

            jwtAuth(req, res, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(req.auth).toEqual({
                type: 'jwt',
                user: expect.objectContaining(userData)
            });
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should implement rate limiting after multiple failed attempts', () => {
            const req = { headers: { authorization: 'Bearer invalid-token' }, ip: '127.0.0.3' };
            const res = mockResponse();

            // Make 5 failed attempts
            for (let i = 0; i < 5; i++) {
                jwtAuth(req, res, mockNext);
                expect(res.status).toHaveBeenCalledWith(401);
                jest.clearAllMocks();
            }

            // Next attempt should be rate limited
            jwtAuth(req, res, mockNext);
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'RATE_LIMITED'
                })
            }));
        });
    });

    describe('authenticate', () => {
        it('should add MCP version header to response', () => {
            const req = { headers: { 'x-api-key': 'valid-key' }, ip: '127.0.0.1' };
            const res = mockResponse();

            process.env.API_KEYS = 'valid-key';

            authenticate(req, res, mockNext);

            expect(res.setHeader).toHaveBeenCalledWith('X-MCP-Version', '1.0');
        });

        it('should skip authentication in development if configured', () => {
            const req = { headers: {} };
            const res = mockResponse();

            process.env.SKIP_AUTH = 'true';
            config.server.env = 'development';

            authenticate(req, res, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith('Authentication bypassed in development mode');
        });

        it('should use API key authentication when x-api-key header is present', () => {
            const validKey = 'valid-key';
            const req = { headers: { 'x-api-key': validKey }, ip: '127.0.0.1' };
            const res = mockResponse();

            process.env.API_KEYS = validKey;
            delete process.env.SKIP_AUTH;

            authenticate(req, res, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(req.auth).toEqual({
                type: 'apikey',
                key: validKey
            });
        });

        it('should use JWT authentication when authorization header is present', () => {
            const userData = { id: 1, username: 'test-user' };
            const validToken = jwt.sign(userData, config.auth.jwtSecret);

            const req = { headers: { authorization: `Bearer ${validToken}` }, ip: '127.0.0.1' };
            const res = mockResponse();

            delete process.env.SKIP_AUTH;

            authenticate(req, res, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(req.auth).toEqual({
                type: 'jwt',
                user: expect.objectContaining(userData)
            });
        });

        it('should return 401 if no authentication method is provided', () => {
            const req = { headers: {} };
            const res = mockResponse();

            delete process.env.SKIP_AUTH;
            config.server.env = 'production';

            authenticate(req, res, mockNext);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({
                    code: 'AUTHENTICATION_REQUIRED'
                })
            }));
            expect(mockNext).not.toHaveBeenCalled();
        });
    });
}); 