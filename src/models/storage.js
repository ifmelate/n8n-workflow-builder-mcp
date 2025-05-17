/**
 * Workflow Storage Module
 * 
 * Provides filesystem-based storage capabilities for n8n workflows,
 * allowing workflows to be saved and retrieved from specified locations.
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const config = require('../../config/default');

// Default storage directory for workflows from config for backward compatibility only
const DEFAULT_WORKFLOWS_DIR = path.resolve(process.cwd(), config.storage.workflowsPath);

/**
 * Ensure a directory exists
 * 
 * @param {string} dirPath - Directory path to ensure exists
 */
const ensureDirectoryExists = async (dirPath) => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
    } catch (error) {
        logger.error('Failed to create directory', { path: dirPath, error: error.message });
        throw error;
    }
};

// Ensure the default directory exists for backward compatibility
ensureDirectoryExists(DEFAULT_WORKFLOWS_DIR).catch(err => {
    logger.error('Critical error ensuring directory', { error: err.message });
});

/**
 * Workflow Storage Service
 */
const workflowStorage = {
    /**
     * Save a workflow to the filesystem
     * 
     * @param {string} workflowId - Unique ID for the workflow
     * @param {Object} workflowData - Workflow data to save
     * @param {string} filePath - Required filepath specified by LLM
     * @returns {Promise<Object>} Result with success status and path
     */
    async saveWorkflow(workflowId, workflowData, filePath) {
        try {
            if (!filePath) {
                throw new Error('filePath is required - workflow must be saved at the location specified by the LLM');
            }

            // Make sure the path is valid - use absolute path or resolve relative path
            const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

            // Ensure the parent directory exists
            await ensureDirectoryExists(path.dirname(targetPath));

            // Add timestamp if not present
            if (!workflowData.updatedAt) {
                workflowData.updatedAt = new Date().toISOString();
            }

            // Write the workflow file
            await fs.writeFile(targetPath, JSON.stringify(workflowData, null, 2));

            logger.info('Workflow saved successfully', { workflowId, path: targetPath });
            return { success: true, path: targetPath };
        } catch (error) {
            logger.error('Error saving workflow', { workflowId, error: error.message });
            throw new Error(`Failed to save workflow: ${error.message}`);
        }
    },

    /**
     * Load a workflow from a specific filepath
     * 
     * @param {string} workflowIdOrPath - The complete filepath to the workflow
     * @returns {Promise<Object>} Workflow data or null if not found
     */
    async loadWorkflow(workflowIdOrPath) {
        try {
            // Determine the file path - treat as a path by default
            let filePath = workflowIdOrPath;

            // For backward compatibility, check if it looks like just an ID
            if (!workflowIdOrPath.includes('/') && !workflowIdOrPath.includes('\\') && !workflowIdOrPath.endsWith('.json')) {
                logger.warn('Using workflow ID instead of filepath is deprecated, use complete filepath instead', { id: workflowIdOrPath });
                filePath = path.join(DEFAULT_WORKFLOWS_DIR, `${workflowIdOrPath}.json`);
            }

            // Make sure the path is valid - use absolute path or resolve relative path
            const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

            const data = await fs.readFile(targetPath, 'utf8');
            const workflow = JSON.parse(data);
            logger.info('Workflow loaded successfully', { path: targetPath });
            return workflow;
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('Workflow not found', { path: workflowIdOrPath });
                return null;
            }
            logger.error('Error loading workflow', { path: workflowIdOrPath, error: error.message });
            throw new Error(`Failed to load workflow: ${error.message}`);
        }
    },

    /**
     * List workflows from a specific directory
     * 
     * @param {string} [directoryPath] - Directory to list workflows from
     * @param {Object} [options] - List options like limit and offset
     * @returns {Promise<Array>} Array of workflow summary objects
     */
    async listWorkflows(directoryPath = DEFAULT_WORKFLOWS_DIR, options = {}) {
        try {
            // Ensure the directory exists
            await ensureDirectoryExists(directoryPath);

            const { limit = 100, offset = 0 } = options;
            const files = await fs.readdir(directoryPath);
            const jsonFiles = files.filter(file => file.endsWith('.json'));

            // Apply pagination
            const paginatedFiles = jsonFiles.slice(offset, offset + limit);

            // Load each workflow file and extract summary information
            const workflowPromises = paginatedFiles.map(async (file) => {
                const fullPath = path.join(directoryPath, file);
                try {
                    const data = await fs.readFile(fullPath, 'utf8');
                    const workflow = JSON.parse(data);

                    return {
                        id: workflow.id || path.basename(file, '.json'),
                        name: workflow.name || 'Unnamed Workflow',
                        description: workflow.description || '',
                        updatedAt: workflow.updatedAt || null,
                        path: fullPath
                    };
                } catch (error) {
                    logger.error('Error reading workflow file', { path: fullPath, error: error.message });
                    return null;
                }
            });

            // Wait for all files to be processed
            const workflows = await Promise.all(workflowPromises);

            // Filter out any null entries from failed reads
            return workflows.filter(workflow => workflow !== null);
        } catch (error) {
            logger.error('Error listing workflows', { directory: directoryPath, error: error.message });
            throw new Error(`Failed to list workflows: ${error.message}`);
        }
    },

    /**
     * Delete a workflow by ID or filepath
     * 
     * @param {string} workflowIdOrPath - Workflow ID or complete filepath
     * @returns {Promise<Object>} Result with success status
     */
    async deleteWorkflow(workflowIdOrPath) {
        let filePath;

        // Check if the input is a full path or just an ID
        if (workflowIdOrPath.includes('/') || workflowIdOrPath.includes('\\')) {
            filePath = workflowIdOrPath;
        } else {
            filePath = path.join(DEFAULT_WORKFLOWS_DIR, `${workflowIdOrPath}.json`);
        }

        try {
            await fs.unlink(filePath);
            logger.info('Workflow deleted successfully', { path: filePath });
            return { success: true, path: filePath };
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('Workflow not found for deletion', { path: filePath });
                return { success: false, error: 'Workflow not found' };
            }
            logger.error('Error deleting workflow', { path: filePath, error: error.message });
            throw new Error(`Failed to delete workflow: ${error.message}`);
        }
    }
};

module.exports = {
    workflowStorage,
    DEFAULT_WORKFLOWS_DIR,
    ensureDirectoryExists
}; 