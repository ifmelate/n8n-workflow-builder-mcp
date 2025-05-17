/**
 * MCP Tool Definitions
 * 
 * This file defines all MCP tools with proper JSON Schema for inputs and outputs.
 * These definitions are used to generate the MCP tool definitions endpoint.
 */

// Import tool function implementations - comment out ones that don't exist yet
const { searchNodes } = require('./nodeDiscovery');
const { createWorkflowExecute } = require('./workflowCreation');
const {
    saveWorkflowExecute,
    loadWorkflowExecute,
    listWorkflowsExecute,
    deleteWorkflowExecute
} = require('./workflowStorage');

// Mock implementations for tools not yet implemented
// In a real implementation, these would be imported from actual modules
const mockExecute = async (params) => {
    return {
        success: true,
        message: 'Operation would be executed here',
        params
    };
};

// Mock implementations for n8n integration
const deployWorkflowExecute = mockExecute;
const activateWorkflowExecute = mockExecute;
const getWorkflowExecute = mockExecute;
const checkExecutionStatusExecute = mockExecute;
const n8nListWorkflowsExecute = mockExecute;

// Mock implementations for workflow generation
const generateWorkflow = mockExecute;

// Mock implementations for node management
const addNode = mockExecute;
const replaceNode = mockExecute;

// Mock implementations for connection management
const createConnection = mockExecute;
const removeConnection = mockExecute;
const removeAllConnections = mockExecute;

// Mock implementations for workflow testing
const testWorkflowExecute = mockExecute;
const getTestStatusExecute = mockExecute;

// Mock implementations for credential management
const storeCredentialExecute = mockExecute;
const getCredentialExecute = mockExecute;
const updateCredentialExecute = mockExecute;
const deleteCredentialExecute = mockExecute;
const listCredentialsExecute = mockExecute;
const rotateEncryptionKeyExecute = mockExecute;

// Define individual tool definitions for import/reference
const individualToolDefinitions = {
    // Workflow Tools
    workflow_create: {
        name: 'workflow_create',
        description: 'Create a new workflow',
        execute: createWorkflowExecute,
        input_schema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the workflow'
                },
                workflow_filename: {
                    type: 'string',
                    description: 'Custom filename for the workflow (optional)'
                },
                description: {
                    type: 'string',
                    description: 'Description of the workflow'
                },
                active: {
                    type: 'boolean',
                    description: 'Whether the workflow should be active'
                },
                settings: {
                    type: 'object',
                    description: 'Workflow settings'
                }
            },
            required: ['name']
        },
        output_schema: {
            type: 'object',
            properties: {
                workflowId: {
                    type: 'string',
                    description: 'ID of the created workflow'
                },
                workflowData: {
                    type: 'object',
                    description: 'Full workflow data'
                },
                filePath: {
                    type: 'string',
                    description: 'Path where the workflow file was saved'
                }
            }
        }
    },

    // ... other individual tool definitions

    // We keep these available for internal reference
    // but don't export them directly in our consolidated approach
};

