/**
 * Standardized response utilities for MCP tools
 * Implements 2025 best practices for structured responses and error taxonomy
 */
import { ErrorCodes } from './constants';
import { v4 as uuidv4 } from 'uuid';

export interface StructuredResponse {
    success: boolean;
    correlationId: string;
    timestamp: string;
    version?: string;
    data?: any;
    changes?: Array<{
        type: 'created' | 'updated' | 'deleted' | 'connected' | 'skipped';
        target: string;
        details?: any;
    }>;
    remainingIssues?: Array<{
        code: string;
        message: string;
        severity: 'error' | 'warning' | 'info';
        nodeName?: string;
        details?: any;
    }>;
    suggestedActions?: Array<{
        type: 'add_connection' | 'add_ai_connections' | 'add_node' | 'edit_node' | 'fix_rag_warnings' | 'connect_main_chain' | 'check_configuration' | 'general_advice';
        title: string;
        description?: string;
        params?: Record<string, any>;
        example?: any;
    }>;
    actionPlan?: Array<{
        step: number;
        tool: string;
        title?: string;
        params: Record<string, any>;
        note?: string;
    }>;
    usage?: {
        nodesCreated?: number;
        connectionsCreated?: number;
        connectionsSkipped?: number;
        cost?: number;
        quota?: {
            used: number;
            limit: number;
        };
    };
    errors?: Array<{
        code: string;
        message: string;
        retryable?: boolean;
        partial?: boolean;
        remediation?: string;
        example?: any;
    }>;
}

export interface McpToolResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
    [key: string]: unknown;
}

/**
 * Create a successful structured response
 */
export function createSuccessResponse(
    data: any,
    options: {
        correlationId?: string;
        changes?: StructuredResponse['changes'];
        suggestedActions?: StructuredResponse['suggestedActions'];
        actionPlan?: StructuredResponse['actionPlan'];
        usage?: StructuredResponse['usage'];
        remainingIssues?: StructuredResponse['remainingIssues'];
        version?: string;
    } = {}
): McpToolResult {
    const response: StructuredResponse = {
        success: true,
        correlationId: options.correlationId || uuidv4(),
        timestamp: new Date().toISOString(),
        version: options.version,
        data,
        changes: options.changes,
        suggestedActions: options.suggestedActions,
        actionPlan: options.actionPlan,
        usage: options.usage,
        remainingIssues: options.remainingIssues
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(response, null, 2)
        }]
    };
}

/**
 * Create an error response with structured error taxonomy
 */
export function createErrorResponse(
    message: string,
    options: {
        code?: string;
        correlationId?: string;
        retryable?: boolean;
        partial?: boolean;
        remediation?: string;
        example?: any;
        details?: any;
        suggestedActions?: StructuredResponse['suggestedActions'];
        actionPlan?: StructuredResponse['actionPlan'];
        version?: string;
    } = {}
): McpToolResult {
    const response: StructuredResponse = {
        success: false,
        correlationId: options.correlationId || uuidv4(),
        timestamp: new Date().toISOString(),
        version: options.version,
        errors: [{
            code: options.code || ErrorCodes.ERROR,
            message,
            retryable: options.retryable,
            partial: options.partial,
            remediation: options.remediation,
            example: options.example
        }],
        suggestedActions: options.suggestedActions,
        actionPlan: options.actionPlan
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(response, null, 2)
        }]
    };
}

/**
 * Create suggested action for adding a connection
 */
export function createConnectionSuggestion(
    title: string,
    workflowName: string,
    sourceNodeId: string,
    sourceOutput: string,
    targetNodeId: string,
    targetInput: string,
    options: {
        description?: string;
        targetInputIndex?: number;
    } = {}
): NonNullable<StructuredResponse['suggestedActions']>[number] {
    return {
        type: 'add_connection',
        title,
        description: options.description,
        params: {
            workflow_name: workflowName,
            source_node_id: sourceNodeId,
            source_node_output_name: sourceOutput,
            target_node_id: targetNodeId,
            target_node_input_name: targetInput,
            target_node_input_index: options.targetInputIndex || 0
        }
    };
}

/**
 * Create suggested action for AI connections
 */
