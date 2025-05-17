/**
 * Node Management Tools
 * 
 * Implements tools for managing nodes in n8n workflows, including:
 * - Adding new nodes to existing workflows
 * - Validating node parameters against node type definitions
 * - Generating unique node IDs
 * - Managing node positioning in workflow canvas
 * - Replacing existing nodes while maintaining connections
 */

const { createTool } = require('../models/tool');
const { workflowStorage } = require('../models/storage');
const { getNodesFromSource } = require('./nodeDiscovery');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// In-memory cache for node type case mapping
let NODE_TYPE_CASE_MAP = {};

/**
 * Build the node type case mapping from node definitions
 * 
 * Dynamically creates a mapping of lowercase node types to their properly cased versions
 * based on the node definitions in the workflow_nodes directory.
 * 
 * @returns {Promise<Object>} Mapping of lowercase node types to properly cased versions
 */
const buildNodeTypeCaseMap = async () => {
    try {
        // Get all nodes from the node discovery service
        const nodes = await getNodesFromSource();
        if (!Array.isArray(nodes) || nodes.length === 0) {
            logger.warn('No nodes found for building case map');
            return {};
        }

        const caseMap = {};

        // Process each node to build the case map
        for (const node of nodes) {
            if (node.originalNodeType) {
                // Handle full node type (with prefix)
                const lowerCaseType = node.originalNodeType.toLowerCase();
                caseMap[lowerCaseType] = node.originalNodeType;

                // Also add entry for the node name without prefix
                if (lowerCaseType.startsWith('n8n-nodes-base.')) {
                    const shortName = lowerCaseType.split('n8n-nodes-base.')[1];
                    caseMap[shortName] = node.originalNodeType;
                }
            }

            // Add entry for node ID if it exists
            if (node.id) {
                const nodeId = node.id.toLowerCase();
                const nodeTypeWithPrefix = `n8n-nodes-base.${node.id}`;

                // If we don't already have this mapping (original node type has precedence)
                if (!caseMap[nodeId]) {
                    caseMap[nodeId] = nodeTypeWithPrefix;
                }

                // Also map the full prefixed version
                const prefixedLowerCase = `n8n-nodes-base.${nodeId}`;
                if (!caseMap[prefixedLowerCase]) {
                    caseMap[prefixedLowerCase] = nodeTypeWithPrefix;
                }
            }
        }

        logger.info(`Built node type case map with ${Object.keys(caseMap).length} entries`);
        return caseMap;
    } catch (error) {
        logger.error('Error building node type case map:', error);
        return {};
    }
};

/**
 * Get the properly cased node type for special cases
 * 
 * This function handles both simple node type names (like "openai") 
 * and full node types (like "n8n-nodes-base.openai"), ensuring
 * the proper casing is used in the workflow.
 * 
 * @param {string} nodeType - Node type to check (with or without prefix)
 * @returns {string|null} - Properly cased node type or null if no special case
 */
const getSpecialCaseNodeType = async (nodeType) => {
    if (!nodeType) return null;

    // Ensure the case map is populated
    if (Object.keys(NODE_TYPE_CASE_MAP).length === 0) {
        NODE_TYPE_CASE_MAP = await buildNodeTypeCaseMap();
    }

    // Normalize to lowercase for lookup
    const normalizedType = nodeType.toLowerCase();

    // Check direct mapping first
    if (NODE_TYPE_CASE_MAP[normalizedType]) {
        return NODE_TYPE_CASE_MAP[normalizedType];
    }

    // If no direct match and no prefix, try adding the prefix
    const prefix = 'n8n-nodes-base.';
    if (!normalizedType.includes(prefix)) {
        const withPrefix = prefix + normalizedType;
        if (NODE_TYPE_CASE_MAP[withPrefix]) {
            return NODE_TYPE_CASE_MAP[withPrefix];
        }
    }

    // For backwards compatibility: try to extract node name and apply casing
    if (normalizedType.startsWith(prefix)) {
        const nodeName = normalizedType.replace(prefix, '');
        if (NODE_TYPE_CASE_MAP[nodeName]) {
            return NODE_TYPE_CASE_MAP[nodeName];
        }
    }

    // If we don't have a specific mapping, check if we need to add the prefix
    if (!normalizedType.startsWith(prefix)) {
        return prefix + normalizedType;
    }

    // Return the original if all else fails
    return nodeType;
};

// Load the node type case map on module initialization
buildNodeTypeCaseMap().then(caseMap => {
    NODE_TYPE_CASE_MAP = caseMap;
}).catch(error => {
    logger.error('Failed to initialize node type case map:', error);
});

