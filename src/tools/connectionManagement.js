/**
 * Connection Management Tools
 * 
 * Implements tools for managing connections between nodes in n8n workflows, including:
 * - Creating connections between nodes
 * - Removing connections
 * - Validating connection compatibility
 * - Updating workflow.json connections object
 * - Helper functions for connection management
 * - Connection visualization data generation
 */

const { createTool } = require('../models/tool');
const { workflowStorage } = require('../models/storage');
const { getNodeTypeDefinition } = require('./nodeManagement');
const { logger } = require('../utils/logger');

/**
 * Check if a connection between two nodes is compatible
 * 
 * @param {Object} sourceNode - Source node object
 * @param {Object} targetNode - Target node object
 * @param {string} sourceOutput - Output name on source node
 * @param {string} targetInput - Input name on target node
 * @returns {Promise<boolean>} Whether the connection is compatible
 */
const checkConnectionCompatibility = async (sourceNode, targetNode, sourceOutput = 'main', targetInput = 'main') => {
    try {
        // Get node type definitions
        const sourceNodeDef = await getNodeTypeDefinition(sourceNode.type);
        const targetNodeDef = await getNodeTypeDefinition(targetNode.type);

        if (!sourceNodeDef || !targetNodeDef) {
            logger.warn('Unable to validate connection compatibility due to missing node definitions', {
                sourceType: sourceNode.type,
                targetType: targetNode.type
            });
            // Default to allowing connection if we can't validate
            return true;
        }

        // Check for trigger nodes - triggers can only be source nodes, not target nodes
        const sourceCategories = new Set(sourceNodeDef.categories || []);
        const targetCategories = new Set(targetNodeDef.categories || []);

        if (targetCategories.has('Trigger')) {
            logger.warn('Invalid connection: Target node is a Trigger node', {
                targetType: targetNode.type
            });
            return false;
        }

        // Additional compatibility checks could be added here based on node definitions
        // For now, we'll return true for most connections as n8n is quite flexible

        return true;
    } catch (error) {
        logger.error('Error checking connection compatibility', {
            error: error.message,
            sourceNode: sourceNode.id,
            targetNode: targetNode.id
        });
        // Default to allowing connection if we encounter an error during validation
        return true;
    }
};

/**
 * Create a connection between two nodes in a workflow
 * 
 * @param {Object} params - The parameters for the operation
 * @param {string} params.workflowId - ID or path of the workflow to modify
 * @param {string} params.sourceNodeId - ID of the source node
 * @param {string} params.targetNodeId - ID of the target node
 * @param {string} params.sourceOutput - Output name on source node (default: 'main')
 * @param {string} params.targetInput - Input name on target node (default: 'main')
 * @returns {Promise<Object>} Operation result with updated workflow
 */
const createConnection = async (params) => {
    try {
        const {
            workflowId,
            sourceNodeId,
            targetNodeId,
            sourceOutput = 'main',
            targetInput = 'main'
        } = params;

        logger.info('Creating connection in workflow', {
            workflowId,
            sourceNodeId,
            targetNodeId,
            sourceOutput,
            targetInput
        });

        // Load workflow
        const workflow = await workflowStorage.loadWorkflow(workflowId);
        if (!workflow) {
            throw new Error(`Workflow with ID ${workflowId} not found`);
        }

        // Verify nodes exist
        const sourceNode = workflow.nodes.find(node => node.id === sourceNodeId);
        const targetNode = workflow.nodes.find(node => node.id === targetNodeId);

        if (!sourceNode) {
            throw new Error(`Source node with ID ${sourceNodeId} not found`);
        }

        if (!targetNode) {
            throw new Error(`Target node with ID ${targetNodeId} not found`);
        }

        // Check for self-connections
        if (sourceNodeId === targetNodeId) {
            throw new Error('Cannot create a connection from a node to itself');
        }

        // Verify connection compatibility
        const isCompatible = await checkConnectionCompatibility(sourceNode, targetNode, sourceOutput, targetInput);
        if (!isCompatible) {
            throw new Error(`Connection between ${sourceNode.type} and ${targetNode.type} is not compatible`);
        }

        // Initialize connections object if needed
        if (!workflow.connections) {
            workflow.connections = {};
        }

        if (!workflow.connections[sourceNodeId]) {
            workflow.connections[sourceNodeId] = {};
        }

        if (!workflow.connections[sourceNodeId][sourceOutput]) {
            workflow.connections[sourceNodeId][sourceOutput] = [];
        }

        // Check if connection already exists
        const existingConnection = workflow.connections[sourceNodeId][sourceOutput].find(
            conn => conn.node === targetNodeId && conn.type === targetInput
        );

        if (existingConnection) {
            logger.info('Connection already exists, skipping creation', {
                sourceNodeId,
                targetNodeId,
                sourceOutput,
                targetInput
            });
            return {
                success: true,
                workflow,
                message: 'Connection already exists',
                alreadyExists: true
            };
        }

        // Add connection with proper index
        const connectionsCount = workflow.connections[sourceNodeId][sourceOutput].length;
        workflow.connections[sourceNodeId][sourceOutput].push({
            node: targetNodeId,
            type: targetInput,
            index: connectionsCount
        });

        // Update workflow timestamp
        workflow.updatedAt = new Date().toISOString();

        // Save updated workflow to the same file
        const filePath = workflowId.includes('/') || workflowId.includes('\\') ?
            workflowId : `${workflowId}.json`;

        await workflowStorage.saveWorkflow(workflow.id || 'workflow', workflow, filePath);

        return {
            success: true,
            workflow,
            message: `Connection created from ${sourceNodeId}:${sourceOutput} to ${targetNodeId}:${targetInput}`
        };
    } catch (error) {
        logger.error('Error creating connection', { error: error.message });
        throw new Error(`Failed to create connection: ${error.message}`);
    }
};

