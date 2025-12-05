/**
 * Typed MCP response helpers for consistent tool response formatting
 */

export interface McpTextContent {
    [x: string]: unknown;
    type: "text";
    text: string;
}

export interface McpResponse {
    [x: string]: unknown;
    content: McpTextContent[];
    _meta?: { [x: string]: unknown };
    isError?: boolean;
}

/**
 * Wraps any payload in a standardized text content response
 */
export function toTextContent(payload: unknown): McpResponse {
    return {
        content: [{
            type: "text" as const,
            text: JSON.stringify(payload)
        }]
    };
}

/**
 * Creates a success response with data
 */
export function ok(data: unknown): McpResponse {
    return toTextContent({
        success: true,
        ...((typeof data === 'object' && data !== null) ? data : { data })
    });
}

/**
 * Creates a failure response with error message and optional details
 */
export function fail(message: string, details?: unknown): McpResponse {
    const errorPayload: any = {
        success: false,
        error: message
    };

    if (details !== undefined) {
        errorPayload.details = details;
    }

    return toTextContent(errorPayload);
}

/**
 * Creates a workflow not found error response
 */
export function workflowNotFound(workflowName: string, filePath: string): McpResponse {
    return fail(`Workflow with name ${workflowName} not found at ${filePath}`);
}

/**
 * Creates a node not found error response
 */
export function nodeNotFound(nodeId: string, workflowName: string): McpResponse {
    return fail(`Node with ID ${nodeId} not found in workflow ${workflowName}`);
}

/**
 * Creates a validation error response
 */
export function validationError(message: string, validation?: unknown): McpResponse {
    return fail(message, validation ? { validation } : undefined);
}
