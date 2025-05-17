/**
 * Workflow Testing Tools
 * 
 * MCP tools for testing workflow execution and returning results.
 */

const { createTool } = require('../models/tool');
const { logger } = require('../utils/logger');
const { logDataAccess } = require('../utils/securityLogger');
const { workflowStorage } = require('../models/storage');
const config = require('../../config/default');
const fetch = require('node-fetch');
const { getIntegrationType } = require('../models/n8nIntegration');
const AbortController = require('abort-controller');

/**
 * Execute a workflow with test data and return the results
 * 
 * @param {Object} params - The execution parameters
 * @returns {Promise<Object>} The execution results
 */
const executeWorkflow = async (params) => {
    const { workflowId, testData, timeout = 60000 } = params;
    const integrationType = getIntegrationType();

    try {
        // Load workflow
        const workflow = await workflowStorage.loadWorkflow(workflowId);
        if (!workflow) {
            throw new Error(`Workflow with ID ${workflowId} not found`);
        }

        logger.info('Executing workflow test', {
            workflowId,
            integrationType,
            hasTestData: !!testData
        });

        if (integrationType === 'api') {
            // Create abort controller for timeout handling
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                // Execute via n8n API
                const response = await fetch(`${config.n8n.apiUrl}workflows/${workflowId}/execute`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-N8N-API-KEY': config.n8n.apiKey
                    },
                    body: JSON.stringify({ data: testData || {} }),
                    signal: controller.signal
                });

                // Clear the timeout since the request completed
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    logger.error('n8n API error during workflow execution', {
                        status: response.status,
                        error: errorData
                    });
                    throw new Error(`Failed to execute workflow: ${response.status} ${response.statusText}`);
                }

                const result = await response.json();

                // Log successful execution
                logDataAccess({
                    success: true,
                    dataType: 'workflow',
                    action: 'execute',
                    resourceId: workflowId,
                    details: { integrationType, executionId: result.executionId || 'unknown' }
                });

                return {
                    success: true,
                    executionId: result.executionId,
                    data: result.data,
                    logs: result.logs || [],
                    executionTime: result.executionTime || null,
                    status: result.status || 'completed'
                };
            } catch (error) {
                clearTimeout(timeoutId);

                if (error.name === 'AbortError') {
                    // Handle timeout error
                    logger.error('Workflow execution timed out', { workflowId, timeout });

                    // Log timeout
                    logDataAccess({
                        success: false,
                        dataType: 'workflow',
                        action: 'execute',
                        resourceId: workflowId,
                        reason: `Execution timed out after ${timeout}ms`
                    });

                    throw new Error(`Workflow execution timed out after ${timeout}ms`);
                }

                throw error;
            }
        } else if (integrationType === 'filesystem') {
            // For filesystem integration, we don't have a built-in way to execute
            logger.warn('Workflow execution not supported for filesystem integration', { workflowId });

            // Log the limitation
            logDataAccess({
                success: false,
                dataType: 'workflow',
                action: 'execute',
                resourceId: workflowId,
                reason: 'Direct workflow execution not supported for filesystem integration'
            });

            throw new Error('Direct workflow execution not supported for filesystem integration. Please use the n8n API integration type.');
        } else {
            throw new Error('Invalid integration type');
        }
    } catch (error) {
        logger.error('Failed to execute workflow', {
            workflowId,
            error: error.message
        });

        // Log the failed operation (if not already logged)
        if (error.message !== 'Direct workflow execution not supported for filesystem integration. Please use the n8n API integration type.') {
            logDataAccess({
                success: false,
                dataType: 'workflow',
                action: 'execute',
                resourceId: workflowId,
                reason: error.message
            });
        }

        throw new Error(`Failed to execute workflow: ${error.message}`);
    }
};

/**
 * Get the execution status of a workflow execution
 * 
 * @param {Object} params - The status parameters
 * @returns {Promise<Object>} The execution status
 */
const getExecutionStatus = async (params) => {
    const { executionId } = params;
    const integrationType = getIntegrationType();

    try {
        logger.info('Getting workflow execution status', {
            executionId,
            integrationType
        });

        if (integrationType === 'api') {
            // Execute via n8n API
            const response = await fetch(`${config.n8n.apiUrl}executions/${executionId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-N8N-API-KEY': config.n8n.apiKey
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                logger.error('n8n API error during execution status check', {
                    status: response.status,
                    error: errorData
                });
                throw new Error(`Failed to get execution status: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();

            // Log successful status check
            logDataAccess({
                success: true,
                dataType: 'execution',
                action: 'get-status',
                resourceId: executionId
            });

            return {
                success: true,
                executionId: result.id,
                status: result.status,
                data: result.data,
                startedAt: result.startedAt,
                finishedAt: result.finishedAt,
                workflowId: result.workflowId,
                mode: result.mode
            };
        } else if (integrationType === 'filesystem') {
            // For filesystem integration, we don't have a built-in way to check execution status
            logger.warn('Execution status check not supported for filesystem integration', { executionId });

            // Log the limitation
            logDataAccess({
                success: false,
                dataType: 'execution',
                action: 'get-status',
                resourceId: executionId,
                reason: 'Execution status check not supported for filesystem integration'
            });

            throw new Error('Execution status check not supported for filesystem integration. Please use the n8n API integration type.');
        } else {
            throw new Error('Invalid integration type');
        }
    } catch (error) {
        logger.error('Failed to get execution status', {
            executionId,
            error: error.message
        });

        // Log the failed operation (if not already logged)
        if (error.message !== 'Execution status check not supported for filesystem integration. Please use the n8n API integration type.') {
            logDataAccess({
                success: false,
                dataType: 'execution',
                action: 'get-status',
                resourceId: executionId,
                reason: error.message
            });
        }

        throw new Error(`Failed to get execution status: ${error.message}`);
    }
};

// Create and export the MCP tools
const testWorkflowTool = createTool(
    'Test a workflow by executing it and returning results',
    {
        workflowId: {
            type: 'string',
            description: 'ID of the workflow to execute'
        },
        testData: {
            type: 'object',
            description: 'Test data to use for the execution',
            optional: true
        },
        timeout: {
            type: 'number',
            description: 'Timeout in milliseconds for the execution (default: 60000)',
            optional: true
        },
        userId: {
            type: 'string',
            description: 'ID of the user executing the workflow for logging purposes',
            optional: true
        }
    },
    executeWorkflow
);

const getExecutionStatusTool = createTool(
    'Get the status of a workflow execution',
    {
        executionId: {
            type: 'string',
            description: 'ID of the execution to check'
        },
        userId: {
            type: 'string',
            description: 'ID of the user checking the execution for logging purposes',
            optional: true
        }
    },
    getExecutionStatus
);

module.exports = {
    testWorkflowTool,
    getExecutionStatusTool
}; 