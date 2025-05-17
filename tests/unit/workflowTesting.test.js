/**
 * Unit tests for workflow testing tools
 */

const { testWorkflowTool, getExecutionStatusTool } = require('../../src/tools/workflowTesting');
const { workflowStorage } = require('../../src/models/storage');
const fetch = require('node-fetch');
const config = require('../../config/default');

// Mock dependencies
jest.mock('../../src/models/storage');
jest.mock('node-fetch');
jest.mock('../../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }
}));
jest.mock('../../src/utils/securityLogger', () => ({
    logDataAccess: jest.fn(),
    logSecurityEvent: jest.fn()
}));
jest.mock('../../src/models/n8nIntegration', () => ({
    getIntegrationType: jest.fn().mockReturnValue('api')
}));
jest.mock('../../config/default', () => ({
    n8n: {
        apiUrl: 'http://localhost:5678/api/',
        apiKey: 'test-api-key'
    }
}));

describe('Workflow Testing Tools', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('testWorkflowTool', () => {
        it('should execute a workflow and return results', async () => {
            // Mock workflowStorage.loadWorkflow to return a valid workflow
            workflowStorage.loadWorkflow.mockResolvedValueOnce({
                id: 'test-workflow-id',
                name: 'Test Workflow'
            });

            // Mock successful fetch response
            const mockResponse = {
                ok: true,
                json: jest.fn().mockResolvedValueOnce({
                    executionId: 'test-execution-id',
                    data: { result: 'success' },
                    logs: ['Workflow started', 'Workflow completed'],
                    executionTime: 1234,
                    status: 'completed'
                })
            };
            fetch.mockResolvedValueOnce(mockResponse);

            // Call the tool
            const result = await testWorkflowTool.execute({
                workflowId: 'test-workflow-id',
                testData: { input: 'test-data' }
            });

            // Verify fetch was called with the correct arguments
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:5678/api/workflows/test-workflow-id/execute',
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-N8N-API-KEY': 'test-api-key'
                    },
                    body: JSON.stringify({ data: { input: 'test-data' } })
                })
            );

            // Verify result structure
            expect(result).toEqual({
                success: true,
                executionId: 'test-execution-id',
                data: { result: 'success' },
                logs: ['Workflow started', 'Workflow completed'],
                executionTime: 1234,
                status: 'completed'
            });
        });

        it('should handle workflow not found', async () => {
            // Mock workflowStorage.loadWorkflow to return null (workflow not found)
            workflowStorage.loadWorkflow.mockResolvedValueOnce(null);

            // Call the tool and expect it to throw an error
            await expect(testWorkflowTool.execute({
                workflowId: 'non-existent-workflow',
                testData: { input: 'test-data' }
            })).rejects.toThrow('Failed to execute workflow: Workflow with ID non-existent-workflow not found');

            // Verify fetch was not called
            expect(fetch).not.toHaveBeenCalled();
        });

        it('should handle API errors', async () => {
            // Mock workflowStorage.loadWorkflow to return a valid workflow
            workflowStorage.loadWorkflow.mockResolvedValueOnce({
                id: 'test-workflow-id',
                name: 'Test Workflow'
            });

            // Mock failed fetch response
            const mockResponse = {
                ok: false,
                status: 404,
                statusText: 'Not Found',
                json: jest.fn().mockResolvedValueOnce({
                    message: 'Workflow not found in n8n'
                })
            };
            fetch.mockResolvedValueOnce(mockResponse);

            // Call the tool and expect it to throw an error
            await expect(testWorkflowTool.execute({
                workflowId: 'test-workflow-id',
                testData: { input: 'test-data' }
            })).rejects.toThrow('Failed to execute workflow: 404 Not Found');
        });

        it('should handle timeouts', async () => {
            // Mock AbortError
            jest.useFakeTimers();

            // Mock workflowStorage.loadWorkflow to return a valid workflow
            workflowStorage.loadWorkflow.mockResolvedValueOnce({
                id: 'test-workflow-id',
                name: 'Test Workflow'
            });

            // Mock fetch to never resolve (simulating a long request)
            const fetchPromise = new Promise((resolve) => {
                // This promise is intentionally never resolved to simulate hanging request
            });
            fetch.mockReturnValueOnce(fetchPromise);

            // Start the execution with a short timeout
            const executionPromise = testWorkflowTool.execute({
                workflowId: 'test-workflow-id',
                testData: { input: 'test-data' },
                timeout: 1000 // 1 second timeout
            });

            // Fast-forward time to trigger the abort
            jest.advanceTimersByTime(1100);

            // Mock the AbortError that would be thrown by fetch when aborted
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            fetch.mockRejectedValueOnce(abortError);

            // Call the tool and expect it to throw a timeout error
            await expect(executionPromise).rejects.toThrow('Failed to execute workflow: Workflow execution timed out after 1000ms');

            // Clean up
            jest.useRealTimers();
        });

        it('should reject filesystem integration for execution', async () => {
            // Mock getIntegrationType to return 'filesystem'
            const { getIntegrationType } = require('../../src/models/n8nIntegration');
            getIntegrationType.mockReturnValueOnce('filesystem');

            // Mock workflowStorage.loadWorkflow to return a valid workflow
            workflowStorage.loadWorkflow.mockResolvedValueOnce({
                id: 'test-workflow-id',
                name: 'Test Workflow'
            });

            // Call the tool and expect it to throw an error about filesystem integration
            await expect(testWorkflowTool.execute({
                workflowId: 'test-workflow-id',
                testData: { input: 'test-data' }
            })).rejects.toThrow('Failed to execute workflow: Direct workflow execution not supported for filesystem integration');

            // Verify fetch was not called
            expect(fetch).not.toHaveBeenCalled();
        });
    });

    describe('getExecutionStatusTool', () => {
        it('should get execution status successfully', async () => {
            // Mock successful fetch response
            const mockResponse = {
                ok: true,
                json: jest.fn().mockResolvedValueOnce({
                    id: 'test-execution-id',
                    status: 'completed',
                    data: { result: 'success' },
                    startedAt: '2023-01-01T00:00:00.000Z',
                    finishedAt: '2023-01-01T00:01:00.000Z',
                    workflowId: 'test-workflow-id',
                    mode: 'manual'
                })
            };
            fetch.mockResolvedValueOnce(mockResponse);

            // Call the tool
            const result = await getExecutionStatusTool.execute({
                executionId: 'test-execution-id'
            });

            // Verify fetch was called with the correct arguments
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:5678/api/executions/test-execution-id',
                expect.objectContaining({
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-N8N-API-KEY': 'test-api-key'
                    }
                })
            );

            // Verify result structure
            expect(result).toEqual({
                success: true,
                executionId: 'test-execution-id',
                status: 'completed',
                data: { result: 'success' },
                startedAt: '2023-01-01T00:00:00.000Z',
                finishedAt: '2023-01-01T00:01:00.000Z',
                workflowId: 'test-workflow-id',
                mode: 'manual'
            });
        });

        it('should handle API errors', async () => {
            // Mock failed fetch response
            const mockResponse = {
                ok: false,
                status: 404,
                statusText: 'Not Found',
                json: jest.fn().mockResolvedValueOnce({
                    message: 'Execution not found'
                })
            };
            fetch.mockResolvedValueOnce(mockResponse);

            // Call the tool and expect it to throw an error
            await expect(getExecutionStatusTool.execute({
                executionId: 'non-existent-execution'
            })).rejects.toThrow('Failed to get execution status: 404 Not Found');
        });

        it('should reject filesystem integration for status check', async () => {
            // Mock getIntegrationType to return 'filesystem'
            const { getIntegrationType } = require('../../src/models/n8nIntegration');
            getIntegrationType.mockReturnValueOnce('filesystem');

            // Call the tool and expect it to throw an error about filesystem integration
            await expect(getExecutionStatusTool.execute({
                executionId: 'test-execution-id'
            })).rejects.toThrow('Failed to get execution status: Execution status check not supported for filesystem integration');

            // Verify fetch was not called
            expect(fetch).not.toHaveBeenCalled();
        });
    });
}); 