/**
 * Remove a connection between two nodes
 * 
 * @param {Object} params - The parameters for the operation
 * @param {string} params.workflowId - ID or path of the workflow to modify
 * @param {string} params.sourceNodeId - ID of the source node
 * @param {string} params.targetNodeId - ID of the target node
 * @param {string} params.sourceOutput - Output name on source node (default: 'main')
 * @param {string} params.targetInput - Input name on target node (default: 'main')
 * @returns {Promise<Object>} Operation result with updated workflow
 */
const removeConnection = async (params) => {
    try {
        const {
            workflowId,
            sourceNodeId,
            targetNodeId,
            sourceOutput = 'main',
            targetInput = 'main'
        } = params;

        logger.info('Removing connection from workflow', {
            workflowId,
            sourceNodeId,
            targetNodeId
        });

        // Load workflow
        const workflow = await workflowStorage.loadWorkflow(workflowId);
        if (!workflow) {
            throw new Error(`Workflow with ID ${workflowId} not found`);
        }

        // Check if the source node has any connections
        if (!workflow.connections ||
            !workflow.connections[sourceNodeId] ||
            !workflow.connections[sourceNodeId][sourceOutput] ||
            !Array.isArray(workflow.connections[sourceNodeId][sourceOutput])) {
            logger.info('No connections found to remove', {
                sourceNodeId,
                targetNodeId
            });
            return {
                success: true,
                workflow,
                message: 'No matching connection found to remove',
                removed: false
            };
        }

        // Find the connection to remove
        const connections = workflow.connections[sourceNodeId][sourceOutput];
        const connectionIndex = connections.findIndex(
            conn => conn.node === targetNodeId && conn.type === targetInput
        );

        if (connectionIndex === -1) {
            return {
                success: true,
                workflow,
                message: 'No matching connection found to remove',
                removed: false
            };
        }

        // Remove the connection
        connections.splice(connectionIndex, 1);

        // Reindex remaining connections
        connections.forEach((conn, index) => {
            conn.index = index;
        });

        // Clean up empty arrays and objects
        if (connections.length === 0) {
            delete workflow.connections[sourceNodeId][sourceOutput];
        }

        if (Object.keys(workflow.connections[sourceNodeId]).length === 0) {
            delete workflow.connections[sourceNodeId];
        }

        // Update workflow timestamp
        workflow.updatedAt = new Date().toISOString();

        // Save updated workflow to the same file
        const filePath = workflowId.includes('/') || workflowId.includes('\\') ?
            workflowId : `${workflowId}.json`;

        await workflowStorage.saveWorkflow(workflow.id || 'workflow', workflow, filePath);

        return {
            success: true,
            workflow,
            message: `Connection removed from ${sourceNodeId}:${sourceOutput} to ${targetNodeId}:${targetInput}`,
            removed: true
        };
    } catch (error) {
        logger.error('Error removing connection', { error: error.message });
        throw new Error(`Failed to remove connection: ${error.message}`);
    }
};

/**
 * Generate connection data for visualization
 * 
 * @param {Object} workflow - The workflow object
 * @returns {Array} Array of connection objects for visualization
 */
const generateConnectionsVisualization = (workflow) => {
    if (!workflow.connections) return [];

    const connections = [];

    // Iterate through all connections in the workflow
    Object.entries(workflow.connections).forEach(([sourceNodeId, outputs]) => {
        Object.entries(outputs).forEach(([outputName, targetConnections]) => {
            targetConnections.forEach(connection => {
                connections.push({
                    id: `${sourceNodeId}-${outputName}-${connection.node}-${connection.type}`,
                    source: sourceNodeId,
                    sourceHandle: outputName,
                    target: connection.node,
                    targetHandle: connection.type,
                    type: 'smoothstep', // Default visualization type
                });
            });
        });
    });

    return connections;
};

