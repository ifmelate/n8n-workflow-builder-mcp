/**
 * Workflow Creation Tools
 * 
 * Tools for creating and modifying workflows
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');
const { logSecurityEvent } = require('../utils/securityLogger');
const { workflowStorage } = require('../models/storage');

// Constants
const DEFAULT_WORKFLOW_DIR = process.env.WORKFLOW_DIR || path.join(process.cwd(), 'workflow_data');

// Create workflow directory if it doesn't exist
if (!fs.existsSync(DEFAULT_WORKFLOW_DIR)) {
    fs.mkdirSync(DEFAULT_WORKFLOW_DIR, { recursive: true });
    logger.info(`Created workflow directory: ${DEFAULT_WORKFLOW_DIR}`);
}

/**
 * Create a new workflow
 * 
 * @param {Object} params - Parameters for creating workflow
 * @param {string} params.name - Name of the workflow
 * @param {string} [params.workflow_filename] - Custom filename for the workflow
 * @param {string} [params.description] - Description of the workflow
 * @param {boolean} [params.active] - Whether the workflow is active
 * @param {Object} [params.settings] - Custom workflow settings
 * @param {string} [params.userId] - User ID for security logging
 * @returns {Object} Created workflow data and file path
 */
const createWorkflowExecute = async (params) => {
    const { name, workflow_filename, description = '', active = false, settings = {}, userId } = params;

    // Security logging
    logSecurityEvent({
        level: 'info',
        eventType: 'workflow_create',
        userId: userId || 'anonymous',
        details: {
            name,
            active,
            workflow_filename
        }
    });

    // Generate a unique ID for the workflow
    const workflowId = uuidv4();

    // Create basic workflow structure
    const workflow = {
        id: workflowId,
        name,
        description,
        active,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {
            saveExecutionProgress: true,
            saveManualExecutions: true,
            saveDataErrorExecution: 'all',
            saveDataSuccessExecution: 'all',
            executionTimeout: 3600,
            ...settings
        },
        nodes: [],
        connections: {},
        pinData: {},
        staticData: null,
        tags: []
    };

    // Determine the file path
    let filePath;
    if (workflow_filename) {
        // Ensure filename ends with .json
        const filename = workflow_filename.endsWith('.json') ? workflow_filename : `${workflow_filename}.json`;
        filePath = path.join(DEFAULT_WORKFLOW_DIR, filename);
    } else {
        filePath = path.join(DEFAULT_WORKFLOW_DIR, `${workflowId}.json`);
    }

    // Save the workflow
    await workflowStorage.saveWorkflow(workflowId, workflow, filePath);

    logger.info(`Created new workflow: ${name} (${workflowId}) at ${filePath}`);

    return {
        workflowId,
        workflowData: workflow,
        filePath
    };
};

module.exports = {
    createWorkflowExecute
}; 