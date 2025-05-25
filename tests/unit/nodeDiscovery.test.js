/**
 * Unit tests for Node Discovery Tool
 */

const fs = require('fs').promises;
const path = require('path');
const nodeDiscovery = require('../../src/tools/nodeDiscovery');
const {
    searchNodes,
    scanWorkflowNodes,
    getNodesFromSource,
    sanitizeCredentialParameters
} = nodeDiscovery;

// Mock dependencies
jest.mock('fs', () => ({
    promises: {
        readdir: jest.fn(),
        readFile: jest.fn()
    }
}));

jest.mock('../../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }
}));

describe('Node Discovery Tool', () => {
    // Sample test data
    const mockNodes = [
        {
            id: 'http',
            name: 'HTTP Request',
            description: 'Make HTTP requests',
            parameters: [
                { name: 'url', type: 'string', value: '', isCredential: false },
                { name: 'method', type: 'string', value: 'GET', isCredential: false }
            ],
            categories: ['HTTP'],
            type: 'n8n-nodes-base.http',
            originalNodeType: 'n8n-nodes-base.http',
            normalizedType: 'http'
        },
        {
            id: 'telegram',
            name: 'Telegram',
            description: 'Send messages via Telegram',
            parameters: [
                { name: 'message', type: 'string', value: '', isCredential: false },
                { name: 'token', type: 'string', value: 'secret', isCredential: true }
            ],
            categories: ['Communication'],
            type: 'n8n-nodes-base.telegram',
            originalNodeType: 'n8n-nodes-base.telegram',
            normalizedType: 'telegram'
        }
    ];

    // Reset mocks before each test
    beforeEach(() => {
        jest.clearAllMocks();

        // Reset cache to avoid test interference
        if (nodeDiscovery.resetCache) {
            nodeDiscovery.resetCache();
        }
    });

    describe('scanWorkflowNodes', () => {
        it('should scan and parse workflow nodes directory', async () => {
            // Mock file system functions
            fs.readdir.mockResolvedValue([
                'telegram.json',
                'http.json',
                'other-file.txt'
            ]);

            // Mock file contents
            const telegramNode = {
                nodeType: 'n8n-nodes-base.telegram',
                nodes: [{
                    name: 'Telegram',
                    parameters: {
                        message: null,
                        chatId: '',
                        credentials: { token: 'secret' }
                    },
                    credentials: {}
                }]
            };

            const httpNode = {
                nodeType: 'n8n-nodes-base.http',
                nodes: [{
                    name: 'HTTP Request',
                    parameters: {
                        url: '',
                        method: 'GET'
                    }
                }]
            };

            fs.readFile.mockImplementation((filePath) => {
                if (filePath.includes('telegram')) {
                    return Promise.resolve(JSON.stringify(telegramNode));
                } else if (filePath.includes('http')) {
                    return Promise.resolve(JSON.stringify(httpNode));
                }
                return Promise.reject(new Error('File not found'));
            });

            // Execute the function
            const result = await scanWorkflowNodes();

            // Assertions
            expect(fs.readdir).toHaveBeenCalled();
            expect(fs.readFile).toHaveBeenCalledTimes(2);
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('telegram');
            expect(result[1].id).toBe('http');
        });

        it('should handle errors gracefully', async () => {
            // Mock readdir to fail
            fs.readdir.mockRejectedValue(new Error('Directory not found'));

            // Execute and expect rejection
            await expect(scanWorkflowNodes()).rejects.toThrow('Failed to scan workflow nodes');
        });
    });

    describe('searchNodes', () => {
        beforeEach(() => {
            // Reset cache to ensure fresh state
            if (nodeDiscovery.resetCache) {
                nodeDiscovery.resetCache();
            }

            // Mock file system functions for searchNodes tests
            fs.readdir.mockResolvedValue([
                'telegram.json',
                'http.json'
            ]);

            // Mock file contents
            const telegramNode = {
                nodeType: 'n8n-nodes-base.telegram',
                nodes: [{
                    name: 'Telegram',
                    parameters: {
                        message: null,
                        chatId: '',
                        credentials: { token: 'secret' }
                    },
                    credentials: {}
                }]
            };

            const httpNode = {
                nodeType: 'n8n-nodes-base.http',
                nodes: [{
                    name: 'HTTP Request',
                    parameters: {
                        url: '',
                        method: 'GET'
                    }
                }]
            };

            fs.readFile.mockImplementation((filePath) => {
                if (filePath.includes('telegram')) {
                    return Promise.resolve(JSON.stringify(telegramNode));
                } else if (filePath.includes('http')) {
                    return Promise.resolve(JSON.stringify(httpNode));
                }
                return Promise.reject(new Error('File not found'));
            });
        });

        it('should return all nodes when no filters are provided', async () => {
            const result = await searchNodes({});

            expect(result).toHaveProperty('count');
            expect(result).toHaveProperty('nodes');
            expect(result.count).toBe(2);
            expect(result.nodes).toHaveLength(2);
        });

        it('should filter nodes by category', async () => {
            const result = await searchNodes({ category: 'HTTP' });

            expect(result).toHaveProperty('count');
            expect(result).toHaveProperty('nodes');
            expect(result.count).toBe(1);
            expect(result.nodes[0].id).toBe('http');
        });

        it('should filter nodes by keyword', async () => {
            const result = await searchNodes({ keyword: 'telegram' });

            expect(result).toHaveProperty('count');
            expect(result).toHaveProperty('nodes');
            expect(result.count).toBe(1);
            expect(result.nodes[0].id).toBe('telegram');
        });

        it('should filter nodes by functionality', async () => {
            const result = await searchNodes({ functionality: 'message' });

            expect(result).toHaveProperty('count');
            expect(result).toHaveProperty('nodes');
            expect(result.count).toBe(1);
            expect(result.nodes[0].id).toBe('telegram');
        });

        it('should combine multiple filters', async () => {
            const result = await searchNodes({
                category: 'Communication',
                keyword: 'telegram'
            });

            expect(result).toHaveProperty('count');
            expect(result).toHaveProperty('nodes');
            expect(result.count).toBe(1);
            expect(result.nodes[0].id).toBe('telegram');
        });

        it('should sanitize credential parameters in the response', async () => {
            const result = await searchNodes({ keyword: 'telegram' });

            expect(result).toHaveProperty('count');
            expect(result).toHaveProperty('nodes');
            expect(result.count).toBe(1);

            const telegramNode = result.nodes[0];
            const credentialParam = telegramNode.parameters.find(p => p.isCredential);
            expect(credentialParam).toBeDefined();
            expect(credentialParam.value).toEqual({ credentialType: 'credentials' });
        });
    });

    describe('sanitizeCredentialParameters', () => {
        it('should sanitize credential parameters', () => {
            const params = [
                { name: 'url', type: 'string', value: 'https://example.com', isCredential: false },
                { name: 'apiKey', type: 'string', value: 'secret-key', isCredential: true },
                { name: 'credentials', type: 'object', value: { token: 'secret-token' }, isCredential: true }
            ];

            const result = sanitizeCredentialParameters(params);

            // Non-credential parameters should remain unchanged
            expect(result[0]).toEqual(params[0]);

            // Credential parameters should be sanitized
            expect(result[1].value).toEqual({ credentialType: 'apiKey' });
            expect(result[2].value).toEqual({ credentialType: 'credentials' });
        });

        it('should handle empty parameters array', () => {
            expect(sanitizeCredentialParameters([])).toEqual([]);
            expect(sanitizeCredentialParameters(null)).toEqual([]);
            expect(sanitizeCredentialParameters(undefined)).toEqual([]);
        });
    });
}); 