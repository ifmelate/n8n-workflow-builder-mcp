// Centralized constants for MCP server configuration and protocol

// Import package version safely for Jest compatibility
let packageVersion = '0.0.0';
try {
    const pkg = require('../../package.json');
    packageVersion = pkg?.version || '0.0.0';
} catch {
    // Fallback if package.json can't be loaded (e.g., in tests)
    packageVersion = '0.0.0';
}

export const MCP_SERVER_NAME = 'n8n-workflow-builder';
export const MCP_SERVER_VERSION: string = packageVersion;

export const MCP_PROTOCOL_VERSION = '1.0';
export const HEADER_MCP_VERSION = 'X-MCP-Version';

// Keep a single fallback for n8n versioning logic if ever needed by callers
export const DEFAULT_N8N_VERSION_FALLBACK = '1.104.1';

// Optional: canonical tool names to avoid typos
export const ToolNames = {
    create_workflow: 'create_workflow',
    list_workflows: 'list_workflows',
    get_workflow_details: 'get_workflow_details',
    add_node: 'add_node',
    edit_node: 'edit_node',
    delete_node: 'delete_node',
    add_connection: 'add_connection',
    add_ai_connections: 'add_ai_connections',
    compose_ai_workflow: 'compose_ai_workflow',
    list_available_nodes: 'list_available_nodes',
    get_n8n_version_info: 'get_n8n_version_info',
    validate_workflow: 'validate_workflow',
    connect_main_chain: 'connect_main_chain',
    fix_rag_warnings: 'fix_rag_warnings',
    list_template_examples: 'list_template_examples'
} as const;

export type ToolName = typeof ToolNames[keyof typeof ToolNames];

// Security event types for consistent logging
export const SecurityEventTypes = {
    authentication_failure: 'authentication_failure',
    rate_limit_exceeded: 'rate_limit_exceeded',
    validation_failure: 'validation_failure',
    mcp_request: 'mcp_request',
    workflow_create: 'workflow_create'
} as const;

export type SecurityEventType = typeof SecurityEventTypes[keyof typeof SecurityEventTypes];

// Error codes for consistent error responses
export const ErrorCodes = {
    // Authentication errors
    AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
    MISSING_API_KEY: 'MISSING_API_KEY',
    INVALID_API_KEY: 'INVALID_API_KEY',
    MISSING_JWT_TOKEN: 'MISSING_JWT_TOKEN',
    RATE_LIMITED: 'RATE_LIMITED',

    // Authorization errors
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    MISSING_ROLES: 'MISSING_ROLES',
    UNSUPPORTED_AUTH_TYPE: 'UNSUPPORTED_AUTH_TYPE',

    // Validation errors
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
    INVALID_TOOL_PARAMETERS: 'INVALID_TOOL_PARAMETERS',
    MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
    FIELD_TOO_LONG: 'FIELD_TOO_LONG',

    // Tool execution errors
    TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
    TOOL_EXECUTION_ERROR: 'TOOL_EXECUTION_ERROR',
    TOOL_DEFINITION_ERROR: 'TOOL_DEFINITION_ERROR',

    // Server errors
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    ERROR: 'ERROR'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// Nodes source configuration
// Nodes are now always sourced from the local SQLite catalog (materialized to FS at runtime)


