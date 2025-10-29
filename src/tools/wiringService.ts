/**
 * Centralized wiring service for AI connections
 * Single source of truth for all AI node wiring logic
 */
import { N8nWorkflow, N8nWorkflowNode, N8nConnectionDetail } from '../types/n8n';
import { ErrorCodes } from '../utils/constants';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';

export interface WiringConnection {
    fromNode: N8nWorkflowNode;
    fromOutput: string;
    toNode: N8nWorkflowNode;
    toInput: string;
}

export interface WiringResult {
    success: boolean;
    correlationId: string;
    connectionsCreated: number;
    connectionsSkipped: number;
    connections: Array<{
        from: string;
        fromOutput: string;
        to: string;
        toInput: string;
        status: 'created' | 'skipped' | 'error';
    }>;
    errors?: Array<{
        code: string;
        message: string;
        retryable?: boolean;
        remediation?: string;
    }>;
}

/**
 * Node connection types mapping - single source of truth for port names
 */
export const NodeConnectionTypes = {
    AI_LANGUAGE_MODEL: 'ai_languageModel',
    AI_TOOL: 'ai_tool',
    AI_MEMORY: 'ai_memory',
    AI_EMBEDDING: 'ai_embedding',
    AI_DOCUMENT: 'ai_document',
    AI_VECTOR_STORE: 'ai_vectorStore',
    MAIN: 'main'
} as const;

export type NodeConnectionType = typeof NodeConnectionTypes[keyof typeof NodeConnectionTypes];

/**
 * Check if a connection already exists between two nodes
 */
function connectionExists(
    workflow: N8nWorkflow,
    fromNodeName: string,
    fromOutput: string,
    toNodeName: string,
    toInput: string
): boolean {
    if (!workflow.connections?.[fromNodeName]?.[fromOutput]) {
        return false;
    }

    const connectionGroups = workflow.connections[fromNodeName][fromOutput];
    return connectionGroups.some(group =>
        Array.isArray(group) && group.some(detail =>
            detail?.node === toNodeName && detail?.type === toInput
        )
    );
}

/**
 * Add a single connection between two nodes with deduplication
 */
function addConnection(
    workflow: N8nWorkflow,
    fromNode: N8nWorkflowNode,
    fromOutput: string,
    toNode: N8nWorkflowNode,
    toInput: string,
    correlationId: string
): { created: boolean; error?: string } {
    try {
        if (!workflow.connections) {
            workflow.connections = {};
        }

        const fromName = fromNode.name;
        const toName = toNode.name;

        // Check if connection already exists (deduplication)
        if (connectionExists(workflow, fromName, fromOutput, toName, toInput)) {
            console.log(`[${correlationId}] Connection already exists: ${fromName}.${fromOutput} → ${toName}.${toInput}`);
            return { created: false };
        }

        // Initialize connection structure if needed
        if (!workflow.connections[fromName]) {
            workflow.connections[fromName] = {};
        }
        if (!workflow.connections[fromName][fromOutput]) {
            workflow.connections[fromName][fromOutput] = [];
        }

        // Add the connection
        const connectionDetail: N8nConnectionDetail = {
            node: toName,
            type: toInput,
            index: 0
        };

        workflow.connections[fromName][fromOutput].push([connectionDetail]);
        console.log(`[${correlationId}] Created connection: ${fromName}.${fromOutput} → ${toName}.${toInput}`);
        return { created: true };

    } catch (error: any) {
        const message = `Failed to create connection ${fromNode.name}.${fromOutput} → ${toNode.name}.${toInput}: ${error.message}`;
        console.error(`[${correlationId}] ${message}`);
        return { created: false, error: message };
    }
}

/**
 * Wire AI connections with idempotency and detailed reporting
 */