/**
 * Remove all connections for a node
 * 
 * @param {Object} params - The parameters for the operation
 * @param {string} params.workflowId - ID or path of the workflow to modify
 * @param {string} params.nodeId - ID of the node to remove connections for
 * @returns {Promise<Object>} Operation result with updated workflow
 */
const removeNodeConnections = async (params) => {
    try {
        const { workflowId, nodeId } = params;

        logger.info('Removing all connections for node', {
            workflowId,
            nodeId
        });

        // Load workflow
        const workflow = await workflowStorage.loadWorkflow(workflowId);
        if (!workflow) {
            throw new Error(`Workflow with ID ${workflowId} not found`);
        }

        if (!workflow.connections) {
            return {
                success: true,
                workflow,
                message: 'No connections found',
                removed: 0
            };
        }

        let removedCount = 0;

        // Remove connections where this node is the source
        if (workflow.connections[nodeId]) {
            delete workflow.connections[nodeId];
            removedCount++;
        }

        // Remove connections where this node is the target
        Object.entries(workflow.connections).forEach(([sourceId, outputs]) => {
            Object.entries(outputs).forEach(([outputName, connections]) => {
                const originalLength = connections.length;
                workflow.connections[sourceId][outputName] = connections.filter(
                    conn => conn.node !== nodeId
                );

                // Reindex the connections
                workflow.connections[sourceId][outputName].forEach((conn, index) => {
                    conn.index = index;
                });

                // Update removed count
                removedCount += originalLength - workflow.connections[sourceId][outputName].length;

                // Clean up empty arrays
                if (workflow.connections[sourceId][outputName].length === 0) {
                    delete workflow.connections[sourceId][outputName];
                }
            });

            // Clean up empty objects
            if (Object.keys(workflow.connections[sourceId]).length === 0) {
                delete workflow.connections[sourceId];
            }
        });

        // Update workflow timestamp
        workflow.updatedAt = new Date().toISOString();

        // Save updated workflow to the same file
        const filePath = workflowId.includes('/') || workflowId.includes('\\') ?
            workflowId : `${workflowId}.json`;

        await workflowStorage.saveWorkflow(workflow.id || 'workflow', workflow, filePath);

        return {
            success: true,
            workflow,
            message: `Removed ${removedCount} connections for node ${nodeId}`,
            removed: removedCount
        };
    } catch (error) {
        logger.error('Error removing node connections', { error: error.message });
        throw new Error(`Failed to remove node connections: ${error.message}`);
    }
};

/**
 * Tool definition for the create_connection MCP tool
 */
const createConnectionTool = createTool(
    'Create a connection between two nodes in a workflow',
    {
        workflowId: {
            type: 'string',
            description: 'ID or path of the workflow to modify'
        },
        sourceNodeId: {
            type: 'string',
            description: 'ID of the source node'
        },
        targetNodeId: {
            type: 'string',
            description: 'ID of the target node'
        },
        sourceOutput: {
            type: 'string',
            description: 'Output name on source node (default: "main")',
            optional: true
        },
        targetInput: {
            type: 'string',
            description: 'Input name on target node (default: "main")',
            optional: true
        }
    },
    createConnection
);

/**
 * Tool definition for the remove_connection MCP tool
 */
const removeConnectionTool = createTool(
    'Remove a connection between two nodes in a workflow',
    {
        workflowId: {
            type: 'string',
            description: 'ID or path of the workflow to modify'
        },
        sourceNodeId: {
            type: 'string',
            description: 'ID of the source node'
        },
        targetNodeId: {
            type: 'string',
            description: 'ID of the target node'
        },
        sourceOutput: {
            type: 'string',
            description: 'Output name on source node (default: "main")',
            optional: true
        },
        targetInput: {
            type: 'string',
            description: 'Input name on target node (default: "main")',
            optional: true
        }
    },
    removeConnection
);

/**
 * Tool definition for the remove_node_connections MCP tool
 */
const removeNodeConnectionsTool = createTool(
    'Remove all connections for a specific node in a workflow',
    {
        workflowId: {
            type: 'string',
            description: 'ID or path of the workflow to modify'
        },
        nodeId: {
            type: 'string',
            description: 'ID of the node to remove connections for'
        }
    },
    removeNodeConnections
);

module.exports = {
    createConnectionTool,
    removeConnectionTool,
    removeNodeConnectionsTool,
    createConnection,
    removeConnection,
    removeNodeConnections,
    checkConnectionCompatibility,
    generateConnectionsVisualization
}; 