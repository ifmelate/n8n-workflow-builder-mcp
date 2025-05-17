/**
 * MCP Tools Index
 * 
 * This file exports all MCP tools used to interact with n8n workflows.
 */

const { createTool } = require('../models/tool');
const { logger } = require('../utils/logger');
const {
    storeCredential,
    getCredential,
    updateCredential,
    deleteCredential,
    listCredentials,
    rotateEncryptionKey
} = require('../models/credential');
const { searchNodesTool } = require('./nodeDiscovery');
const { createWorkflowTool } = require('./workflowCreation');
const workflowStorageTools = require('./workflowStorage');
const n8nIntegrationTools = require('./n8nIntegration');
const { generateWorkflowTool } = require('./workflowGenerator');
const { addNodeTool, replaceNodeTool } = require('./nodeManagement');
const {
    createConnectionTool,
    removeConnectionTool,
    removeNodeConnectionsTool
} = require('./connectionManagement');
const { testWorkflowTool, getExecutionStatusTool } = require('./workflowTesting');

// Placeholder implementations
const placeholderExecute = async () => {
    throw new Error('Tool not yet implemented');
};

// Workflow management tools
const workflowTools = {
    create: createWorkflowTool,
    save: workflowStorageTools.saveWorkflowTool,
    load: workflowStorageTools.loadWorkflowTool,
    list: workflowStorageTools.listWorkflowsTool,
    delete: workflowStorageTools.deleteWorkflowTool,
    generate: generateWorkflowTool
};

// n8n integration tools
const n8nTools = {
    deploy: n8nIntegrationTools.deployWorkflowTool,
    activate: n8nIntegrationTools.activateWorkflowTool,
    get: n8nIntegrationTools.getWorkflowTool,
    checkExecution: n8nIntegrationTools.checkExecutionStatusTool,
    list: n8nIntegrationTools.listWorkflowsTool
};

// Node management tools
const nodeTools = {
    search: searchNodesTool,
    add: addNodeTool,
    replace: replaceNodeTool
};

// Connection management tools
const connectionTools = {
    create: createConnectionTool,
    remove: removeConnectionTool,
    removeAll: removeNodeConnectionsTool
};

// Workflow testing tools
const testingTools = {
    test: testWorkflowTool,
    status: getExecutionStatusTool
};

// Credential management tools
const credentialTools = {
    store: createTool(
        'Securely store a credential',
        {
            name: {
                type: 'string',
                description: 'Unique name for the credential'
            },
            data: {
                type: 'object',
                description: 'Credential data to encrypt and store'
            },
            type: {
                type: 'string',
                description: 'Type of credential (api, oauth, database, generic)',
                optional: true
            }
        },
        async (params) => {
            try {
                const result = await storeCredential(params.name, params.data, {
                    type: params.type || 'generic'
                });
                return result;
            } catch (error) {
                logger.error('Error storing credential', { error: error.message });
                throw new Error(`Failed to store credential: ${error.message}`);
            }
        }
    ),

    get: createTool(
        'Retrieve a stored credential',
        {
            name: {
                type: 'string',
                description: 'Name of the credential to retrieve'
            }
        },
        async (params) => {
            try {
                const credential = await getCredential(params.name);
                return credential;
            } catch (error) {
                logger.error('Error retrieving credential', { error: error.message });
                throw new Error(`Failed to retrieve credential: ${error.message}`);
            }
        }
    ),

    update: createTool(
        'Update a stored credential',
        {
            name: {
                type: 'string',
                description: 'Name of the credential to update'
            },
            data: {
                type: 'object',
                description: 'New credential data'
            },
            type: {
                type: 'string',
                description: 'Type of credential (api, oauth, database, generic)',
                optional: true
            }
        },
        async (params) => {
            try {
                const result = await updateCredential(params.name, params.data, {
                    type: params.type
                });
                return result;
            } catch (error) {
                logger.error('Error updating credential', { error: error.message });
                throw new Error(`Failed to update credential: ${error.message}`);
            }
        }
    ),

    delete: createTool(
        'Delete a stored credential',
        {
            name: {
                type: 'string',
                description: 'Name of the credential to delete'
            }
        },
        async (params) => {
            try {
                const result = await deleteCredential(params.name);
                return result;
            } catch (error) {
                logger.error('Error deleting credential', { error: error.message });
                throw new Error(`Failed to delete credential: ${error.message}`);
            }
        }
    ),

    list: createTool(
        'List all stored credentials (without sensitive data)',
        {},
        async () => {
            try {
                const credentials = await listCredentials();
                return { credentials };
            } catch (error) {
                logger.error('Error listing credentials', { error: error.message });
                throw new Error(`Failed to list credentials: ${error.message}`);
            }
        }
    ),

    rotateKey: createTool(
        'Rotate the encryption key for all credentials',
        {
            newKeyId: {
                type: 'string',
                description: 'New key identifier for key rotation',
                optional: true
            }
        },
        async (params) => {
            try {
                const result = await rotateEncryptionKey(params.newKeyId);
                return result;
            } catch (error) {
                logger.error('Error rotating encryption key', { error: error.message });
                throw new Error(`Failed to rotate encryption key: ${error.message}`);
            }
        }
    )
};

// Log available tools at startup
const logAvailableTools = () => {
    // Count tools by category instead of logging each one individually
    const toolCounts = Object.entries({
        workflow: workflowTools,
        n8n: n8nTools,
        node: nodeTools,
        connection: connectionTools,
        test: testingTools,
        credential: credentialTools
    }).reduce((counts, [category, tools]) => {
        counts[category] = Object.keys(tools).length;
        return counts;
    }, {});

    logger.info(`Tool categories initialized: ${Object.entries(toolCounts)
        .map(([category, count]) => `${category} (${count})`)
        .join(', ')}`);
};

// Schedule logging on next tick to not block module loading
process.nextTick(logAvailableTools);

// Export all tools grouped by category
const tools = {
    workflow: workflowTools,
    n8n: n8nTools,
    node: nodeTools,
    connection: connectionTools,
    test: testingTools,
    credential: credentialTools
};

module.exports = tools; 