/**
 * Generate a unique ID for a node within a workflow
 * 
 * @param {Object} workflow - The workflow object
 * @returns {string} Unique node ID
 */
const generateUniqueNodeId = (workflow) => {
    // Base ID on node type or use a random string
    const baseId = 'node';

    // Find the highest numbered ID with this base
    let maxNumber = 0;
    if (workflow.nodes && Array.isArray(workflow.nodes)) {
        workflow.nodes.forEach(node => {
            if (node.id && node.id.startsWith(baseId)) {
                const numStr = node.id.replace(baseId, '');
                const num = parseInt(numStr, 10);
                if (!isNaN(num) && num > maxNumber) {
                    maxNumber = num;
                }
            }
        });
    }

    // Generate the next available ID
    return `${baseId}${maxNumber + 1}`;
};

/**
 * Find node type definition from available nodes
 * 
 * @param {string} nodeType - Type of node to find
 * @returns {Promise<Object|null>} Node type definition or null if not found
 */
const getNodeTypeDefinition = async (nodeType) => {
    const nodesData = await getNodesFromSource();
    const nodes = Array.isArray(nodesData) ? nodesData : []; // Ensure we have an array
    const filenameMap = nodesData.filenameMap || {}; // Get the filename map if available

    // Handle case insensitive matching and potential camelCase vs lowercase inconsistencies
    // First convert to lowercase for node type comparison
    const normalizedNodeType = nodeType.toLowerCase();

    // Check if we're looking for a node with just the node name or the full n8n-nodes-base prefix
    const hasPrefix = normalizedNodeType.startsWith('n8n-nodes-base.');
    let nodeNameOnly = normalizedNodeType;

    if (hasPrefix) {
        // If it has the prefix, extract just the node name for lookups
        nodeNameOnly = normalizedNodeType.split('n8n-nodes-base.')[1];
    }

    // Check if we have this node name in our filename map, which preserves original casing
    const originalCaseNodeName = filenameMap[nodeNameOnly];

    // First try to find by exact ID match (the filename minus extension)
    let matchedNode = nodes.find(node => node.id.toLowerCase() === nodeNameOnly);

    // Next, if we have a prefix, try to match by the originalNodeType which has exact casing
    if (!matchedNode && hasPrefix) {
        matchedNode = nodes.find(node =>
            node.originalNodeType && node.originalNodeType.toLowerCase() === normalizedNodeType);
    }

    // If still no match, try nodeType matching with originals
    if (!matchedNode) {
        matchedNode = nodes.find(node => {
            // Check both the node ID and the file name for matches
            const nodeIdMatch = node.id.toLowerCase() === nodeNameOnly;

            // Check if the normalized version of the node type matches
            const normalizedTypeMatch = node.normalizedType &&
                nodeNameOnly === node.normalizedType;

            // Check if the type fields match (case insensitive)
            const nodeTypeMatch = (
                (node.type && node.type.toLowerCase() === normalizedNodeType) ||
                (node.originalNodeType && node.originalNodeType.toLowerCase() === normalizedNodeType) ||
                (hasPrefix && node.id.toLowerCase() === nodeNameOnly)
            );

            return nodeIdMatch || normalizedTypeMatch || nodeTypeMatch;
        });
    }

    // If we found a match at this point, return it
    if (matchedNode) {
        // Log for debugging
        logger.debug(`Found node match for ${nodeType}:`, {
            id: matchedNode.id,
            type: matchedNode.type,
            originalNodeType: matchedNode.originalNodeType
        });

        return matchedNode;
    }

    // If all else fails, do a broader search that's less precise
    matchedNode = nodes.find(node => {
        return node.id.toLowerCase().includes(nodeNameOnly) ||
            (node.type && node.type.toLowerCase().includes(nodeNameOnly)) ||
            (node.originalNodeType && node.originalNodeType.toLowerCase().includes(nodeNameOnly));
    });

    return matchedNode || null;
};

/**
 * Validate node parameters against the node type definition
 * 
 * @param {Object} nodeTypeDef - Node type definition
 * @param {Object} parameters - Node parameters to validate
 * @returns {boolean} True if valid, throws error if invalid
 */
const validateNodeParameters = (nodeTypeDef, parameters) => {
    if (!parameters) return true;

    // For now, perform basic validation
    // A more comprehensive validation would check against parameter schema

    // Check that all required parameters are present
    const requiredParams = nodeTypeDef.parameters
        .filter(param => param.required)
        .map(param => param.name);

    const missingParams = requiredParams.filter(name =>
        !parameters.hasOwnProperty(name)
    );

    if (missingParams.length > 0) {
        throw new Error(`Missing required parameters: ${missingParams.join(', ')}`);
    }

    return true;
};

