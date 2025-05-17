/**
 * Workflow Model
 * 
 * Data structure and validation for n8n workflows.
 */

const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

// Basic workflow schema (to be expanded in future tasks)
const workflowSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        nodes: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    type: { type: 'string' },
                    position: {
                        type: 'object',
                        properties: {
                            x: { type: 'number' },
                            y: { type: 'number' }
                        },
                        required: ['x', 'y']
                    },
                    parameters: { type: 'object' }
                },
                required: ['id', 'type', 'position']
            }
        },
        connections: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                additionalProperties: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            node: { type: 'string' },
                            type: { type: 'string' },
                            index: { type: 'integer' }
                        },
                        required: ['node', 'type', 'index']
                    }
                }
            }
        },
        active: { type: 'boolean' },
        settings: { type: 'object' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        versionId: { type: 'string' }
    },
    required: ['id', 'name', 'nodes', 'connections']
};

// Storage directory for workflow files
const WORKFLOWS_DIR = path.join(process.cwd(), 'workflow_nodes');

/**
 * Ensure the workflows directory exists
 */
const ensureWorkflowsDir = async () => {
    try {
        await fs.mkdir(WORKFLOWS_DIR, { recursive: true });
    } catch (error) {
        logger.error('Failed to create workflows directory', { error: error.message });
        throw error;
    }
};

// Ensure directory exists when module is loaded
ensureWorkflowsDir().catch(err => {
    logger.error('Critical error ensuring workflows directory', { error: err.message });
});

/**
 * Generate a unique workflow ID
 * 
 * @returns {string} UUID for the workflow
 */
const generateWorkflowId = () => {
    return uuidv4();
};

/**
 * Save a workflow to the filesystem
 * 
 * @param {string} id - Workflow ID
 * @param {Object} workflow - Workflow data to save
 * @returns {Promise<Object>} - Saved workflow data
 */
const saveWorkflow = async (id, workflow) => {
    try {
        const filePath = path.join(WORKFLOWS_DIR, `${id}.json`);
        await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
        logger.info(`Workflow saved: ${id}`);
        return workflow;
    } catch (error) {
        logger.error(`Failed to save workflow: ${id}`, { error: error.message });
        throw new Error(`Failed to save workflow: ${error.message}`);
    }
};

/**
 * Get a workflow by ID
 * 
 * @param {string} id - Workflow ID
 * @returns {Promise<Object>} - Workflow data
 */
const getWorkflow = async (id) => {
    try {
        const filePath = path.join(WORKFLOWS_DIR, `${id}.json`);
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error(`Failed to get workflow: ${id}`, { error: error.message });
        throw new Error(`Workflow not found: ${id}`);
    }
};

/**
 * List all workflows
 * 
 * @param {Object} options - List options (limit, offset)
 * @returns {Promise<Array>} - Array of workflow summaries
 */
const listWorkflows = async ({ limit = 10, offset = 0 } = {}) => {
    try {
        const files = await fs.readdir(WORKFLOWS_DIR);
        const workflowFiles = files.filter(file => file.endsWith('.json'));

        // Apply pagination
        const paginatedFiles = workflowFiles.slice(offset, offset + limit);

        // Read each workflow file for summary data
        const workflows = await Promise.all(
            paginatedFiles.map(async (file) => {
                try {
                    const data = await fs.readFile(path.join(WORKFLOWS_DIR, file), 'utf8');
                    const workflow = JSON.parse(data);

                    // Return just the summary data
                    return {
                        id: workflow.id,
                        name: workflow.name,
                        active: workflow.active || false,
                        nodeCount: workflow.nodes.length,
                        createdAt: workflow.createdAt,
                        updatedAt: workflow.updatedAt
                    };
                } catch (error) {
                    logger.error(`Error reading workflow file: ${file}`, { error: error.message });
                    return null;
                }
            })
        );

        // Filter out any null entries from failed reads
        return workflows.filter(workflow => workflow !== null);
    } catch (error) {
        logger.error('Failed to list workflows', { error: error.message });
        throw new Error(`Failed to list workflows: ${error.message}`);
    }
};

// Workflow model with unified methods
const WorkflowModel = {
    // Validate a workflow object against the schema
    validate: (workflow) => {
        // To be implemented with Ajv validation in future task
        return true;
    },

    // Create a new workflow
    create: async (workflowData) => {
        const id = workflowData.id || generateWorkflowId();
        const timestamp = new Date().toISOString();

        const workflow = {
            id,
            name: workflowData.name || 'Untitled Workflow',
            description: workflowData.description || '',
            active: workflowData.active !== undefined ? workflowData.active : false,
            nodes: workflowData.nodes || [],
            connections: workflowData.connections || {},
            settings: workflowData.settings || {
                saveExecutionProgress: true,
                saveManualExecutions: true,
                saveDataErrorExecution: "all",
                saveDataSuccessExecution: "all",
                executionTimeout: 3600,
                timezone: "UTC"
            },
            tags: workflowData.tags || [],
            createdAt: workflowData.createdAt || timestamp,
            updatedAt: workflowData.updatedAt || timestamp,
            versionId: workflowData.versionId || generateWorkflowId()
        };

        return saveWorkflow(id, workflow);
    },

    // Get a workflow by ID
    get: async (id) => {
        return getWorkflow(id);
    },

    // List workflows with pagination
    list: async (options) => {
        return listWorkflows(options);
    },

    // Generate a unique workflow ID
    generateId: generateWorkflowId,
};

module.exports = {
    workflowSchema,
    WorkflowModel
}; 