export async function wireAiConnections(
    workflow: N8nWorkflow,
    connections: WiringConnection[],
    options: {
        correlationId?: string;
        idempotencyKey?: string;
        dryRun?: boolean;
    } = {}
): Promise<WiringResult> {
    const correlationId = options.correlationId || uuidv4();
    const result: WiringResult = {
        success: true,
        correlationId,
        connectionsCreated: 0,
        connectionsSkipped: 0,
        connections: [],
        errors: []
    };

    if (options.dryRun) {
        console.log(`[${correlationId}] Dry run mode - no connections will be created`);
    }

    for (const connection of connections) {
        try {
            const { fromNode, fromOutput, toNode, toInput } = connection;

            if (!fromNode || !toNode) {
                result.errors?.push({
                    code: ErrorCodes.VALIDATION_ERROR,
                    message: `Invalid connection: missing source or target node`,
                    retryable: false,
                    remediation: 'Ensure both fromNode and toNode are provided'
                });
                result.success = false;
                continue;
            }

            const connectionResult = options.dryRun
                ? { created: !connectionExists(workflow, fromNode.name, fromOutput, toNode.name, toInput) }
                : addConnection(workflow, fromNode, fromOutput, toNode, toInput, correlationId);

            if (connectionResult.error) {
                result.errors?.push({
                    code: ErrorCodes.TOOL_EXECUTION_ERROR,
                    message: connectionResult.error,
                    retryable: true,
                    remediation: 'Verify node names and types are correct'
                });
                result.success = false;
            }

            const status = connectionResult.created ? 'created' : 'skipped';
            if (connectionResult.created) {
                result.connectionsCreated++;
            } else {
                result.connectionsSkipped++;
            }

            result.connections.push({
                from: `${fromNode.name} (${fromNode.id})`,
                fromOutput,
                to: `${toNode.name} (${toNode.id})`,
                toInput,
                status
            });

        } catch (error: any) {
            result.errors?.push({
                code: ErrorCodes.TOOL_EXECUTION_ERROR,
                message: `Failed to process connection: ${error.message}`,
                retryable: true,
                remediation: 'Check connection parameters and try again'
            });
            result.success = false;
        }
    }

    return result;
}

/**
 * Create standard AI agent wiring connections
 */
export function createAgentWiringConnections(
    agentNode: N8nWorkflowNode,
    options: {
        modelNode?: N8nWorkflowNode;
        memoryNode?: N8nWorkflowNode;
        toolNodes?: N8nWorkflowNode[];
        embeddingsNode?: N8nWorkflowNode;
        vectorStoreNode?: N8nWorkflowNode;
        vectorInsertNode?: N8nWorkflowNode;
        vectorToolNode?: N8nWorkflowNode;
    } = {}
): WiringConnection[] {
    const connections: WiringConnection[] = [];

    // Model → Agent (ai_languageModel)
    if (options.modelNode) {
        connections.push({
            fromNode: options.modelNode,
            fromOutput: NodeConnectionTypes.AI_LANGUAGE_MODEL,
            toNode: agentNode,
            toInput: NodeConnectionTypes.AI_LANGUAGE_MODEL
        });
    }

    // Memory → Agent (ai_memory)
    if (options.memoryNode) {
        connections.push({
            fromNode: options.memoryNode,
            fromOutput: NodeConnectionTypes.AI_MEMORY,
            toNode: agentNode,
            toInput: NodeConnectionTypes.AI_MEMORY
        });
    }

    // Tools → Agent (ai_tool)
    if (options.toolNodes) {
        for (const toolNode of options.toolNodes) {
            connections.push({
                fromNode: toolNode,
                fromOutput: NodeConnectionTypes.AI_TOOL,
                toNode: agentNode,
                toInput: NodeConnectionTypes.AI_TOOL
            });
        }
    }

    // Embeddings → Vector Store (ai_embedding)
    if (options.embeddingsNode && options.vectorStoreNode) {
        connections.push({
            fromNode: options.embeddingsNode,
            fromOutput: NodeConnectionTypes.AI_EMBEDDING,
            toNode: options.vectorStoreNode,
            toInput: NodeConnectionTypes.AI_EMBEDDING
        });
    }

    // Vector Store → Vector Insert (ai_document)
    if (options.vectorStoreNode && options.vectorInsertNode) {
        connections.push({
            fromNode: options.vectorStoreNode,
            fromOutput: NodeConnectionTypes.AI_DOCUMENT,
            toNode: options.vectorInsertNode,
            toInput: NodeConnectionTypes.AI_DOCUMENT
        });
    }

    // Vector Store → Vector Tool (ai_vectorStore)
    if (options.vectorStoreNode && options.vectorToolNode) {
        connections.push({
            fromNode: options.vectorStoreNode,
            fromOutput: NodeConnectionTypes.AI_VECTOR_STORE,
            toNode: options.vectorToolNode,
            toInput: NodeConnectionTypes.AI_VECTOR_STORE
        });
    }

    // Model → Vector Tool (ai_languageModel)
    if (options.modelNode && options.vectorToolNode) {
        connections.push({
            fromNode: options.modelNode,
            fromOutput: NodeConnectionTypes.AI_LANGUAGE_MODEL,
            toNode: options.vectorToolNode,
            toInput: NodeConnectionTypes.AI_LANGUAGE_MODEL
        });
    }

    return connections;
}

/**
 * Save workflow with error handling
 */
export async function saveWorkflow(
    workflow: N8nWorkflow,
    filePath: string,
    correlationId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
        console.log(`[${correlationId}] Workflow saved to ${filePath}`);
        return { success: true };
    } catch (error: any) {
        const message = `Failed to save workflow: ${error.message}`;
        console.error(`[${correlationId}] ${message}`);
        return { success: false, error: message };
    }
}



