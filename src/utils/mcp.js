/**
 * MCP Utilities
 * 
 * Utilities for MCP protocol handling
 */

/**
 * Format tool definitions for MCP response
 * 
 * @param {Object} tools - Tool definitions object
 * @returns {Array} - Array of formatted tool definitions
 */
const formatToolDefinitions = (tools) => {
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
 * 
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code (default: 200)
 * @returns {Object} - Formatted response object
 */
const createSuccessResponse = (data, status = 200) => {
    return {
        status,
        data
    };
};

/**
 * Create a standardized error response
 * 
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @param {number} status - HTTP status code (default: 400)
 * @param {Object} details - Additional error details
 * @returns {Object} - Formatted error response
 */
const createErrorResponse = (message, code = 'ERROR', status = 400, details = {}) => {
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
 * 
 * @param {string} name - Tool name from request
 * @returns {string} - Standardized tool name
 */
const parseToolName = (name) => {
    if (!name) return null;

    // Handle different tool naming conventions
    // e.g., 'node.search', 'node-search', 'nodeSearch' -> 'node_search'

    // Replace dots and dashes with underscores
    let parsedName = name.replace(/[.-]/g, '_');

    // Convert camelCase to snake_case
    parsedName = parsedName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

    return parsedName;
};

module.exports = {
    formatToolDefinitions,
    createSuccessResponse,
    createErrorResponse,
    parseToolName
}; 