// Consolidated tool definitions that will be exported
const toolDefinitions = {
    // =============================================================
    // 1. Consolidated Workflow Management Tool
    // =============================================================
    workflow_manage: {
        name: 'workflow_manage',
        description: 'Manage workflows (create, save, load, list, delete, generate)',
        execute: async (params) => {
            const { operation, ...rest } = params;

            // Route to appropriate handler based on operation
            switch (operation) {
                case 'create':
                    return createWorkflowExecute(rest);
                case 'save':
                    return saveWorkflowExecute(rest);
                case 'load':
                    return loadWorkflowExecute(rest);
                case 'list':
                    return listWorkflowsExecute(rest);
                case 'delete':
                    return deleteWorkflowExecute(rest);
                case 'generate':
                    return generateWorkflow(rest);
                default:
                    throw new Error(`Unknown workflow operation: ${operation}`);
            }
        },
        input_schema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    description: 'Workflow operation to perform',
                    enum: ['create', 'save', 'load', 'list', 'delete', 'generate']
                },
                // Parameters for create
                name: {
                    type: 'string',
                    description: 'Name of the workflow (for create operation)'
                },
                workflow_filename: {
                    type: 'string',
                    description: 'Custom filename for the workflow (for create operation)'
                },
                description: {
                    type: 'string',
                    description: 'Description of the workflow (for create operation)'
                },
                active: {
                    type: 'boolean',
                    description: 'Whether the workflow should be active'
                },
                settings: {
                    type: 'object',
                    description: 'Workflow settings'
                },
                // Parameters for save/load/delete
                workflowId: {
                    type: 'string',
                    description: 'ID of the workflow (for save, load, delete operations)'
                },
                workflowData: {
                    type: 'object',
                    description: 'Workflow data to save (for save operation)'
                },
                // Parameters for generate
                prompt: {
                    type: 'string',
                    description: 'Natural language description of the workflow to generate (for generate operation)'
                }
            },
            required: ['operation'],
            allOf: [
                {
                    if: { properties: { operation: { enum: ['create'] } } },
                    then: { required: ['name'] }
                },
                {
                    if: { properties: { operation: { enum: ['save'] } } },
                    then: { required: ['workflowId', 'workflowData'] }
                },
                {
                    if: { properties: { operation: { enum: ['load', 'delete'] } } },
                    then: { required: ['workflowId'] }
                },
                {
                    if: { properties: { operation: { enum: ['generate'] } } },
                    then: { required: ['prompt'] }
                }
            ]
        },
        output_schema: {
            type: 'object',
            properties: {
                success: {
                    type: 'boolean',
                    description: 'Whether the operation was successful'
                },
                data: {
                    type: 'object',
                    description: 'Operation result data'
                }
            }
        }
    },

    // =============================================================
    // 2. Consolidated n8n Integration Tool
    // =============================================================
    n8n_manage: {
        name: 'n8n_manage',
        description: 'Manage workflows in n8n (deploy, activate, get, check execution, list)',
        execute: async (params) => {
            const { operation, ...rest } = params;

            switch (operation) {
                case 'deploy':
                    return deployWorkflowExecute(rest);
                case 'activate':
                    return activateWorkflowExecute(rest);
                case 'get':
                    return getWorkflowExecute(rest);
                case 'check_execution':
                    return checkExecutionStatusExecute(rest);
                case 'list':
                    return n8nListWorkflowsExecute(rest);
                default:
                    throw new Error(`Unknown n8n operation: ${operation}`);
            }
        },
        input_schema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    description: 'n8n operation to perform',
                    enum: ['deploy', 'activate', 'get', 'check_execution', 'list']
                },
                workflowId: {
                    type: 'string',
                    description: 'ID of the workflow (for deploy, activate, get operations)'
                },
                workflowData: {
                    type: 'object',
                    description: 'Workflow data to deploy (for deploy operation)'
                },
                active: {
                    type: 'boolean',
                    description: 'Whether to activate the workflow (for activate operation)'
                },
                executionId: {
                    type: 'string',
                    description: 'Execution ID to check (for check_execution operation)'
                }
            },
            required: ['operation'],
            allOf: [
                {
                    if: { properties: { operation: { enum: ['deploy'] } } },
                    then: { required: ['workflowId', 'workflowData'] }
                },
                {
                    if: { properties: { operation: { enum: ['activate'] } } },
                    then: { required: ['workflowId', 'active'] }
                },
                {
                    if: { properties: { operation: { enum: ['get'] } } },
                    then: { required: ['workflowId'] }
                },
                {
                    if: { properties: { operation: { enum: ['check_execution'] } } },
                    then: { required: ['executionId'] }
                }
            ]
        },
        output_schema: {
            type: 'object',
            properties: {
                success: {
                    type: 'boolean',
                    description: 'Whether the operation was successful'
                },
                data: {
                    type: 'object',
                    description: 'Operation result data'
                }
            }
        }
    },

    // =============================================================
    // 3. Consolidated Node Management Tool
    // =============================================================
    node_manage: {
        name: 'node_manage',
        description: 'Manage nodes in workflows (search, add, replace)',
        execute: async (params) => {
            const { operation, ...rest } = params;

            switch (operation) {
                case 'search':
                    return searchNodes(rest);
                case 'add':
                    return addNode(rest);
                case 'replace':
                    return replaceNode(rest);
                default:
                    throw new Error(`Unknown node operation: ${operation}`);
            }
        },
        input_schema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    description: 'Node operation to perform',
                    enum: ['search', 'add', 'replace']
                },
                // Search parameters
                query: {
                    type: 'string',
                    description: 'Search query for nodes (for search operation)'
                },
                // Add/replace parameters
                workflowId: {
                    type: 'string',
                    description: 'ID of the workflow to modify (for add, replace operations)'
                },
                nodeType: {
                    type: 'string',
                    description: 'Type of node to add (for add, replace operations)'
                },
                nodeName: {
                    type: 'string',
                    description: 'Name for the node (for add, replace operations)'
                },
                position: {
                    type: 'object',
                    description: 'Position of the node (for add operation)',
                    properties: {
                        x: { type: 'number' },
                        y: { type: 'number' }
                    }
                },
                parameters: {
                    type: 'object',
                    description: 'Parameters for the node (for add, replace operations)'
                },
                nodeId: {
                    type: 'string',
                    description: 'ID of the node to replace (for replace operation)'
                }
            },
            required: ['operation'],
            allOf: [
                {
                    if: { properties: { operation: { enum: ['search'] } } },
                    then: { required: ['query'] }
                },
                {
                    if: { properties: { operation: { enum: ['add'] } } },
                    then: { required: ['workflowId', 'nodeType', 'nodeName'] }
                },
                {
                    if: { properties: { operation: { enum: ['replace'] } } },
                    then: { required: ['workflowId', 'nodeId', 'nodeType'] }
                }
            ]
        },
        output_schema: {
            type: 'object',
            properties: {
                success: {
                    type: 'boolean',
                    description: 'Whether the operation was successful'
                },
                data: {
                    type: 'object',
                    description: 'Operation result data'
                }
            }
        }
    },

    // =============================================================
    // 4. Consolidated Connection Management Tool
    // =============================================================
    connection_manage: {
        name: 'connection_manage',
        description: 'Manage connections between nodes (create, remove, remove all)',
        execute: async (params) => {
            const { operation, ...rest } = params;

            switch (operation) {
                case 'create':
                    return createConnection(rest);
                case 'remove':
                    return removeConnection(rest);
                case 'remove_all':
                    return removeAllConnections(rest);
                default:
                    throw new Error(`Unknown connection operation: ${operation}`);
            }
        },
        input_schema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    description: 'Connection operation to perform',
                    enum: ['create', 'remove', 'remove_all']
                },
                workflowId: {
                    type: 'string',
                    description: 'ID of the workflow to modify'
                },
                sourceNodeId: {
                    type: 'string',
                    description: 'ID of the source node (for create, remove operations)'
                },
                targetNodeId: {
                    type: 'string',
                    description: 'ID of the target node (for create, remove operations)'
                },
                sourceOutputIndex: {
                    type: 'number',
                    description: 'Index of the output on the source node (for create operation)'
                },
                targetInputIndex: {
                    type: 'number',
                    description: 'Index of the input on the target node (for create operation)'
                },
                nodeId: {
                    type: 'string',
                    description: 'ID of the node to remove all connections for (for remove_all operation)'
                }
            },
            required: ['operation', 'workflowId'],
            allOf: [
                {
                    if: { properties: { operation: { enum: ['create'] } } },
                    then: { required: ['sourceNodeId', 'targetNodeId'] }
                },
                {
                    if: { properties: { operation: { enum: ['remove'] } } },
                    then: { required: ['sourceNodeId', 'targetNodeId'] }
                },
                {
                    if: { properties: { operation: { enum: ['remove_all'] } } },
                    then: { required: ['nodeId'] }
                }
            ]
        },
        output_schema: {
            type: 'object',
            properties: {
                success: {
                    type: 'boolean',
                    description: 'Whether the operation was successful'
                },
                data: {
                    type: 'object',
                    description: 'Operation result data'
                }
            }
        }
    },

    // =============================================================
    // 5. Consolidated Workflow Testing Tool
    // =============================================================
    workflow_test: {
        name: 'workflow_test',
        description: 'Test workflows and check test status',
        execute: async (params) => {
            const { operation, ...rest } = params;

            switch (operation) {
                case 'execute':
                    return testWorkflowExecute(rest);
                case 'status':
                    return getTestStatusExecute(rest);
                default:
                    throw new Error(`Unknown test operation: ${operation}`);
            }
        },
        input_schema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    description: 'Test operation to perform',
                    enum: ['execute', 'status']
                },
                workflowId: {
                    type: 'string',
                    description: 'ID of the workflow to test (for execute operation)'
                },
                testInput: {
                    type: 'object',
                    description: 'Input data for the test (for execute operation)'
                },
                testId: {
                    type: 'string',
                    description: 'ID of the test to check status for (for status operation)'
                }
            },
            required: ['operation'],
            allOf: [
                {
                    if: { properties: { operation: { enum: ['execute'] } } },
                    then: { required: ['workflowId'] }
                },
                {
                    if: { properties: { operation: { enum: ['status'] } } },
                    then: { required: ['testId'] }
                }
            ]
        },
        output_schema: {
            type: 'object',
            properties: {
                success: {
                    type: 'boolean',
                    description: 'Whether the operation was successful'
                },
                testId: {
                    type: 'string',
                    description: 'ID of the test (for execute operation)'
                },
                status: {
                    type: 'string',
                    description: 'Status of the test (for status operation)'
                },
                results: {
                    type: 'object',
                    description: 'Test results (for status operation when complete)'
                }
            }
        }
    },

    // =============================================================
    // 6. Consolidated Credential Management Tool
    // =============================================================
    credential_manage: {
        name: 'credential_manage',
        description: 'Manage credentials (store, get, update, delete, list, rotate key)',
        execute: async (params) => {
            const { operation, ...rest } = params;

            switch (operation) {
                case 'store':
                    return storeCredentialExecute(rest);
                case 'get':
                    return getCredentialExecute(rest);
                case 'update':
                    return updateCredentialExecute(rest);
                case 'delete':
                    return deleteCredentialExecute(rest);
                case 'list':
                    return listCredentialsExecute(rest);
                case 'rotate_key':
                    return rotateEncryptionKeyExecute(rest);
                default:
                    throw new Error(`Unknown credential operation: ${operation}`);
            }
        },
        input_schema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    description: 'Credential operation to perform',
                    enum: ['store', 'get', 'update', 'delete', 'list', 'rotate_key']
                },
                name: {
                    type: 'string',
                    description: 'Name of the credential (for store, get, update, delete operations)'
                },
                credentialType: {
                    type: 'string',
                    description: 'Type of credential (for store, update operations)'
                },
                data: {
                    type: 'object',
                    description: 'Credential data (for store, update operations)'
                },
                newKey: {
                    type: 'string',
                    description: 'New encryption key (for rotate_key operation)'
                }
            },
            required: ['operation'],
            allOf: [
                {
                    if: { properties: { operation: { enum: ['store'] } } },
                    then: { required: ['name', 'credentialType', 'data'] }
                },
                {
                    if: { properties: { operation: { enum: ['get', 'delete'] } } },
                    then: { required: ['name'] }
                },
                {
                    if: { properties: { operation: { enum: ['update'] } } },
                    then: { required: ['name', 'data'] }
                },
                {
                    if: { properties: { operation: { enum: ['rotate_key'] } } },
                    then: { required: ['newKey'] }
                }
            ]
        },
        output_schema: {
            type: 'object',
            properties: {
                success: {
                    type: 'boolean',
                    description: 'Whether the operation was successful'
                },
                data: {
                    type: 'object',
                    description: 'Operation result data'
                }
            }
        }
    }
};

/**
 * Get all tool definitions
 * 
 * @returns {Object} All tool definitions
 */
const getAllToolDefinitions = () => {
    return toolDefinitions;
};

module.exports = {
    toolDefinitions,
    getAllToolDefinitions
}; 