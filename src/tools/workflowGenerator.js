/**
 * Workflow Generator Tool
 * 
 * Converts natural language descriptions into complete n8n workflow JSON.
 * Uses LLM to generate nodes and connections based on the workflow description.
 */

const { createTool } = require('../models/tool');
const { logger } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../config/default');
const { workflowStorage } = require('../models/storage');
const { logDataAccess } = require('../utils/securityLogger');
const { generateWorkflow } = require('../models/llmService');

/**
 * Generate an n8n workflow JSON based on a natural language description
 * 
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>} Generated workflow data and file path
 */
const generateWorkflowExecute = async (params) => {
    try {
        const { description, name, savePath, userId, llmProvider, copyToClipboard } = params;

        logger.info('Generating workflow from description', {
            name: name || 'Unnamed Workflow',
            descriptionLength: description.length,
            llmProvider: llmProvider || 'default'
        });

        // Create workflow structure
        const workflow = {
            name: name || `Generated Workflow ${new Date().toISOString().split('T')[0]}`,
            active: false,
            nodes: [],
            connections: {},
            settings: {
                executionOrder: 'v1', // Standard n8n execution order
                saveExecutionProgress: true,
                saveManualExecutions: true,
                saveDataErrorExecution: 'all',
                saveDataSuccessExecution: 'all',
                callerPolicy: 'workflowsFromSameOwner',
                errorWorkflow: ''
            },
            tags: [],
            pinData: {},
            id: `generated-workflow-${Date.now()}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Setup LLM options
        const llmOptions = {};
        if (llmProvider) {
            llmOptions.provider = llmProvider;
        }

        // Process description to generate nodes using LLM
        const generatedNodes = await generateWorkflow(description, llmOptions);
        workflow.nodes = generatedNodes.nodes;
        workflow.connections = generatedNodes.connections;

        // Add relevant tags based on the workflow purpose
        if (description.toLowerCase().includes('http') || description.toLowerCase().includes('api')) {
            workflow.tags.push({ name: 'API' });
        }
        if (description.toLowerCase().includes('automat')) {
            workflow.tags.push({ name: 'Automation' });
        }

        // Save workflow to file if path is provided
        let filePath;
        if (savePath) {
            filePath = savePath;
        } else {
            // Use default storage location
            filePath = path.join(config.storage.workflowsPath, `${workflow.id}.json`);
        }

        await workflowStorage.saveWorkflow(workflow.id, workflow, filePath);

        // Log the operation
        logDataAccess({
            success: true,
            userId: userId || 'anonymous',
            dataType: 'workflow',
            action: 'generate',
            resourceId: workflow.id,
            details: { nodeCount: workflow.nodes.length }
        });

        return {
            success: true,
            workflow,
            filePath,
            json: JSON.stringify(workflow, null, 2), // Pretty-printed JSON for easy copying
            message: `Workflow generated successfully from description and saved to ${filePath}`
        };
    } catch (error) {
        logger.error('Failed to generate workflow', { error: error.message });

        // Log the failed operation
        logDataAccess({
            success: false,
            userId: params.userId || 'anonymous',
            dataType: 'workflow',
            action: 'generate',
            reason: error.message
        });

        throw new Error(`Failed to generate workflow: ${error.message}`);
    }
};

// Define the generate workflow tool
const generateWorkflowTool = createTool(
    'Generate a complete n8n workflow from a natural language description',
    {
        description: {
            type: 'string',
            description: 'Natural language description of the workflow to generate'
        },
        name: {
            type: 'string',
            description: 'Name for the generated workflow',
            optional: true
        },
        savePath: {
            type: 'string',
            description: 'Path where the workflow JSON file should be saved',
            optional: true
        },
        llmProvider: {
            type: 'string',
            description: 'LLM provider to use (openai, anthropic)',
            optional: true
        },
        userId: {
            type: 'string',
            description: 'User identifier for security logging',
            optional: true
        }
    },
    generateWorkflowExecute
);

module.exports = {
    generateWorkflowTool
}; 