export function createAiConnectionsSuggestion(
    title: string,
    workflowName: string,
    agentNodeId: string,
    options: {
        description?: string;
        modelNodeId?: string;
        toolNodeIds?: string[];
        memoryNodeId?: string;
        embeddingsNodeId?: string;
        vectorStoreNodeId?: string;
        vectorInsertNodeId?: string;
        vectorToolNodeId?: string;
    } = {}
): NonNullable<StructuredResponse['suggestedActions']>[number] {
    return {
        type: 'add_ai_connections',
        title,
        description: options.description || 'Wire AI model, tools, and memory to agent',
        params: {
            workflow_name: workflowName,
            agent_node_id: agentNodeId,
            model_node_id: options.modelNodeId,
            tool_node_ids: options.toolNodeIds,
            memory_node_id: options.memoryNodeId,
            embeddings_node_id: options.embeddingsNodeId,
            vector_store_node_id: options.vectorStoreNodeId,
            vector_insert_node_id: options.vectorInsertNodeId,
            vector_tool_node_id: options.vectorToolNodeId
        }
    };
}

/**
 * Create an action plan (ordered tool calls)
 */
export function createActionPlan(steps: Array<{
    tool: string;
    title?: string;
    params: Record<string, any>;
    note?: string;
}>): StructuredResponse['actionPlan'] {
    return steps.map((s, idx) => ({ step: idx + 1, tool: s.tool, title: s.title, params: s.params, note: s.note }));
}

/**
 * Create suggested action for adding a node
 */
export function createAddNodeSuggestion(
    title: string,
    workflowName: string,
    nodeType: string,
    nodeName: string,
    options: {
        description?: string;
        parameters?: Record<string, any>;
        position?: { x: number; y: number };
        connectFrom?: Array<{
            sourceNodeId: string;
            sourceOutputName: string;
            targetInputName?: string;
            targetInputIndex?: number;
        }>;
        connectTo?: Array<{
            targetNodeId: string;
            sourceOutputName: string;
            targetInputName?: string;
            targetInputIndex?: number;
        }>;
    } = {}
): NonNullable<StructuredResponse['suggestedActions']>[number] {
    return {
        type: 'add_node',
        title,
        description: options.description,
        params: {
            workflow_name: workflowName,
            node_type: nodeType,
            node_name: nodeName,
            parameters: options.parameters,
            position: options.position,
            connect_from: options.connectFrom,
            connect_to: options.connectTo
        }
    };
}

/**
 * Convert legacy JSON string responses to structured responses
 */
export function migrateLegacyResponse(legacyResponse: any, correlationId?: string): McpToolResult {
    try {
        // Try to parse if it's a JSON string
        const parsed = typeof legacyResponse === 'string' ? JSON.parse(legacyResponse) : legacyResponse;

        if (parsed.success !== undefined) {
            // Already has success field, wrap it in structured format
            const response: StructuredResponse = {
                success: parsed.success,
                correlationId: correlationId || uuidv4(),
                timestamp: new Date().toISOString(),
                data: parsed.success ? (parsed.data || parsed) : undefined,
                errors: parsed.success ? undefined : [{
                    code: parsed.code || ErrorCodes.ERROR,
                    message: parsed.error || parsed.message || 'Unknown error',
                    retryable: parsed.retryable
                }]
            };

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(response, null, 2)
                }]
            };
        } else {
            // Legacy format without success field
            return createSuccessResponse(parsed, { correlationId });
        }
    } catch (error) {
        return createErrorResponse(
            'Failed to parse legacy response format',
            {
                code: ErrorCodes.INTERNAL_SERVER_ERROR,
                correlationId,
                retryable: false,
                remediation: 'Contact support if this error persists'
            }
        );
    }
}

/**
 * Add dry run support to response
 */
export function addDryRunInfo(
    response: StructuredResponse,
    plannedChanges: Array<{
        type: string;
        description: string;
        target: string;
    }>
): StructuredResponse {
    return {
        ...response,
        data: {
            ...response.data,
            dryRun: true,
            plannedChanges
        }
    };
}

/**
 * Helper to create usage tracking info
 */
export function createUsageInfo(options: {
    nodesCreated?: number;
    connectionsCreated?: number;
    connectionsSkipped?: number;
    cost?: number;
    quotaUsed?: number;
    quotaLimit?: number;
}): StructuredResponse['usage'] {
    return {
        nodesCreated: options.nodesCreated,
        connectionsCreated: options.connectionsCreated,
        connectionsSkipped: options.connectionsSkipped,
        cost: options.cost,
        quota: options.quotaUsed !== undefined && options.quotaLimit !== undefined ? {
            used: options.quotaUsed,
            limit: options.quotaLimit
        } : undefined
    };
}
