import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { N8nWorkflow, N8nWorkflowNode } from '../../types/n8n';
import { resolveWorkflowPath, tryDetectWorkspaceForName } from '../../utils/workspace';
import { ToolNames, ErrorCodes } from '../../utils/constants';
import { loadNodeTypesForCurrentVersion } from '../../validation/nodeTypesLoader';
import { getCurrentN8nVersion } from '../../nodes/versioning';
import { wireAiConnections, createAgentWiringConnections, saveWorkflow, WiringResult } from '../../tools/wiringService';
import { createSuccessResponse, createErrorResponse, createUsageInfo } from '../../utils/responses';
import { v4 as uuidv4 } from 'uuid';

export const toolName = ToolNames.add_ai_connections;
export const description = "Wire AI model, tools, and memory to an agent";

export const paramsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow to add the AI connections to"),
    agent_node_id: z.string().describe("The ID of the agent node that will use the model and tools"),
    model_node_id: z.string().optional().describe("The ID of the language model node (optional)"),
    tool_node_ids: z.array(z.string()).optional().describe("Array of tool node IDs to connect to the agent (optional)"),
    memory_node_id: z.string().optional().describe("The ID of the memory node (optional)"),
    // New optional nodes for extended AI wiring
    embeddings_node_id: z.string().optional().describe("The ID of the embeddings node (optional)"),
    vector_store_node_id: z.string().optional().describe("The ID of the vector store node (optional)"),
    vector_insert_node_id: z.string().optional().describe("The ID of the vector store insert node (optional)"),
    vector_tool_node_id: z.string().optional().describe("The ID of the Vector Store Question Answer Tool node (optional)"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach."),
    // Best practices additions
    idempotency_key: z.string().optional().describe("Optional idempotency key to prevent duplicate operations"),
    dry_run: z.boolean().optional().default(false).describe("If true, returns planned changes without making modifications")
});

export type Params = z.infer<typeof paramsSchema>;
export type Result = {
    content: Array<{
        type: "text";
        text: string;
    }>;
};