/**
 * Check if connections between two node types are compatible
 * 
 * @param {Object} originalNodeDef - Original node definition
 * @param {Object} newNodeDef - New node definition
 * @returns {Object} Compatibility assessment with input and output compatibility
 */
const checkConnectionCompatibility = (originalNodeDef, newNodeDef) => {
    // Default to uncertain compatibility if we can't determine
    const defaultCompatibility = {
        inputCompatible: true,
        outputCompatible: true,
        warnings: []
    };

    // If either definition is missing, we can't make a determination
    if (!originalNodeDef || !newNodeDef) {
        return {
            inputCompatible: true, // Assume compatible for safety
            outputCompatible: true, // Assume compatible for safety
            warnings: ['Could not determine connection compatibility due to missing node definitions']
        };
    }

    // Start with simple category compatibility checks
    const originalCategories = new Set(originalNodeDef.categories || []);
    const newCategories = new Set(newNodeDef.categories || []);

    const compatibility = {
        inputCompatible: true,
        outputCompatible: true,
        warnings: []
    };

    // If original was a trigger and new is not, that's an incompatibility
    if (originalCategories.has('Trigger') && !newCategories.has('Trigger')) {
        compatibility.inputCompatible = false;
        compatibility.warnings.push('Original node was a Trigger but new node is not');
    }

    // Parameter structure incompatibility check (basic)
    const originalParamCount = originalNodeDef.parameters?.length || 0;
    const newParamCount = newNodeDef.parameters?.length || 0;

    if (originalParamCount > newParamCount + 5) {
        compatibility.warnings.push('New node has significantly fewer parameters than original node');
    }

    return compatibility;
};

/**
 * Update connections for replaced node based on compatibility
 * 
 * @param {Object} workflow - The workflow object
 * @param {string} nodeId - ID of the replaced node
 * @param {string} originalNodeType - Original node type
 * @param {string} newNodeType - New node type
 * @returns {Object} Updated workflow with adjusted connections
 */
const updateConnectionsForReplacedNode = async (workflow, nodeId, originalNodeType, newNodeType) => {
    // Get node definitions for checking compatibility using the updated case-insensitive matching
    // The original node type might have camelCase that needs to be handled
    const originalNodeDef = await getNodeTypeDefinition(originalNodeType);
    const newNodeDef = await getNodeTypeDefinition(newNodeType);

    // Check connection compatibility
    const compatibility = checkConnectionCompatibility(originalNodeDef, newNodeDef);

    // If no connections to modify or we're keeping all, return as is
    if (!workflow.connections || !Array.isArray(workflow.connections)) {
        return {
            workflow,
            compatibility
        };
    }

    // Check each connection
    if (!compatibility.inputCompatible || !compatibility.outputCompatible) {
        // Filter connections that need adjustment
        workflow.connections = workflow.connections.filter(connection => {
            // If this node is the source and output compatibility is false, remove
            if (connection.source.node === nodeId && !compatibility.outputCompatible) {
                return false;
            }

            // If this node is the target and input compatibility is false, remove
            if (connection.target.node === nodeId && !compatibility.inputCompatible) {
                return false;
            }

            return true;
        });
    }

    return {
        workflow,
        compatibility
    };
};

/**
 * Add a node to an existing workflow
 * 
 * @param {Object} params - The parameters for the operation
 * @param {string} params.workflowId - ID or path of the workflow to modify
 * @param {string} params.nodeType - Type of node to add
 * @param {Object} params.position - Position on the canvas {x, y}
 * @param {Object} params.parameters - Node parameters
 * @returns {Promise<Object>} Operation result with updated workflow
 */
