/**
 * Unit tests for the n8n integration module
 */

const path = require('path');
const fs = require('fs').promises;
const { n8nIntegration, getIntegrationType } = require('../../src/models/n8nIntegration');

// Mock dependencies
jest.mock('../../config/default', () => ({
    n8n: {
        apiUrl: 'http://test-n8n-api.local/api/',
        apiKey: 'test-api-key',
        workflowsPath: './test-n8n-workflows',
        integrationType: 'auto'
    },
    storage: {
        workflowsPath: './test-workflows'
    }
}));

jest.mock('fs', () => {
    const originalModule = jest.requireActual('fs');
    return {
        ...originalModule,
        promises: {
            mkdir: jest.fn().mockResolvedValue(undefined),
            writeFile: jest.fn().mockResolvedValue(undefined),
            readFile: jest.fn(),
            readdir: jest.fn(),
            unlink: jest.fn(),
            access: jest.fn()
        }
    };
});

jest.mock('node-fetch');
const fetch = require('node-fetch');

// Mock logger to silence output during tests
jest.mock('../../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }
}));

// Mock workflowStorage to isolate n8n integration
jest.mock('../../src/models/storage', () => ({
    workflowStorage: {
        loadWorkflow: jest.fn()
    },
    DEFAULT_WORKFLOWS_DIR: './test-workflows'
}));

const { workflowStorage } = require('../../src/models/storage');

describe('n8n Integration', () => {
    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
    });

    describe('getIntegrationType', () => {
        it('should return "api" if API key is configured and integrationType is "auto"', () => {
            // Using the mocked config with API key
            const type = getIntegrationType();
            expect(type).toBe('api');
        });

        it('should return "filesystem" if API key is not configured and integrationType is "auto"', () => {
            // Temporarily modify the mock to test without API key
            const config = require('../../config/default');
            const originalApiKey = config.n8n.apiKey;
            config.n8n.apiKey = undefined;

            const type = getIntegrationType();
            expect(type).toBe('filesystem');

            // Restore the original config
            config.n8n.apiKey = originalApiKey;
        });

        it('should respect explicitly configured type regardless of API key', () => {
            const config = require('../../config/default');
            const originalType = config.n8n.integrationType;
            const originalApiKey = config.n8n.apiKey;

            // Test with filesystem type explicitly configured
            config.n8n.integrationType = 'filesystem';
            config.n8n.apiKey = 'test-api-key';
            expect(getIntegrationType()).toBe('filesystem');

            // Test with api type explicitly configured
            config.n8n.integrationType = 'api';
            config.n8n.apiKey = undefined;
            expect(getIntegrationType()).toBe('api');

            // Restore original values
            config.n8n.integrationType = originalType;
            config.n8n.apiKey = originalApiKey;
        });
    });

    describe('deployWorkflow', () => {
        const testWorkflow = {
            id: 'test-workflow',
            name: 'Test Workflow',
            nodes: [],
            connections: {}
        };

        beforeEach(() => {
            workflowStorage.loadWorkflow.mockResolvedValue(testWorkflow);
        });

        it('should deploy workflow via API', async () => {
            // Mock successful API response
            fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ id: 'n8n-workflow-123' })
            });

            const result = await n8nIntegration.deployWorkflow('test-workflow');

            expect(fetch).toHaveBeenCalledWith('http://test-n8n-api.local/api/workflows', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-N8N-API-KEY': 'test-api-key'
                },
                body: JSON.stringify(testWorkflow)
            });

            expect(result).toEqual({
                success: true,
                id: 'n8n-workflow-123',
                message: 'Workflow deployed successfully via API',
                n8nId: 'n8n-workflow-123'
            });
        });

        it('should handle API errors during deployment', async () => {
            // Mock failed API response
            fetch.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                json: jest.fn().mockResolvedValue({ message: 'Invalid API key' })
            });

            await expect(n8nIntegration.deployWorkflow('test-workflow')).rejects.toThrow(
                'Failed to deploy workflow: 401 Unauthorized'
            );
        });

        it('should deploy workflow via filesystem', async () => {
            // Test filesystem integration
            const config = require('../../config/default');
            const originalApiKey = config.n8n.apiKey;
            config.n8n.apiKey = undefined;

            const result = await n8nIntegration.deployWorkflow('test-workflow');

            expect(fs.promises.mkdir).toHaveBeenCalledWith(expect.stringContaining('test-n8n-workflows'), { recursive: true });
            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('test-workflow.json'),
                JSON.stringify(testWorkflow, null, 2)
            );

            expect(result).toEqual({
                success: true,
                id: 'test-workflow',
                path: expect.stringContaining('test-workflow.json'),
                message: 'Workflow deployed successfully via filesystem'
            });

            // Restore original value
            config.n8n.apiKey = originalApiKey;
        });

        it('should throw error if workflow not found', async () => {
            workflowStorage.loadWorkflow.mockResolvedValue(null);

            await expect(n8nIntegration.deployWorkflow('non-existent')).rejects.toThrow(
                'Failed to deploy workflow: Workflow with ID/path non-existent not found'
            );
        });
    });

    describe('activateWorkflow', () => {
        const testWorkflow = {
            id: 'test-workflow',
            name: 'Test Workflow',
            active: false,
            nodes: [],
            connections: {}
        };

        beforeEach(() => {
            workflowStorage.loadWorkflow.mockResolvedValue({ ...testWorkflow });
        });

        it('should activate workflow via API', async () => {
            // Mock successful API response
            fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ id: 'test-workflow', active: true })
            });

            const result = await n8nIntegration.activateWorkflow('test-workflow', true);

            expect(fetch).toHaveBeenCalledWith('http://test-n8n-api.local/api/workflows/test-workflow/activate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-N8N-API-KEY': 'test-api-key'
                },
                body: JSON.stringify({ active: true })
            });

            expect(result).toEqual({
                success: true,
                id: 'test-workflow',
                active: true,
                message: 'Workflow activated successfully'
            });
        });

        it('should deactivate workflow via API when activate=false', async () => {
            // Mock successful API response
            fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ id: 'test-workflow', active: false })
            });

            const result = await n8nIntegration.activateWorkflow('test-workflow', false);

            expect(fetch).toHaveBeenCalledWith('http://test-n8n-api.local/api/workflows/test-workflow/activate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-N8N-API-KEY': 'test-api-key'
                },
                body: JSON.stringify({ active: false })
            });

            expect(result).toEqual({
                success: true,
                id: 'test-workflow',
                active: false,
                message: 'Workflow deactivated successfully'
            });
        });

        it('should activate workflow via filesystem', async () => {
            // Test filesystem integration
            const config = require('../../config/default');
            const originalApiKey = config.n8n.apiKey;
            config.n8n.apiKey = undefined;

            // Mock filesystem access success for n8n workflows path
            fs.promises.access.mockResolvedValue(undefined);

            const result = await n8nIntegration.activateWorkflow('test-workflow', true);

            // Check that it updated both in original location and n8n directory
            expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('"active":true')
            );

            expect(result).toEqual({
                success: true,
                id: 'test-workflow',
                active: true,
                message: 'Workflow activated successfully'
            });

            // Restore original value
            config.n8n.apiKey = originalApiKey;
        });
    });

    // Additional tests for getWorkflow, checkExecutionStatus, and listWorkflows would follow the same pattern
}); 