export async function handler(params: Params, _extra: any): Promise<Result> {
    const correlationId = uuidv4();
    console.error(`[${correlationId}] add_ai_connections called with:`, Object.keys(params));

    const {
        workflow_name, agent_node_id, model_node_id, tool_node_ids, memory_node_id,
        embeddings_node_id, vector_store_node_id, vector_insert_node_id, vector_tool_node_id,
        workflow_path, idempotency_key, dry_run
    } = params;

    // Validate that at least one connection type is provided
    if (!model_node_id && (!tool_node_ids || tool_node_ids.length === 0) && !memory_node_id &&
        !embeddings_node_id && !vector_store_node_id && !vector_insert_node_id && !vector_tool_node_id) {
        return createErrorResponse(
            "At least one of model_node_id, memory_node_id, tool_node_ids, embeddings_node_id, vector_store_node_id, vector_insert_node_id, or vector_tool_node_id must be provided",
            {
                code: ErrorCodes.VALIDATION_ERROR,
                correlationId,
                retryable: false,
                remediation: "Provide at least one node ID to create AI connections",
                example: {
                    model_node_id: "model_123",
                    memory_node_id: "memory_456"
                }
            }
        );
    }

    try {
        // Resolve and load workflow
        let filePath = resolveWorkflowPath(workflow_name, workflow_path);

        // Auto-detect workspace when path not provided and default path doesn't exist
        try {
            if (!workflow_path) {
                await fs.access(filePath).catch(async () => {
                    const detected = await tryDetectWorkspaceForName(workflow_name);
                    if (detected) filePath = detected;
                });
            }
        } catch { /* ignore detection errors */ }

        let workflow: N8nWorkflow;
        try {
            const data = await fs.readFile(filePath, 'utf8');
            workflow = JSON.parse(data) as N8nWorkflow;
        } catch (readError: any) {
            if (readError.code === 'ENOENT') {
                return createErrorResponse(
                    `Workflow with name ${workflow_name} not found`,
                    {
                        code: ErrorCodes.VALIDATION_ERROR,
                        correlationId,
                        retryable: false,
                        remediation: `Ensure workflow exists at ${filePath} or provide correct workflow_path`,
                        details: { filePath, workflow_name }
                    }
                );
            }
            throw readError;
        }

        // Verify and collect all nodes
        const agentNode = workflow.nodes.find(node => node.id === agent_node_id);
        if (!agentNode) {
            return createErrorResponse(
                `Agent node with ID ${agent_node_id} not found in workflow ${workflow_name}`,
                {
                    code: ErrorCodes.VALIDATION_ERROR,
                    correlationId,
                    retryable: false,
                    remediation: "Verify the agent_node_id exists in the workflow",
                    details: { agent_node_id, workflow_name }
                }
            );
        }

        // Validate agent node type
        try {
            const workflowNodesRootDir = path.resolve(__dirname, '../../../workflow_nodes');
            const nodeTypes = await loadNodeTypesForCurrentVersion(workflowNodesRootDir, getCurrentN8nVersion() || undefined);
            const agentType = nodeTypes.getByNameAndVersion(agentNode.type, (agentNode as any).typeVersion);
            const role = (agentType as any)?.description?.wiring?.role;
            const looksLikeAgent = String(agentNode.type || '').toLowerCase().includes('agent');

            if (role !== 'agent' && !looksLikeAgent) {
                return createErrorResponse(
                    `Node ${agentNode.name} (${agent_node_id}) is not an Agent node`,
                    {
                        code: ErrorCodes.VALIDATION_ERROR,
                        correlationId,
                        retryable: false,
                        remediation: "Provide an agent node ID that points to an actual AI Agent node",
                        details: {
                            nodeName: agentNode.name,
                            nodeType: agentNode.type,
                            expectedRole: 'agent',
                            actualRole: role
                        }
                    }
                );
            }
        } catch (e) {
            console.warn(`[${correlationId}] Could not verify agent node type:`, (e as any)?.message || e);
        }

        // Helper function to find and validate nodes
        const findNode = (nodeId: string | undefined, nodeType: string): N8nWorkflowNode | null => {
            if (!nodeId) return null;
            const node = workflow.nodes.find(n => n.id === nodeId);
            if (!node) {
                throw new Error(`${nodeType} node with ID ${nodeId} not found in workflow ${workflow_name}`);
            }
            return node;
        };

        // Collect all required nodes
        let modelNode: N8nWorkflowNode | null = null;
        let memoryNode: N8nWorkflowNode | null = null;
        let embeddingsNode: N8nWorkflowNode | null = null;
        let vectorStoreNode: N8nWorkflowNode | null = null;
        let vectorInsertNode: N8nWorkflowNode | null = null;
        let vectorToolNode: N8nWorkflowNode | null = null;
        let toolNodes: N8nWorkflowNode[] = [];

        try {
            modelNode = findNode(model_node_id, 'Model');
            memoryNode = findNode(memory_node_id, 'Memory');
            embeddingsNode = findNode(embeddings_node_id, 'Embeddings');
            vectorStoreNode = findNode(vector_store_node_id, 'Vector store');
            vectorInsertNode = findNode(vector_insert_node_id, 'Vector insert');
            vectorToolNode = findNode(vector_tool_node_id, 'Vector tool');

            // Collect tool nodes
            if (tool_node_ids && tool_node_ids.length > 0) {
                for (const toolId of tool_node_ids) {
                    const toolNode = findNode(toolId, 'Tool');
                    if (toolNode) toolNodes.push(toolNode);
                }
            }
        } catch (nodeError: any) {
            return createErrorResponse(
                nodeError.message,
                {
                    code: ErrorCodes.VALIDATION_ERROR,
                    correlationId,
                    retryable: false,
                    remediation: "Verify all provided node IDs exist in the workflow"
                }
            );
        }

        // Create wiring connections using the centralized service
        const connections = createAgentWiringConnections(agentNode, {
            modelNode: modelNode || undefined,
            memoryNode: memoryNode || undefined,
            toolNodes: toolNodes.length > 0 ? toolNodes : undefined,
            embeddingsNode: embeddingsNode || undefined,
            vectorStoreNode: vectorStoreNode || undefined,
            vectorInsertNode: vectorInsertNode || undefined,
            vectorToolNode: vectorToolNode || undefined
        });

        // Ensure vector tool node is included if it exists as a regular tool
        if (!vectorToolNode && vectorStoreNode) {
            const autoVectorTool = toolNodes.find(n => String(n.type).includes('toolVectorStore'));
            if (autoVectorTool) {
                // Add vector store → vector tool connections
                connections.push({
                    fromNode: vectorStoreNode,
                    fromOutput: 'ai_vectorStore',
                    toNode: autoVectorTool,
                    toInput: 'ai_vectorStore'
                });
                // Add model → vector tool connection if model exists
                if (modelNode) {
                    connections.push({
                        fromNode: modelNode,
                        fromOutput: 'ai_languageModel',
                        toNode: autoVectorTool,
                        toInput: 'ai_languageModel'
                    });
                }
            }
        }

        // Wire the connections
        const wiringResult: WiringResult = await wireAiConnections(workflow, connections, {
            correlationId,
            idempotencyKey: idempotency_key,
            dryRun: dry_run
        });

        if (!wiringResult.success) {
            return createErrorResponse(
                "Failed to create AI connections",
                {
                    code: ErrorCodes.TOOL_EXECUTION_ERROR,
                    correlationId,
                    retryable: true,
                    remediation: "Check node types and retry. Some connections may have been partially created.",
                    partial: wiringResult.connectionsCreated > 0,
                    details: {
                        connectionsCreated: wiringResult.connectionsCreated,
                        connectionsSkipped: wiringResult.connectionsSkipped,
                        errors: wiringResult.errors
                    }
                }
            );
        }

        // Save workflow if not dry run
        if (!dry_run) {
            const saveResult = await saveWorkflow(workflow, filePath, correlationId);
            if (!saveResult.success) {
                return createErrorResponse(
                    saveResult.error || "Failed to save workflow",
                    {
                        code: ErrorCodes.TOOL_EXECUTION_ERROR,
                        correlationId,
                        retryable: true,
                        partial: true,
                        remediation: "Connections were created but not saved. Try saving manually or retry the operation."
                    }
                );
            }
        }

        // Build response data
        const responseData = {
            workflowName: workflow_name,
            workflowPath: filePath,
            agent: {
                nodeId: agentNode.id,
                nodeName: agentNode.name
            },
            wiringResult: {
                connectionsCreated: wiringResult.connectionsCreated,
                connectionsSkipped: wiringResult.connectionsSkipped,
                connections: wiringResult.connections
            }
        };

        const changes = wiringResult.connections.map(conn => ({
            type: conn.status as 'created' | 'skipped',
            target: `${conn.from} → ${conn.to}`,
            details: {
                fromOutput: conn.fromOutput,
                toInput: conn.toInput
            }
        }));

        const usage = createUsageInfo({
            connectionsCreated: wiringResult.connectionsCreated,
            connectionsSkipped: wiringResult.connectionsSkipped
        });

        return createSuccessResponse(responseData, {
            correlationId,
            changes,
            usage,
            version: getCurrentN8nVersion() || undefined
        });
    } catch (error: any) {
        console.error(`[${correlationId}] Failed to add AI connections:`, error);
        return createErrorResponse(
            `Failed to add AI connections: ${error.message}`,
            {
                code: ErrorCodes.INTERNAL_SERVER_ERROR,
                correlationId,
                retryable: true,
                remediation: "Check workflow file permissions and node definitions, then retry"
            }
        );
    }
}