const addNode = async (params) => {
    try {
        const { workflowId, nodeType, position, parameters, nodeName } = params;
        logger.info('Adding node to workflow', { workflowId, nodeType });

        // Load workflow
        const workflow = await workflowStorage.loadWorkflow(workflowId);
        if (!workflow) {
            throw new Error(`Workflow with ID ${workflowId} not found`);
        }

        // Initialize nodes array if it doesn't exist
        if (!workflow.nodes) {
            workflow.nodes = [];
        }

        // Get node type definition with case-insensitive matching
        const nodeTypeDef = await getNodeTypeDefinition(nodeType);
        if (!nodeTypeDef) {
            throw new Error(`Node type ${nodeType} not found`);
        }

        // Log for debugging
        logger.info('Node definition found:', {
            id: nodeTypeDef.id,
            type: nodeTypeDef.type,
            originalNodeType: nodeTypeDef.originalNodeType,
            normalizedType: nodeTypeDef.normalizedType,
            fileName: nodeTypeDef.fileName
        });

        // Validate parameters against node type definition
        validateNodeParameters(nodeTypeDef, parameters);

        // Generate unique node ID
        const nodeId = generateUniqueNodeId(workflow);

        // Use the original node type format from the definition when available
        // This preserves the exact casing as in the node definition file
        // which is important for proper node type resolution in n8n
        let actualNodeType;

        // First check for special case node types that need specific casing
        const specialCaseNodeType = await getSpecialCaseNodeType(nodeType);
        if (specialCaseNodeType) {
            actualNodeType = specialCaseNodeType;
            logger.info(`Special case handling for ${nodeType}, using: ${actualNodeType}`);
        }
        // Check if the nodeType is directly found in the node definition
        else if (nodeTypeDef.originalNodeType) {
            actualNodeType = nodeTypeDef.originalNodeType; // Use exact casing from JSON file
            logger.info(`Using originalNodeType: ${actualNodeType}`);
        } else if (nodeTypeDef.type) {
            actualNodeType = nodeTypeDef.type;
            logger.info(`Using type from node definition: ${actualNodeType}`);
        } else if (nodeTypeDef.id) {
            // If we have node ID but no type, reconstruct it with prefix
            actualNodeType = `n8n-nodes-base.${nodeTypeDef.id}`;
            logger.info(`Reconstructed from ID: ${actualNodeType}`);
        } else {
            // Fallback to user provided type
            actualNodeType = nodeType;
            logger.info(`Using original nodeType: ${actualNodeType}`);
        }

        // Create node object
        const newNode = {
            id: nodeId,
            name: nodeName || nodeTypeDef.name || nodeType,
            type: actualNodeType,
            position: position || { x: 100, y: 100 },
            parameters: parameters || {},
            typeVersion: nodeTypeDef.typeVersion || 1
        };

        // Add node to workflow
        workflow.nodes.push(newNode);

        // Update workflow timestamp
        workflow.updatedAt = new Date().toISOString();

        // Save updated workflow to the same file
        // The filePath should be extracted from the workflowId if it's already a path
        const filePath = workflowId.includes('/') || workflowId.includes('\\') ?
            workflowId : `${workflowId}.json`;

        await workflowStorage.saveWorkflow(workflow.id || 'workflow', workflow, filePath);

        return {
            success: true,
            nodeId,
            workflow,
            message: `Node ${nodeId} added successfully to workflow`
        };
    } catch (error) {
        logger.error('Error adding node to workflow', { error: error.message });
        throw new Error(`Failed to add node: ${error.message}`);
    }
};

/**
 * Replace a node in an existing workflow
 * 
 * @param {Object} params - The parameters for the operation
 * @param {string} params.workflowId - ID or path of the workflow to modify
 * @param {string} params.targetNodeId - ID of the node to replace
 * @param {string} params.newNodeType - Type of the new node
 * @param {Object} params.parameters - Parameters for the new node
 * @param {string} [params.nodeName] - Optional custom name for the node
 * @returns {Promise<Object>} Operation result with updated workflow
 */
