/**
 * Workflow Creation Tool Tests
 */

const { createWorkflowTool } = require('../../src/tools/workflowCreation');
const { WorkflowModel } = require('../../src/models/workflow');

// Mock dependencies
jest.mock('../../src/models/workflow', () => ({
    WorkflowModel: {
        create: jest.fn(),
        generateId: jest.fn().mockReturnValue('test-uuid')
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

// Cleanup mocks after each test
afterEach(() => {
    jest.clearAllMocks();
});

describe('Workflow Creation Tool', () => {
    it('should create a workflow with minimum required parameters', async () => {
        // Setup the mock implementation
        const mockWorkflow = {
            id: 'test-uuid',
            name: 'Test Workflow',
            description: '',
            nodes: [],
            connections: {},
            active: false
        };

        WorkflowModel.create.mockResolvedValue(mockWorkflow);

        // Execute the tool
        const result = await createWorkflowTool.execute({
            name: 'Test Workflow'
        });

        // Verify the result
        expect(result.data).toEqual({
            workflowId: 'test-uuid',
            workflowData: mockWorkflow
        });

        // Verify the WorkflowModel.create was called with correct parameters
        expect(WorkflowModel.create).toHaveBeenCalledWith({
            name: 'Test Workflow',
            description: undefined,
            active: false,
            settings: undefined
        });
    });

    it('should create a workflow with all parameters', async () => {
        // Setup the mock implementation
        const mockWorkflow = {
            id: 'test-uuid',
            name: 'Test Workflow',
            description: 'Test Description',
            nodes: [],
            connections: {},
            active: true,
            settings: {
                executionTimeout: 7200
            }
        };

        WorkflowModel.create.mockResolvedValue(mockWorkflow);

        // Execute the tool
        const result = await createWorkflowTool.execute({
            name: 'Test Workflow',
            description: 'Test Description',
            active: true,
            settings: {
                executionTimeout: 7200
            },
            userId: 'test-user'
        });

        // Verify the result
        expect(result.data).toEqual({
            workflowId: 'test-uuid',
            workflowData: mockWorkflow
        });

        // Verify the WorkflowModel.create was called with correct parameters
        expect(WorkflowModel.create).toHaveBeenCalledWith({
            name: 'Test Workflow',
            description: 'Test Description',
            active: true,
            settings: {
                executionTimeout: 7200
            }
        });
    });

    it('should handle errors properly', async () => {
        // Setup the mock implementation to throw an error
        const errorMessage = 'Test error message';
        WorkflowModel.create.mockRejectedValue(new Error(errorMessage));

        // Execute the tool and expect it to throw
        await expect(createWorkflowTool.execute({
            name: 'Test Workflow'
        })).rejects.toThrow(`Failed to create workflow: ${errorMessage}`);
    });
}); 