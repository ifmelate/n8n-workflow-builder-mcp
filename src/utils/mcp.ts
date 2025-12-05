/**
 * MCP Utilities
 * 
 * Utilities for MCP protocol handling
 */

export interface ToolDefinition {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
}

export interface FormattedToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    returns?: Record<string, unknown>;
}

export interface SuccessResponse {
    status: number;
    data: unknown;
}

export interface ErrorResponse {
    status: number;
    error: {
        message: string;
        code: string;
        details: Record<string, unknown>;
    };
}

/**
 * Format tool definitions for MCP response
 */
export const formatToolDefinitions = (tools: Record<string, ToolDefinition>): FormattedToolDefinition[] => {
    return Object.keys(tools).map(key => {
        const tool = tools[key];
        return {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
            returns: tool.output_schema
        };
    });
};

/**
 * Create a standardized success response
 */
export const createSuccessResponse = (data: unknown, status: number = 200): SuccessResponse => {
    return {
        status,
        data
    };
};

/**
 * Create a standardized error response
 */
export const createErrorResponse = (
    message: string,
    code: string = 'ERROR',
    status: number = 400,
    details: Record<string, unknown> = {}
): ErrorResponse => {
    return {
        status,
        error: {
            message,
            code,
            details
        }
    };
};

/**
 * Parse tool name from request to standardized format
 */
export const parseToolName = (name: string | null | undefined): string | null => {
    if (!name) return null;

    // Handle different tool naming conventions
    // e.g., 'node.search', 'node-search', 'nodeSearch' -> 'node_search'

    // Replace dots and dashes with underscores
    let parsedName = name.replace(/[.-]/g, '_');

    // Convert camelCase to snake_case
    parsedName = parsedName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

    return parsedName;
};
