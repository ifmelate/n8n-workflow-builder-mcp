/**
 * Node Discovery Tool
 * 
 * Implements the search_nodes tool for discovering n8n nodes and their parameters.
 * 
 * This tool allows AI agents to explore available n8n nodes by:
 * 1. Scanning the workflow_nodes directory for node definition files
 * 2. Extracting node information, parameters, and credentials
 * 3. Categorizing nodes based on their functionality
 * 4. Providing search capabilities with various filters
 * 5. Ensuring secure handling of credential-related parameters
 * 
 * Usage example:
 * ```
 * // Search for database-related nodes
 * const result = await searchNodes({ category: 'database' });
 * 
 * // Search for nodes by keyword
 * const result = await searchNodes({ keyword: 'email' });
 * 
 * // Combined search
 * const result = await searchNodes({ 
 *   category: 'trigger',
 *   functionality: 'webhook' 
 * });
 * ```
 */

const fs = require('fs').promises;
const path = require('path');
const { createTool } = require('../models/tool');
const { logger } = require('../utils/logger');

// Cache for node information to improve performance
let nodeCache = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache TTL

/**
 * Scans and parses the n8n workflow_nodes directory
 * 
 * This function reads all JSON files in the workflow_nodes directory,
 * extracts node information, and returns a structured array of node data.
 * 
 * @returns {Promise<Array>} Array of node information objects
 */
const compareSemver = (a, b) => {
    const normalize = v => v.replace(/^v/i, '');
    const pa = normalize(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = normalize(b).split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] ?? 0;
        const nb = pb[i] ?? 0;
        if (na !== nb) return na - nb;
    }
    return 0;
};

