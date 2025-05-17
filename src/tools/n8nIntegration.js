/**
 * n8n Integration Tools
 * 
 * MCP tools for deploying, activating, retrieving, and managing workflows in n8n.
 */

const { createTool } = require('../models/tool');
const { n8nIntegration, getIntegrationType } = require('../models/n8nIntegration');
const { logger } = require('../utils/logger');
const { logDataAccess, logSecurityEvent } = require('../utils/securityLogger');

/**
 * Executes the deploy workflow operation
 * 
 * @param {Object} params - Tool parameters 
 * @returns {Promise<Object>} Operation result
 */
const deployWorkflowExecute = async (params) => {
    try {
        logger.info('Deploying workflow to n8n', {
            workflowIdOrPath: params.workflowIdOrPath
        });

        // Perform the deployment operation
        const result = await n8nIntegration.deployWorkflow(params.workflowIdOrPath);

        // Log the operation
        logDataAccess({
            success: true,
            userId: params.userId || 'anonymous',
            dataType: 'workflow',
            action: 'deploy',
            resourceId: params.workflowIdOrPath,
            details: { integrationType: getIntegrationType() }
        });

        return {
            success: true,
            ...result,
            message: result.message || 'Workflow deployed successfully'
        };
    } catch (error) {
        logger.error('Failed to deploy workflow', { error: error.message });

        // Log the failed operation
        logDataAccess({
            success: false,
            userId: params.userId || 'anonymous',
            dataType: 'workflow',
            action: 'deploy',
            resourceId: params.workflowIdOrPath || 'unknown',
            reason: error.message
        });

        throw new Error(`Failed to deploy workflow: ${error.message}`);
    }
};

/**
 * Executes the activate workflow operation
 * 
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>} Operation result
 */
const activateWorkflowExecute = async (params) => {
    try {
        const activate = params.activate !== false; // Default to true if not specified

        logger.info(`${activate ? 'Activating' : 'Deactivating'} workflow in n8n`, {
            workflowIdOrPath: params.workflowIdOrPath
        });

        // Perform the activation operation
        const result = await n8nIntegration.activateWorkflow(
            params.workflowIdOrPath,
            activate
        );

        // Log the operation
        logDataAccess({
            success: true,
            userId: params.userId || 'anonymous',
            dataType: 'workflow',
            action: activate ? 'activate' : 'deactivate',
            resourceId: params.workflowIdOrPath,
            details: { integrationType: getIntegrationType() }
        });

        return {
            success: true,
            ...result,
            message: result.message || `Workflow ${activate ? 'activated' : 'deactivated'} successfully`
        };
    } catch (error) {
        logger.error(`Failed to ${params.activate !== false ? 'activate' : 'deactivate'} workflow`, {
            error: error.message
        });

        // Log the failed operation
        logDataAccess({
            success: false,
            userId: params.userId || 'anonymous',
            dataType: 'workflow',
            action: params.activate !== false ? 'activate' : 'deactivate',
            resourceId: params.workflowIdOrPath || 'unknown',
            reason: error.message
        });

        throw new Error(`Failed to ${params.activate !== false ? 'activate' : 'deactivate'} workflow: ${error.message}`);
    }
};

/**
 * Executes the get workflow operation
 * 
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>} Operation result with workflow data
 */
const getWorkflowExecute = async (params) => {
    try {
        logger.info('Retrieving workflow from n8n', {
            workflowId: params.workflowId
        });

        // Perform the get operation
        const result = await n8nIntegration.getWorkflow(params.workflowId);

        // Log the operation
        logDataAccess({
            success: result.success,
            userId: params.userId || 'anonymous',
            dataType: 'workflow',
            action: 'get',
            resourceId: params.workflowId,
            details: { integrationType: getIntegrationType() }
        });

        return {
            ...result,
            message: result.message || (result.success ? 'Workflow retrieved successfully' : 'Workflow not found')
        };
    } catch (error) {
        logger.error('Failed to retrieve workflow from n8n', { error: error.message });

        // Log the failed operation
        logDataAccess({
            success: false,
            userId: params.userId || 'anonymous',
            dataType: 'workflow',
            action: 'get',
            resourceId: params.workflowId,
            reason: error.message
        });

        throw new Error(`Failed to retrieve workflow from n8n: ${error.message}`);
    }
};

/**
 * Executes the check execution status operation
 * 
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>} Operation result with execution status
 */
