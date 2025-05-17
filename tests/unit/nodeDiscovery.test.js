/**
 * Unit tests for Node Discovery Tool
 */

const fs = require('fs').promises;
const path = require('path');
const {
    searchNodes,
    scanWorkflowNodes,
    getNodesFromSource,
    sanitizeCredentialParameters
} = require('../../src/tools/nodeDiscovery');

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
    // Reset mocks before each test
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('scanWorkflowNodes', () => {
        it('should scan and parse workflow nodes directory', async () => {
            // Mock file system functions
            fs.readdir.mockResolvedValue([
                'n8n-nodes-base.telegram.json',
                'n8n-nodes-base.http.json',
                'other-file.txt'
            ]);

            // Mock file contents
            const telegramNode = {
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
        // Mock nodes data
        const mockNodes = [
            {
                id: 'telegram',
                name: 'Telegram',
                description: 'Send or receive messages with Telegram',
                categories: ['Communication', 'Trigger'],
                parameters: [
                    { name: 'message', type: 'string', value: null, isCredential: false },
                    { name: 'credentials', type: 'object', value: { type: 'credential' }, isCredential: true }
                ]
            },
            {
                id: 'http',
                name: 'HTTP Request',
                description: 'Make HTTP requests to HTTP API',
                categories: ['HTTP'],
                parameters: [
                    { name: 'url', type: 'string', value: '', isCredential: false },
                    { name: 'method', type: 'string', value: 'GET', isCredential: false }
                ]
            },
            {
                id: 'mysql',
                name: 'MySQL',
                description: 'Interact with MySQL database',
                categories: ['Database'],
                parameters: [
                    { name: 'operation', type: 'string', value: '', isCredential: false },
                    { name: 'credentials', type: 'object', value: { type: 'credential' }, isCredential: true }
                ]
            }
        ];

        // Mock getNodesFromSource to return our test data
        beforeEach(() => {
            jest.spyOn(global, 'getNodesFromSource').mockImplementation(() => Promise.resolve(mockNodes));
        });

        afterEach(() => {
            if (global.getNodesFromSource.mockRestore) {
                global.getNodesFromSource.mockRestore();
            }
        });

        it('should return all nodes when no filters are provided', async () => {
            const result = await searchNodes({});
            expect(result.count).toBe(3);
            expect(result.nodes).toHaveLength(3);
        });

        it('should filter nodes by category', async () => {
            const result = await searchNodes({ category: 'database' });
            expect(result.count).toBe(1);
            expect(result.nodes[0].id).toBe('mysql');
        });

        it('should filter nodes by keyword', async () => {
            const result = await searchNodes({ keyword: 'telegram' });
            expect(result.count).toBe(1);
            expect(result.nodes[0].id).toBe('telegram');
        });

        it('should filter nodes by functionality', async () => {
            const result = await searchNodes({ functionality: 'http' });
            expect(result.count).toBe(1);
            expect(result.nodes[0].id).toBe('http');
        });

        it('should combine multiple filters', async () => {
            // This should return no nodes since there's no match for both filters
            const result = await searchNodes({
                category: 'database',
                keyword: 'telegram'
            });
            expect(result.count).toBe(0);
            expect(result.nodes).toHaveLength(0);
        });

        it('should sanitize credential parameters in the response', async () => {
            const result = await searchNodes({ category: 'communication' });
            expect(result.nodes[0].parameters.some(p => p.name === 'credentials')).toBe(true);
            const credParam = result.nodes[0].parameters.find(p => p.name === 'credentials');
            expect(credParam.value).toHaveProperty('credentialType');
            expect(credParam.value).not.toHaveProperty('token');
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