const replaceNode = async (params) => {
    try {
        const { workflowId, targetNodeId, newNodeType, parameters, nodeName } = params;
        logger.info('Replacing node in workflow', { workflowId, targetNodeId, newNodeType });

        // Load workflow
        const workflow = await workflowStorage.loadWorkflow(workflowId);
        if (!workflow) {
            throw new Error(`Workflow with ID ${workflowId} not found`);
        }

        // Find target node
        const targetNodeIndex = workflow.nodes.findIndex(node => node.id === targetNodeId);
        if (targetNodeIndex === -1) {
            throw new Error(`Node with ID ${targetNodeId} not found in workflow`);
        }

        // Get node type definition with case-insensitive matching
        const nodeTypeDef = await getNodeTypeDefinition(newNodeType);
        if (!nodeTypeDef) {
            throw new Error(`Node type ${newNodeType} not found`);
        }

        // Store original node for compatibility checking
        const originalNode = workflow.nodes[targetNodeIndex];
        const originalNodeType = originalNode.type;

        // Validate parameters against node type definition
        validateNodeParameters(nodeTypeDef, parameters);

        // Use the original node type format from the definition when available
        // This preserves the exact casing as in the node definition file
        let actualNodeType;

        // First check for special case node types that need specific casing
        const specialCaseNodeType = await getSpecialCaseNodeType(newNodeType);
        if (specialCaseNodeType) {
            actualNodeType = specialCaseNodeType;
            logger.info(`Special case handling for ${newNodeType}, using: ${actualNodeType}`);
        }
        // Check if the nodeType is directly found in the node definition
        else if (nodeTypeDef.originalNodeType) {
            actualNodeType = nodeTypeDef.originalNodeType; // Use exact casing from JSON file
            logger.info(`Using originalNodeType: ${actualNodeType}`);
        } else if (nodeTypeDef.type) {
            actualNodeType = nodeTypeDef.type;
            logger.info(`Using type from node definition: ${actualNodeType}`);
        } else if (nodeTypeDef.id) {
            // If we have node ID but no type, reconstruct it with prefix
            actualNodeType = `n8n-nodes-base.${nodeTypeDef.id}`;
            logger.info(`Reconstructed from ID: ${actualNodeType}`);
        } else {
            // Fallback to user provided type
            actualNodeType = newNodeType;
            logger.info(`Using original nodeType: ${actualNodeType}`);
        }

        // Create new node object, maintaining position and ID
        const newNode = {
            id: targetNodeId, // Keep same ID to maintain connections
            name: nodeName || nodeTypeDef.name || newNodeType,
            type: actualNodeType,
            position: originalNode.position,
            parameters: parameters || {},
            typeVersion: nodeTypeDef.typeVersion || 1
        };

        // Replace node in workflow
        workflow.nodes[targetNodeIndex] = newNode;

        // Update workflow timestamp
        workflow.updatedAt = new Date().toISOString();

        // Check connection compatibility and adjust connections if needed
        const { workflow: updatedWorkflow, compatibility } =
            await updateConnectionsForReplacedNode(workflow, targetNodeId, originalNodeType, newNodeType);

        // Save updated workflow
        const filePath = workflowId.includes('/') || workflowId.includes('\\') ?
            workflowId : `${workflowId}.json`;

        await workflowStorage.saveWorkflow(updatedWorkflow.id || 'workflow', updatedWorkflow, filePath);

        return {
            success: true,
            nodeId: targetNodeId,
            workflow: updatedWorkflow,
            compatibility: compatibility.warnings, // Include compatibility warnings in response
            message: `Node ${targetNodeId} replaced successfully with ${newNodeType}`
        };
    } catch (error) {
        logger.error('Error replacing node in workflow', { error: error.message });
        throw new Error(`Failed to replace node: ${error.message}`);
    }
};

/**
 * Tool definition for the add_node MCP tool
 */
const addNodeTool = createTool(
    'Add a node to an existing workflow',
    {
        workflowId: {
            type: 'string',
            description: 'ID or path of the workflow to add the node to'
        },
        nodeType: {
            type: 'string',
            description: 'Type of node to add (e.g., "gmail", "slack", "openai"). Use the list_available_nodes tool to see all available nodes with their correct casing. The system will automatically handle proper casing and prefixing for you.'
        },
        nodeName: {
            type: 'string',
            description: 'Custom display name for the node in the workflow',
            optional: true
        },
        position: {
            type: 'object',
            description: 'Position of the node in the workflow canvas',
            properties: {
                x: { type: 'number' },
                y: { type: 'number' }
            },
            optional: true
        },
        parameters: {
            type: 'object',
            description: 'Parameters for the node',
            optional: true
        }
    },
    addNode
);

/**
 * Tool definition for the replace_node MCP tool
 */
const replaceNodeTool = createTool(
    'Replace an existing node in a workflow with a new node type while maintaining connections where possible',
    {
        workflowId: {
            type: 'string',
            description: 'ID or path of the workflow containing the node'
        },
        targetNodeId: {
            type: 'string',
            description: 'ID of the node to replace'
        },
        newNodeType: {
            type: 'string',
            description: 'Type of node to replace with (e.g., "gmail", "slack", "openai"). Use the list_available_nodes tool to see all available nodes with their correct casing. The system will automatically handle proper casing and prefixing for you.'
        },
        nodeName: {
            type: 'string',
            description: 'Custom display name for the new node in the workflow',
            optional: true
        },
        parameters: {
            type: 'object',
            description: 'Parameters for the new node',
            optional: true
        }
    },
    replaceNode
);

module.exports = {
    addNodeTool,
    replaceNodeTool,
    addNode,
    replaceNode,
    generateUniqueNodeId,
    getNodeTypeDefinition,
    validateNodeParameters,
    checkConnectionCompatibility,
    updateConnectionsForReplacedNode,
    getSpecialCaseNodeType,
    buildNodeTypeCaseMap
}; 