const checkExecutionStatusExecute = async (params) => {
    try {
        logger.info('Checking workflow execution status in n8n', {
            workflowId: params.workflowId
        });

        // Perform the status check operation
        const result = await n8nIntegration.checkExecutionStatus(params.workflowId);

        // Log the operation
        logDataAccess({
            success: result.success,
            userId: params.userId || 'anonymous',
            dataType: 'execution',
            action: 'status',
            resourceId: params.workflowId,
            details: { integrationType: getIntegrationType() }
        });

        return {
            ...result,
            message: result.message || 'Execution status retrieved successfully'
        };
    } catch (error) {
        logger.error('Failed to check workflow execution status', { error: error.message });

        // Log the failed operation
        logDataAccess({
            success: false,
            userId: params.userId || 'anonymous',
            dataType: 'execution',
            action: 'status',
            resourceId: params.workflowId,
            reason: error.message
        });

        throw new Error(`Failed to check workflow execution status: ${error.message}`);
    }
};

/**
 * Executes the list workflows operation
 * 
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>} Operation result with list of workflows
 */
const listWorkflowsExecute = async (params) => {
    try {
        logger.info('Listing workflows from n8n', {
            active: params.active,
            limit: params.limit,
            offset: params.offset
        });

        // Prepare options for listing
        const options = {
            active: params.active,
            limit: params.limit,
            offset: params.offset
        };

        // Perform the list operation
        const result = await n8nIntegration.listWorkflows(options);

        // Log the operation
        logDataAccess({
            success: result.success,
            userId: params.userId || 'anonymous',
            dataType: 'workflow',
            action: 'list',
            details: {
                integrationType: getIntegrationType(),
                count: result.count
            }
        });

        return {
            ...result,
            message: result.message || `Retrieved ${result.count || 0} workflows from n8n`
        };
    } catch (error) {
        logger.error('Failed to list workflows from n8n', { error: error.message });

        // Log the failed operation
        logDataAccess({
            success: false,
            userId: params.userId || 'anonymous',
            dataType: 'workflow',
            action: 'list',
            reason: error.message
        });

        throw new Error(`Failed to list workflows from n8n: ${error.message}`);
    }
};

// Define the deploy workflow tool
const deployWorkflowTool = createTool(
    'Deploy a workflow to n8n instance',
    {
        workflowIdOrPath: {
            type: 'string',
            description: 'ID or path of the workflow to deploy to n8n'
        },
        userId: {
            type: 'string',
            description: 'User identifier for security logging',
            optional: true
        }
    },
    deployWorkflowExecute
);

// Define the activate workflow tool
const activateWorkflowTool = createTool(
    'Activate or deactivate a workflow in n8n',
    {
        workflowIdOrPath: {
            type: 'string',
            description: 'ID or path of the workflow to activate/deactivate in n8n'
        },
        activate: {
            type: 'boolean',
            description: 'Whether to activate (true) or deactivate (false) the workflow',
            optional: true,
            default: true
        },
        userId: {
            type: 'string',
            description: 'User identifier for security logging',
            optional: true
        }
    },
    activateWorkflowExecute
);

// Define the get workflow tool
const getWorkflowTool = createTool(
    'Retrieve a workflow from n8n',
    {
        workflowId: {
            type: 'string',
            description: 'ID of the workflow to retrieve from n8n'
        },
        userId: {
            type: 'string',
            description: 'User identifier for security logging',
            optional: true
        }
    },
    getWorkflowExecute
);

// Define the check execution status tool
const checkExecutionStatusTool = createTool(
    'Check execution status of a workflow in n8n',
    {
        workflowId: {
            type: 'string',
            description: 'ID of the workflow to check execution status'
        },
        userId: {
            type: 'string',
            description: 'User identifier for security logging',
            optional: true
        }
    },
    checkExecutionStatusExecute
);

// Define the list workflows tool
const listWorkflowsTool = createTool(
    'List workflows from n8n',
    {
        active: {
            type: 'boolean',
            description: 'Filter workflows by active status',
            optional: true
        },
        limit: {
            type: 'number',
            description: 'Maximum number of workflows to return',
            optional: true
        },
        offset: {
            type: 'number',
            description: 'Number of workflows to skip',
            optional: true
        },
        userId: {
            type: 'string',
            description: 'User identifier for security logging',
            optional: true
        }
    },
    listWorkflowsExecute
);

module.exports = {
    // Export the tools
    deployWorkflowTool,
    activateWorkflowTool,
    getWorkflowTool,
    checkExecutionStatusTool,
    listWorkflowsTool
}; 