const scanWorkflowNodes = async () => {
    const workflowNodesDir = path.join(process.cwd(), 'workflow_nodes');
    try {
        logger.debug('Scanning workflow_nodes directory for node definitions');
        let entries;
        try {
            entries = await fs.readdir(workflowNodesDir, { withFileTypes: true });
        } catch (_) {
            // Fallback for environments/tests mocking fs without Dirent support
            const names = await fs.readdir(workflowNodesDir);
            entries = names.map(name => ({ name, isFile: () => name.endsWith('.json'), isDirectory: () => !name.endsWith('.json') }));
        }
        // Handle mocks that return string names even when withFileTypes is requested
        if (Array.isArray(entries) && entries.length > 0 && typeof entries[0] === 'string') {
            const names = entries;
            entries = names.map(name => ({ name, isFile: () => name.endsWith('.json'), isDirectory: () => !name.endsWith('.json') }));
        }

        // Determine whether we have a flat structure or versioned subdirectories
        const topLevelJson = entries.filter(e => e.isFile && e.isFile() && e.name.endsWith('.json')).map(e => e.name);
        let scanDir = workflowNodesDir;
        let jsonFiles = topLevelJson;

        if (jsonFiles.length === 0) {
            const versionDirs = entries.filter(e => e.isDirectory && e.isDirectory()).map(e => e.name);
            if (versionDirs.length > 0) {
                const latest = versionDirs.slice().sort((a, b) => compareSemver(b, a))[0];
                scanDir = path.join(workflowNodesDir, latest);
                const versionFiles = await fs.readdir(scanDir);
                jsonFiles = versionFiles.filter(f => f.endsWith('.json'));
                logger.debug(`Detected versioned nodes at ${latest}; using ${jsonFiles.length} files`);
            }
        }

        logger.debug(`Found ${jsonFiles.length} node definition files`);

        // Create a map of normalized filename -> actual filename with original casing
        // This helps us find files with the correct casing based on lowercase lookups
        const filenameMap = {};
        jsonFiles.forEach(file => {
            const baseId = file.replace('.json', '');
            filenameMap[baseId.toLowerCase()] = baseId;
        });

        logger.debug(`Built filename map with ${Object.keys(filenameMap).length} entries`);

        // Process each file
        const nodesPromises = jsonFiles.map(async (file) => {
            try {
                const filePath = path.join(scanDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                const nodeData = JSON.parse(content);

                // Get filename without extension for node identification
                // Preserve the exact filename casing
                const baseNodeId = file.replace('.json', '');

                // For indexing and finding nodes, we need a lowercase version of the ID
                const normalizedNodeId = baseNodeId.toLowerCase();

                // Check if the node has a nodeType field (preferred way to identify the node)
                let nodeType = null;
                if (nodeData.nodeType) {
                    nodeType = nodeData.nodeType;
                    // Store the original node type format with exact casing for reference
                    nodeData.originalNodeType = nodeType; // Preserve the exact casing

                    // Normalize the node type for consistency in searching
                    if (nodeType.includes('n8n-nodes-base.')) {
                        // Extract just the node name part after the prefix
                        const nodeName = nodeType.split('n8n-nodes-base.')[1];
                        // Store both formats for lookup
                        nodeData.normalizedNodeType = nodeName.toLowerCase();
                    } else {
                        nodeData.normalizedNodeType = nodeType.toLowerCase();
                    }
                } else {
                    // If no nodeType is specified, derive it from the filename
                    // Use the original filename casing to construct the nodeType to preserve camelCase
                    const nodeIdWithOriginalCase = file.replace('.json', '');
                    nodeType = `n8n-nodes-base.${nodeIdWithOriginalCase}`;
                    nodeData.originalNodeType = nodeType; // Store with exact casing
                    nodeData.normalizedNodeType = baseNodeId.toLowerCase();
                }

                // Extract node ID from the base name for consistent identification
                const nodeId = baseNodeId;

                // Extract node information, passing the full node data and file info
                const nodeInfo = extractNodeInfo(nodeId, nodeData, file);

                // Include the nodeType in the node info for reference
                // Always use the original casing from the definition file
                nodeInfo.type = nodeData.nodeType || nodeType;
                nodeInfo.originalNodeType = nodeData.nodeType || nodeType; // Store the original nodeType with exact casing
                nodeInfo.normalizedType = nodeData.normalizedNodeType;

                // Log the node discovery for debugging
                logger.debug(`Discovered node: ${nodeInfo.id}`, {
                    type: nodeInfo.type,
                    originalNodeType: nodeInfo.originalNodeType
                });

                return nodeInfo;
            } catch (error) {
                logger.error(`Error processing node file ${file}:`, error);
                return null;
            }
        });

        // Filter out any failed node parsing
        const nodes = (await Promise.all(nodesPromises)).filter(Boolean);
        logger.debug(`Successfully parsed ${nodes.length} node definitions`);

        // Add a filenames map to help with exact case matching
        const result = nodes;
        result.filenameMap = filenameMap;

        return result;
    } catch (error) {
        logger.error('Failed to scan workflow_nodes directory:', error);
        throw new Error(`Failed to scan workflow nodes: ${error.message}`);
    }
};

/**
 * Extract relevant node information from node data
 * 
 * Parses the raw JSON node data and extracts structured information
 * about the node, including its parameters, categories, and credentials.
 * 
 * @param {string} nodeId - The node identifier
 * @param {Object} nodeData - Raw node data from JSON file
 * @param {string} fileName - Original filename
 * @returns {Object} Structured node information
 */
const extractNodeInfo = (nodeId, nodeData, fileName) => {
    try {
        // If there are no nodes in the file, return minimal info
        if (!nodeData.nodes || !nodeData.nodes.length) {
            logger.debug(`No node instance found in ${fileName}`);
            return {
                id: nodeId,
                name: nodeId,
                fileName,
                description: 'Node information not available',
                parameters: [],
                categories: []
            };
        }

        const nodeInstance = nodeData.nodes[0];

        // Determine node categories from file name and node structure
        const categories = determineCategories(nodeId, nodeInstance);

        // Extract parameters from the node instance
        const parameters = extractParameters(nodeInstance.parameters);

        return {
            id: nodeId,
            name: nodeInstance.name || nodeId,
            fileName,
            description: getNodeDescription(nodeId, nodeInstance),
            parameters,
            categories,
            typeVersion: nodeInstance.typeVersion,
            credentials: nodeInstance.credentials ? Object.keys(nodeInstance.credentials) : [],
            // Store the nodeType directly from the JSON data with original casing
            originalNodeType: nodeData.nodeType || null
        };
    } catch (error) {
        logger.warn(`Error extracting node info for ${nodeId}:`, error);
        return {
            id: nodeId,
            name: nodeId,
            fileName,
            description: 'Error extracting node information',
            parameters: [],
            categories: []
        };
    }
};

/**
 * Determine categories for a node based on its ID and structure
 * 
 * Analyzes the node identifier and structure to categorize it
 * according to its functionality (e.g., Trigger, HTTP, Database).
 * 
 * @param {string} nodeId - The node identifier
 * @param {Object} nodeInstance - Node instance data
 * @returns {Array<string>} Categories for the node
 */
const determineCategories = (nodeId, nodeInstance) => {
    const categories = new Set();

    // Check for trigger nodes
    if (nodeId.toLowerCase().includes('trigger')) {
        categories.add('Trigger');
    }

    // Check for common categories
    if (nodeId.match(/^(http|rest|api|webhook)/i)) {
        categories.add('HTTP');
    } else if (nodeId.match(/^(gmail|email|smtp|mail)/i)) {
        categories.add('Email');
    } else if (nodeId.match(/^(postgres|mysql|mongodb|db|sql|database)/i)) {
        categories.add('Database');
    } else if (nodeId.match(/^(file|s3|storage)/i)) {
        categories.add('File');
    } else if (nodeId.match(/^(slack|telegram|discord|chat|message)/i)) {
        categories.add('Communication');
    }

    // Check operation-based categories
    if (nodeInstance.parameters) {
        if (nodeInstance.parameters.operation) {
            categories.add('Operation');
        }
        if (nodeInstance.parameters.resource) {
            categories.add('Resource');
        }
    }

    return Array.from(categories);
};

/**
 * Generate a description for the node
 * 
 * Creates a human-readable description of the node based on its
 * identifier and category to help AI agents understand its purpose.
 * 
 * @param {string} nodeId - The node identifier
 * @param {Object} nodeInstance - Node instance data
 * @returns {string} Node description
 */
const getNodeDescription = (nodeId, nodeInstance) => {
    // Remove any 'Trigger' suffix for cleaner descriptions
    const baseName = nodeId.replace(/Trigger$/, '');

    if (nodeId.endsWith('Trigger')) {
        return `Trigger node for ${baseName} events`;
    }

    // Generate description based on categories
    const categories = determineCategories(nodeId, nodeInstance);
    if (categories.includes('HTTP')) {
        return `Make HTTP requests to ${baseName} API`;
    } else if (categories.includes('Database')) {
        return `Interact with ${baseName} database`;
    } else if (categories.includes('Email')) {
        return `Send or process emails with ${baseName}`;
    } else if (categories.includes('File')) {
        return `Handle file operations with ${baseName}`;
    } else if (categories.includes('Communication')) {
        return `Send or receive messages with ${baseName}`;
    }

    // Default description
    return `${baseName} integration node`;
};

/**
 * Extract parameters from node instance
 * 
 * Processes the raw parameter data from a node and converts it
 * into a structured format, identifying credential parameters.
 * 
 * @param {Object} paramData - Raw parameter data
 * @returns {Array} Structured parameter information
 */
const extractParameters = (paramData) => {
    if (!paramData) {
        return [];
    }

    const parameters = [];

    for (const [key, value] of Object.entries(paramData)) {
        // Skip null values and empty objects
        if (value === null || (typeof value === 'object' && Object.keys(value).length === 0)) {
            continue;
        }

        // Determine parameter type
        let type = typeof value;
        if (type === 'object') {
            type = Array.isArray(value) ? 'array' : 'object';
        }

        // Sanitize credential parameters
        const sanitizedValue = key.toLowerCase().includes('credential') ?
            { type: 'credential', required: false } : value;

        parameters.push({
            name: key,
            type,
            value: sanitizedValue,
            isCredential: key.toLowerCase().includes('credential')
        });
    }

    return parameters;
};

/**
 * Get node information from cache or source
 * 
 * Retrieves node information from cache if available and valid,
 * otherwise scans the workflow_nodes directory and updates the cache.
 * 
 * @returns {Promise<Array>} Array of node information
 */
const getNodesFromSource = async () => {
    // Check if cache is still valid
    const now = Date.now();
    if (nodeCache && cacheTimestamp && (now - cacheTimestamp < CACHE_TTL_MS)) {
        logger.debug('Using cached node data');
        return nodeCache;
    }

    logger.debug('Cache invalid or expired, scanning for node data');
    // Scan and cache the nodes
    const nodes = await scanWorkflowNodes();
    nodeCache = nodes;
    cacheTimestamp = now;

    return nodes;
};

/**
 * Sanitize credential parameters in node responses
 * 
 * Processes parameters to ensure any credential-related information
 * is properly sanitized before being included in responses.
 * 
 * @param {Array} parameters - Array of parameters
 * @returns {Array} Sanitized parameters
 */
const sanitizeCredentialParameters = (parameters) => {
    if (!parameters) return [];

    return parameters.map(param => {
        if (param.isCredential) {
            return {
                ...param,
                value: { credentialType: param.name }
            };
        }
        return param;
    });
};

/**
 * Search nodes based on provided filters
 * 
 * Allows searching for nodes based on various criteria including
 * category, keyword, and functionality.
 * 
 * @param {Object} params - Search parameters
 * @param {string} [params.category] - Filter by node category
 * @param {string} [params.keyword] - Search by keyword in name or description
 * @param {string} [params.functionality] - Filter by node functionality
 * @returns {Promise<Object>} Search results with count and nodes
 */
const searchNodes = async (params) => {
    try {
        const { category, keyword, functionality } = params;
        logger.debug('Searching nodes with params:', { category, keyword, functionality });

        // Get all nodes from cache or scan directory
        let nodes = await getNodesFromSource();

        // Apply filters if provided
        if (category) {
            nodes = nodes.filter(node =>
                node.categories.some(cat =>
                    cat.toLowerCase().includes(category.toLowerCase())
                )
            );
        }

        if (keyword) {
            const keywordLower = keyword.toLowerCase();
            nodes = nodes.filter(node =>
                node.name.toLowerCase().includes(keywordLower) ||
                node.description.toLowerCase().includes(keywordLower) ||
                node.id.toLowerCase().includes(keywordLower) ||
                // Also check normalized type and original type if available
                (node.normalizedType && node.normalizedType.includes(keywordLower)) ||
                (node.type && node.type.toLowerCase().includes(keywordLower))
            );
        }

        if (functionality) {
            const functionalityLower = functionality.toLowerCase();
            nodes = nodes.filter(node =>
                node.description.toLowerCase().includes(functionalityLower) ||
                node.categories.some(cat => cat.toLowerCase().includes(functionalityLower))
            );
        }

        // Sanitize any credential-related information in the response
        const sanitizedNodes = nodes.map(node => ({
            id: node.id,
            name: node.name,
            description: node.description,
            parameters: sanitizeCredentialParameters(node.parameters),
            categories: node.categories,
            type: node.type, // Include the node type
            originalNodeType: node.originalNodeType, // Include the original node type with exact casing
            normalizedType: node.normalizedType // Include the normalized node type for reference
        }));

        logger.debug(`Search returned ${sanitizedNodes.length} results`);
        return {
            count: sanitizedNodes.length,
            nodes: sanitizedNodes
        };
    } catch (error) {
        logger.error('Error in searchNodes function:', error);
        throw new Error(`Failed to search nodes: ${error.message}`);
    }
};

/**
 * Tool definition for the search_nodes MCP tool
 * 
 * Registers the search_nodes tool with the MCP server, defining its
 * parameters, description, and implementation.
 */
const searchNodesTool = createTool(
    'Search for available n8n nodes and their parameters',
    {
        category: {
            type: 'string',
            description: 'Filter nodes by category (e.g., "trigger", "http", "database")',
            optional: true
        },
        keyword: {
            type: 'string',
            description: 'Search by name or description',
            optional: true
        },
        functionality: {
            type: 'string',
            description: 'Filter by node functionality/purpose',
            optional: true
        }
    },
    searchNodes
);

// Export the module's functions and tools
module.exports = {
    searchNodesTool,
    scanWorkflowNodes,
    getNodesFromSource,
    searchNodes,
    sanitizeCredentialParameters, // Exported for testing
    // Export cache reset function for testing
    resetCache: () => {
        nodeCache = null;
        cacheTimestamp = null;
    }
}; 