/**
 * n8n Integration Module
 * 
 * Provides communication and workflow management functionality for n8n instances.
 * Supports both REST API and filesystem integration methods.
 */

const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { logger } = require('../utils/logger');
const config = require('../../config/default');
const { workflowStorage } = require('./storage');

/**
 * Determines the integration type based on configuration
 * Returns 'api' if n8n.apiKey is configured or 'api' is explicitly configured
 * Returns 'filesystem' if configured or if apiKey is not set
 */
const getIntegrationType = () => {
    const configType = config.n8n.integrationType;

    // If explicitly configured, use that
    if (configType === 'api') {
        return 'api';
    }

    if (configType === 'filesystem') {
        return 'filesystem';
    }

    // Auto-detection (default)
    if (config.n8n.apiKey) {
        return 'api';
    }

    return 'filesystem';
};

/**
 * n8n Integration Service
 */
const n8nIntegration = {
    /**
     * Deploy a workflow to n8n
     * 
     * @param {string} workflowIdOrPath - ID or path of the workflow to deploy
     * @returns {Promise<Object>} Result of the deployment operation
     */
    async deployWorkflow(workflowIdOrPath) {
        try {
            // Load workflow from storage
            const workflow = await workflowStorage.loadWorkflow(workflowIdOrPath);
            if (!workflow) {
                throw new Error(`Workflow with ID/path ${workflowIdOrPath} not found`);
            }

            const integrationType = getIntegrationType();
            logger.info('Deploying workflow', {
                id: workflowIdOrPath,
                integrationType,
                name: workflow.name || 'Unnamed Workflow'
            });

            if (integrationType === 'api') {
                // Deploy via n8n API
                const response = await fetch(`${config.n8n.apiUrl}workflows`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-N8N-API-KEY': config.n8n.apiKey
                    },
                    body: JSON.stringify(workflow)
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    logger.error('n8n API error during deployment', {
                        status: response.status,
                        error: errorData
                    });
                    throw new Error(`Failed to deploy workflow: ${response.status} ${response.statusText}`);
                }

                const result = await response.json();
                logger.info('Workflow deployed successfully via API', { id: result.id });
                return {
                    success: true,
                    id: result.id,
                    message: 'Workflow deployed successfully via API',
                    n8nId: result.id
                };
            } else if (integrationType === 'filesystem') {
                // If workflow doesn't have an id, generate one
                if (!workflow.id) {
                    workflow.id = path.basename(workflowIdOrPath, '.json');
                }

                // Ensure the n8n workflows directory exists in the config
                if (!config.n8n.workflowsPath) {
                    throw new Error('n8n.workflowsPath is not configured');
                }

                // Deploy via filesystem
                const n8nWorkflowsDir = path.resolve(process.cwd(), config.n8n.workflowsPath || './n8n-workflows');
                await fs.mkdir(n8nWorkflowsDir, { recursive: true });

                const filePath = path.join(n8nWorkflowsDir, `${workflow.id}.json`);
                await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));

                logger.info('Workflow deployed successfully via filesystem', {
                    id: workflow.id,
                    path: filePath
                });

                return {
                    success: true,
                    id: workflow.id,
                    path: filePath,
                    message: 'Workflow deployed successfully via filesystem'
                };
            } else {
                throw new Error('Invalid integration type');
            }
        } catch (error) {
            logger.error('Failed to deploy workflow', { error: error.message });
            throw new Error(`Failed to deploy workflow: ${error.message}`);
        }
    },

    /**
     * Activate or deactivate a workflow in n8n
     * 
     * @param {string} workflowIdOrPath - ID or path of the workflow
     * @param {boolean} [activate=true] - Whether to activate or deactivate
     * @returns {Promise<Object>} Result of the operation
     */
    async activateWorkflow(workflowIdOrPath, activate = true) {
        try {
            const integrationType = getIntegrationType();
            logger.info(`${activate ? 'Activating' : 'Deactivating'} workflow`, {
                id: workflowIdOrPath,
                integrationType
            });

            if (integrationType === 'api') {
                // Determine the n8n workflow ID
                let n8nWorkflowId;

                // If the input looks like a path, extract the filename without extension
                if (workflowIdOrPath.includes('/') || workflowIdOrPath.includes('\\')) {
                    n8nWorkflowId = path.basename(workflowIdOrPath, '.json');
                } else {
                    n8nWorkflowId = workflowIdOrPath;
                }

                // Activate via n8n API
                const response = await fetch(`${config.n8n.apiUrl}workflows/${n8nWorkflowId}/activate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-N8N-API-KEY': config.n8n.apiKey
                    },
                    body: JSON.stringify({ active: activate })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    logger.error('n8n API error during activation', {
                        status: response.status,
                        error: errorData
                    });
                    throw new Error(`Failed to ${activate ? 'activate' : 'deactivate'} workflow: ${response.status} ${response.statusText}`);
                }

                const result = await response.json();
                logger.info(`Workflow ${activate ? 'activated' : 'deactivated'} successfully via API`, {
                    id: result.id
                });

                return {
                    success: true,
                    id: result.id,
                    active: activate,
                    message: `Workflow ${activate ? 'activated' : 'deactivated'} successfully`
                };
            } else if (integrationType === 'filesystem') {
                // Load the workflow
                const workflow = await workflowStorage.loadWorkflow(workflowIdOrPath);
                if (!workflow) {
                    throw new Error(`Workflow with ID/path ${workflowIdOrPath} not found`);
                }

                // Update workflow active status
                workflow.active = activate;

                // Save back to original location
                if (workflowIdOrPath.includes('/') || workflowIdOrPath.includes('\\')) {
                    await fs.writeFile(workflowIdOrPath, JSON.stringify(workflow, null, 2));
                } else {
                    // For backward compatibility, save to the default location
                    const filePath = path.join(config.storage.workflowsPath, `${workflowIdOrPath}.json`);
                    await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
                }

                // If n8n workflows directory is configured, also update there
                if (config.n8n.workflowsPath) {
                    const n8nWorkflowsDir = path.resolve(process.cwd(), config.n8n.workflowsPath);
                    const n8nFilePath = path.join(n8nWorkflowsDir, `${workflow.id || path.basename(workflowIdOrPath, '.json')}.json`);

                    // Check if the file exists in n8n workflows directory
                    try {
                        await fs.access(n8nFilePath);
                        await fs.writeFile(n8nFilePath, JSON.stringify(workflow, null, 2));
                        logger.info(`Updated workflow in n8n directory: ${activate ? 'active' : 'inactive'}`, {
                            path: n8nFilePath
                        });
                    } catch (err) {
                        logger.warn('Workflow not found in n8n directory, not updated', {
                            path: n8nFilePath
                        });
                    }
                }

                logger.info(`Workflow ${activate ? 'activated' : 'deactivated'} successfully via filesystem`, {
                    id: workflow.id || workflowIdOrPath
                });

                return {
                    success: true,
                    id: workflow.id || path.basename(workflowIdOrPath, '.json'),
                    active: activate,
                    message: `Workflow ${activate ? 'activated' : 'deactivated'} successfully`
                };
            } else {
                throw new Error('Invalid integration type');
            }
        } catch (error) {
            logger.error(`Failed to ${activate ? 'activate' : 'deactivate'} workflow`, {
                error: error.message
            });
            throw new Error(`Failed to ${activate ? 'activate' : 'deactivate'} workflow: ${error.message}`);
        }
    },

    /**
     * Retrieve a workflow from n8n
     * 
     * @param {string} workflowId - ID of the workflow in n8n
     * @returns {Promise<Object>} The retrieved workflow data
     */
    async getWorkflow(workflowId) {
        try {
            const integrationType = getIntegrationType();
            logger.info('Retrieving workflow from n8n', { id: workflowId, integrationType });

            if (integrationType === 'api') {
                // Retrieve via n8n API
                const response = await fetch(`${config.n8n.apiUrl}workflows/${workflowId}`, {
                    method: 'GET',
                    headers: {
                        'X-N8N-API-KEY': config.n8n.apiKey
                    }
                });

                if (!response.ok) {
                    if (response.status === 404) {
                        return { success: false, message: 'Workflow not found in n8n' };
                    }

                    const errorData = await response.json().catch(() => ({}));
                    logger.error('n8n API error during retrieval', {
                        status: response.status,
                        error: errorData
                    });
                    throw new Error(`Failed to retrieve workflow: ${response.status} ${response.statusText}`);
                }

                const workflow = await response.json();
                logger.info('Workflow retrieved successfully via API', { id: workflow.id });

                return {
                    success: true,
                    workflow,
                    message: 'Workflow retrieved successfully'
                };
            } else if (integrationType === 'filesystem') {
                // If n8n workflows directory is not configured, return error
                if (!config.n8n.workflowsPath) {
                    throw new Error('n8n.workflowsPath is not configured');
                }

                // Retrieve via filesystem
                const n8nWorkflowsDir = path.resolve(process.cwd(), config.n8n.workflowsPath);
                const filePath = path.join(n8nWorkflowsDir, `${workflowId}.json`);

                try {
                    const data = await fs.readFile(filePath, 'utf8');
                    const workflow = JSON.parse(data);

                    logger.info('Workflow retrieved successfully via filesystem', {
                        id: workflowId,
                        path: filePath
                    });

                    return {
                        success: true,
                        workflow,
                        path: filePath,
                        message: 'Workflow retrieved successfully'
                    };
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        return { success: false, message: 'Workflow not found in n8n' };
                    }
                    throw error;
                }
            } else {
                throw new Error('Invalid integration type');
            }
        } catch (error) {
            logger.error('Failed to retrieve workflow from n8n', { error: error.message });
            throw new Error(`Failed to retrieve workflow from n8n: ${error.message}`);
        }
    },

    /**
     * Check the execution status of a workflow in n8n
     * 
     * @param {string} workflowId - ID of the workflow in n8n
     * @returns {Promise<Object>} The status information
     */
    async checkExecutionStatus(workflowId) {
        try {
            // Only available via API
            if (getIntegrationType() !== 'api') {
                return {
                    success: false,
                    message: 'Execution status check is only available with API integration'
                };
            }

            logger.info('Checking workflow execution status', { id: workflowId });

            // Get most recent executions
            const response = await fetch(`${config.n8n.apiUrl}executions?workflowId=${workflowId}&limit=1`, {
                method: 'GET',
                headers: {
                    'X-N8N-API-KEY': config.n8n.apiKey
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                logger.error('n8n API error during execution status check', {
                    status: response.status,
                    error: errorData
                });
                throw new Error(`Failed to check execution status: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const executions = data.data || [];

            if (executions.length === 0) {
                return {
                    success: true,
                    hasExecutions: false,
                    message: 'No executions found for this workflow'
                };
            }

            const latestExecution = executions[0];
            logger.info('Workflow execution status retrieved', {
                id: workflowId,
                executionId: latestExecution.id,
                status: latestExecution.status
            });

            return {
                success: true,
                hasExecutions: true,
                latestExecution: {
                    id: latestExecution.id,
                    status: latestExecution.status,
                    startedAt: latestExecution.startedAt,
                    finishedAt: latestExecution.finishedAt,
                    mode: latestExecution.mode
                },
                message: 'Execution status retrieved successfully'
            };
        } catch (error) {
            logger.error('Failed to check workflow execution status', { error: error.message });
            throw new Error(`Failed to check workflow execution status: ${error.message}`);
        }
    },

    /**
     * List workflows from n8n
     * 
     * @param {Object} [options] - Optional parameters for filtering and pagination
     * @returns {Promise<Object>} The list of workflows
     */
    async listWorkflows(options = {}) {
        try {
            const integrationType = getIntegrationType();
            logger.info('Listing workflows from n8n', { integrationType });

            if (integrationType === 'api') {
                // Construct query parameters
                const queryParams = new URLSearchParams();
                if (options.active !== undefined) {
                    queryParams.append('active', options.active);
                }
                if (options.limit) {
                    queryParams.append('limit', options.limit);
                }
                if (options.offset) {
                    queryParams.append('offset', options.offset);
                }

                // List via n8n API
                const response = await fetch(`${config.n8n.apiUrl}workflows?${queryParams.toString()}`, {
                    method: 'GET',
                    headers: {
                        'X-N8N-API-KEY': config.n8n.apiKey
                    }
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    logger.error('n8n API error during workflow listing', {
                        status: response.status,
                        error: errorData
                    });
                    throw new Error(`Failed to list workflows: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                const workflows = data.data || [];

                logger.info('Workflows listed successfully via API', { count: workflows.length });

                return {
                    success: true,
                    workflows: workflows.map(w => ({
                        id: w.id,
                        name: w.name,
                        active: w.active,
                        createdAt: w.createdAt,
                        updatedAt: w.updatedAt
                    })),
                    count: workflows.length,
                    message: `Retrieved ${workflows.length} workflows from n8n`
                };
            } else if (integrationType === 'filesystem') {
                // If n8n workflows directory is not configured, return error
                if (!config.n8n.workflowsPath) {
                    throw new Error('n8n.workflowsPath is not configured');
                }

                // List via filesystem
                const n8nWorkflowsDir = path.resolve(process.cwd(), config.n8n.workflowsPath);

                try {
                    await fs.access(n8nWorkflowsDir);
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        logger.warn('n8n workflows directory not found', { path: n8nWorkflowsDir });
                        return {
                            success: true,
                            workflows: [],
                            count: 0,
                            message: 'n8n workflows directory not found'
                        };
                    }
                    throw error;
                }

                const files = await fs.readdir(n8nWorkflowsDir);
                const jsonFiles = files.filter(file => file.endsWith('.json'));

                // Apply pagination if options provided
                const { limit, offset } = options;
                const paginatedFiles = limit
                    ? jsonFiles.slice(offset || 0, (offset || 0) + limit)
                    : jsonFiles;

                // Process each workflow file
                const workflowPromises = paginatedFiles.map(async (file) => {
                    const filePath = path.join(n8nWorkflowsDir, file);
                    try {
                        const data = await fs.readFile(filePath, 'utf8');
                        const workflow = JSON.parse(data);

                        return {
                            id: workflow.id || path.basename(file, '.json'),
                            name: workflow.name || 'Unnamed Workflow',
                            active: workflow.active || false,
                            createdAt: workflow.createdAt,
                            updatedAt: workflow.updatedAt,
                            path: filePath
                        };
                    } catch (error) {
                        logger.error('Error reading workflow file', { path: filePath, error: error.message });
                        return null;
                    }
                });

                // Wait for all files to be processed
                const workflows = (await Promise.all(workflowPromises)).filter(w => w !== null);

                // Apply active filter if provided
                const filteredWorkflows = options.active !== undefined
                    ? workflows.filter(w => w.active === options.active)
                    : workflows;

                logger.info('Workflows listed successfully via filesystem', {
                    count: filteredWorkflows.length,
                    path: n8nWorkflowsDir
                });

                return {
                    success: true,
                    workflows: filteredWorkflows,
                    count: filteredWorkflows.length,
                    message: `Retrieved ${filteredWorkflows.length} workflows from n8n`
                };
            } else {
                throw new Error('Invalid integration type');
            }
        } catch (error) {
            logger.error('Failed to list workflows from n8n', { error: error.message });
            throw new Error(`Failed to list workflows from n8n: ${error.message}`);
        }
    }
};

module.exports = {
    n8nIntegration,
    getIntegrationType
}; 