/**
 * Tool Execution Routes
 * 
 * Implements the MCP tool execution endpoint that receives requests to execute tools.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { logMcpRequest } = require('../middleware/logging');
const { validateToolRequest } = require('../middleware/mcp');
const { createSuccessResponse, createErrorResponse, parseToolName } = require('../utils/mcp');
const { toolDefinitions } = require('../tools/toolDefinitions');
const { logger } = require('../utils/logger');

/**
 * POST /execute
 * 
 * Executes an MCP tool
 */
router.post('/execute', authenticate, logMcpRequest, validateToolRequest, async (req, res) => {
    try {
        const { name, parameters } = req.body;

        // Get tool definition
        const tool = toolDefinitions[name];

        if (!tool) {
            const errorResponse = createErrorResponse(
                `Tool "${name}" not found`,
                'TOOL_NOT_FOUND',
                404
            );
            return res.status(errorResponse.status).json({ error: errorResponse.error });
        }

        // Log tool execution attempt
        logger.info(`Executing tool: ${name}`, {
            tool: name,
            hasParameters: Object.keys(parameters || {}).length > 0
        });

        // Execute the tool
        let result;
        try {
            result = await tool.execute(parameters || {});
        } catch (toolError) {
            // Handle execution errors from the tool
            logger.error(`Tool execution error: ${toolError.message}`);

            const errorResponse = createErrorResponse(
                toolError.message || 'Tool execution failed',
                'TOOL_EXECUTION_ERROR',
                500
            );
            return res.status(errorResponse.status).json({ error: errorResponse.error });
        }

        // Log successful execution
        logger.info(`Tool executed successfully: ${name}`);

        // Return successful result
        const response = createSuccessResponse(result);
        res.status(response.status).json(response.data);
    } catch (error) {
        // Handle unexpected errors
        logger.error(`Unexpected error during tool execution: ${error.message}`);
        logger.error(error.stack);

        const errorResponse = createErrorResponse(
            'An unexpected error occurred',
            'INTERNAL_SERVER_ERROR',
            500
        );
        res.status(errorResponse.status).json({ error: errorResponse.error });
    }
});

module.exports = router; 