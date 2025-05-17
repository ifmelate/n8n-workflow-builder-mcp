/**
 * Tool Definition Routes
 * 
 * Implements the MCP tool definition endpoint that returns proper JSON Schema for all tools.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { logMcpRequest } = require('../middleware/logging');
const { createSuccessResponse, createErrorResponse } = require('../utils/mcp');
const { getAllToolDefinitions } = require('../tools/toolDefinitions');
const { logger } = require('../utils/logger');

/**
 * GET /tools
 * 
 * Returns standardized MCP tool definitions for all available tools
 * Compliant with latest MCP protocol specification
 */
router.post('/tools', authenticate, logMcpRequest, (req, res) => {
    try {
        // Get all tool definitions
        const definitions = getAllToolDefinitions();

        // Format the definitions for MCP response
        const toolDefinitions = Object.keys(definitions).map(key => {
            const tool = definitions[key];
            return {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
                returns: tool.output_schema
            };
        });

        // Create success response
        const response = createSuccessResponse({ tools: toolDefinitions });

        // Log success
        logger.debug(`Serving ${toolDefinitions.length} tool definitions through MCP endpoint`);

        // Return the response
        res.status(response.status).json(response.data);
    } catch (error) {
        // Log error
        logger.error(`Error generating tool definitions: ${error.message}`);
        logger.debug(error.stack);

        // Create error response
        const errorResponse = createErrorResponse(
            'Failed to generate tool definitions',
            'TOOL_DEFINITION_ERROR',
            500
        );

        // Return error response
        res.status(errorResponse.status).json({ error: errorResponse.error });
    }
});

module.exports = router; 