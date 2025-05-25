/**
 * Workflow Creation Tool Tests
 */

const { createWorkflowExecute } = require('../../src/tools/workflowCreation');
const { workflowStorage } = require('../../src/models/storage');

// Mock dependencies
jest.mock('../../src/models/storage', () => ({
    workflowStorage: {
        saveWorkflow: jest.fn()
    }
}));

jest.mock('../../src/utils/securityLogger', () => ({
    logDataAccess: jest.fn(),
    logSecurityEvent: jest.fn()
}));

jest.mock('../../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn()
    }
}));

jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('test-uuid')
}));

// Cleanup mocks after each test
afterEach(() => {
    jest.clearAllMocks();
});

describe('Workflow Creation Tool', () => {
    it('should create a workflow with minimum required parameters', async () => {
        // Setup the mock implementation
        workflowStorage.saveWorkflow.mockResolvedValue(true);

        // Execute the tool
        const result = await createWorkflowExecute({
            name: 'Test Workflow'
        });

        // Verify the result
        expect(result.workflowId).toBe('test-uuid');
        expect(result.workflowData.name).toBe('Test Workflow');
        expect(result.workflowData.description).toBe('');
        expect(result.workflowData.active).toBe(false);
        expect(result.workflowData.nodes).toEqual([]);
        expect(result.workflowData.connections).toEqual({});

        // Verify the workflowStorage.saveWorkflow was called
        expect(workflowStorage.saveWorkflow).toHaveBeenCalledWith(
            'test-uuid',
            expect.objectContaining({
                id: 'test-uuid',
                name: 'Test Workflow'
            }),
            expect.stringContaining('test-uuid.json')
        );
    });

    it('should create a workflow with all parameters', async () => {
        // Setup the mock implementation
        workflowStorage.saveWorkflow.mockResolvedValue(true);

        // Execute the tool
        const result = await createWorkflowExecute({
            name: 'Test Workflow',
            description: 'Test Description',
            active: true,
            settings: {
                executionTimeout: 7200
            },
            userId: 'test-user'
        });

        // Verify the result
        expect(result.workflowId).toBe('test-uuid');
        expect(result.workflowData.name).toBe('Test Workflow');
        expect(result.workflowData.description).toBe('Test Description');
        expect(result.workflowData.active).toBe(true);
        expect(result.workflowData.settings.executionTimeout).toBe(7200);

        // Verify the workflowStorage.saveWorkflow was called
        expect(workflowStorage.saveWorkflow).toHaveBeenCalledWith(
            'test-uuid',
            expect.objectContaining({
                id: 'test-uuid',
                name: 'Test Workflow',
                description: 'Test Description',
                active: true
            }),
            expect.stringContaining('test-uuid.json')
        );
    });

    it('should handle errors properly', async () => {
        // Setup the mock implementation to throw an error
        const errorMessage = 'Test error message';
        workflowStorage.saveWorkflow.mockRejectedValue(new Error(errorMessage));

        // Execute the tool and expect it to throw
        await expect(createWorkflowExecute({
            name: 'Test Workflow'
        })).rejects.toThrow(errorMessage);
    });
}); 