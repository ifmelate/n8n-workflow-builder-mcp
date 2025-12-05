import { z } from 'zod';
import { promises as fs } from 'fs';
import { ToolNames } from '../../utils/constants.js';
import {
    resolveWorkflowPath,
    ensureWorkflowDir,
    ensureWorkflowParentDir,
    PathSecurityError
} from '../../utils/workspace.js';
import type { N8nWorkflow, N8nConnections, N8nConnectionDetail } from '../../types/n8n.js';
import { ok, fail, workflowNotFound, nodeNotFound, McpResponse } from '../responses';
import { mcpLog } from '../../utils/mcpLogger';

export const toolName = ToolNames.delete_node;
export const description = "Delete a node from a workflow";

export const paramsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow containing the node"),
    node_id: z.string().describe("The ID of the node to delete"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});

export type Params = z.infer<typeof paramsSchema>;

export type Result = {
    success: boolean;
    message?: string;
    error?: string;
};

export async function handler(params: Params): Promise<McpResponse> {
    const logger = mcpLog.toolStart('delete_node', params, {
        workflowName: params.workflow_name,
        nodeId: params.node_id
    });

    try {
        const workflowName = params.workflow_name;
        let filePath: string;

        try {
            filePath = resolveWorkflowPath(workflowName, params.workflow_path);
            logger.debug('Resolved workflow file path', { filePath });
        } catch (error) {
            if (error instanceof PathSecurityError) {
                logger.security('path_traversal_attempt', 'Path security violation detected', {
                    attemptedPath: error.attemptedPath,
                    workflowName,
                    workflowPath: params.workflow_path,
                    errorMessage: error.message
                });
                return fail(`Security error: ${error.message}`);
            }
            throw error;
        }

        // Only ensure the default workflow directory if using standard approach
        if (!params.workflow_path) {
            await ensureWorkflowDir();
            logger.debug('Ensured default workflow directory');
        } else {
            // Ensure the parent directory of the custom workflow file exists
            await ensureWorkflowParentDir(filePath);
            logger.debug('Ensured custom workflow parent directory');
        }

        let workflow: N8nWorkflow;
        try {
            const data = await fs.readFile(filePath, 'utf8');
            workflow = JSON.parse(data) as N8nWorkflow;
            logger.debug('Successfully loaded workflow', {
                nodeCount: workflow.nodes.length,
                connectionCount: Object.keys(workflow.connections || {}).length
            });
        } catch (readError: any) {
            if (readError.code === 'ENOENT') {
                logger.warn('Workflow file not found', { filePath });
                return workflowNotFound(workflowName, filePath);
            }
            throw readError;
        }

        const nodeIndex = workflow.nodes.findIndex(n => n.id === params.node_id);
        if (nodeIndex === -1) {
            logger.warn('Node not found in workflow', {
                availableNodes: workflow.nodes.map(n => ({ id: n.id, name: n.name }))
            });
            return nodeNotFound(params.node_id, workflowName);
        }

        const deletedNodeName = workflow.nodes[nodeIndex].name;
        logger.debug('Found node to delete', {
            nodeIndex,
            nodeName: deletedNodeName,
            nodeType: workflow.nodes[nodeIndex].type
        });

        workflow.nodes.splice(nodeIndex, 1);

        // Also remove connections related to this node
        // This is a simplified connection removal. n8n's logic might be more complex.
        const newConnections: N8nConnections = {};
        let removedConnectionsCount = 0;

        for (const sourceNodeName in workflow.connections) {
            if (sourceNodeName === deletedNodeName) {
                removedConnectionsCount++;
                continue; // Skip connections FROM the deleted node
            }

            const outputConnections = workflow.connections[sourceNodeName];
            const newOutputConnectionsForSource: N8nConnections[string] = {};

            for (const outputKey in outputConnections) {
                const connectionChains = outputConnections[outputKey];
                const newConnectionChains: N8nConnectionDetail[][] = [];

                for (const chain of connectionChains) {
                    const originalChainLength = chain.length;
                    const newChain = chain.filter(connDetail => connDetail.node !== deletedNodeName);
                    if (newChain.length < originalChainLength) {
                        removedConnectionsCount++;
                    }
                    if (newChain.length > 0) {
                        newConnectionChains.push(newChain);
                    }
                }
                if (newConnectionChains.length > 0) {
                    newOutputConnectionsForSource[outputKey] = newConnectionChains;
                }
            }
            if (Object.keys(newOutputConnectionsForSource).length > 0) {
                newConnections[sourceNodeName] = newOutputConnectionsForSource;
            }
        }
        workflow.connections = newConnections;

        logger.debug('Cleaned up connections', { removedConnectionsCount });

        await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));

        const result = {
            message: `Node ${params.node_id} deleted successfully from workflow ${workflowName}`
        };

        logger.info('Node deletion completed successfully', {
            deletedNodeName,
            removedConnectionsCount,
            remainingNodeCount: workflow.nodes.length
        });

        mcpLog.toolSuccess(logger, result);
        return ok(result);
    } catch (error: any) {
        mcpLog.toolError(logger, error);
        return fail("Failed to delete node: " + error.message);
    }
}
