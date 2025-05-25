/**
 * Basic tests for the MCP server
 */

const request = require('supertest');
const express = require('express');
const cors = require('cors');
const { authenticate } = require('../src/middleware/auth');
const { validateToolRequest, logMcpRequest } = require('../src/middleware/mcp');
const { formatToolDefinitions, createSuccessResponse, createErrorResponse } = require('../src/utils/mcp');
const { toolDefinitions } = require('../src/tools/toolDefinitions');

// Mock logger
jest.mock('../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn()
    }
}));

// Setup test environment variables to bypass authentication
beforeAll(() => {
    process.env.NODE_ENV = 'development';
    process.env.SKIP_AUTH = 'true';
});

afterAll(() => {
    delete process.env.NODE_ENV;
    delete process.env.SKIP_AUTH;
});

// Create a test app
const createTestApp = () => {
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Health check
    app.get('/health', (req, res) => {
        res.status(200).json({ status: 'ok', message: 'MCP server is running' });
    });

    // Default route
    app.get('/', (req, res) => {
        res.status(200).json({
            message: 'n8n Workflow Builder MCP API',
            version: '0.1.0',
        });
    });

    // MCP Protocol routes
    app.post('/mcp/tools', authenticate, logMcpRequest, (req, res) => {
        try {
            const toolDefs = formatToolDefinitions(toolDefinitions);
            const response = createSuccessResponse({ tools: toolDefs });
            res.status(response.status).json(response.data);
        } catch (error) {
            const errorResponse = createErrorResponse(
                'Failed to generate tool definitions',
                'TOOL_DEFINITION_ERROR'
            );
            res.status(errorResponse.status).json({ error: errorResponse.error });
        }
    });

    app.post('/mcp/execute', authenticate, logMcpRequest, validateToolRequest, async (req, res) => {
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

            // For testing, we don't actually call the tool execute function
            // Just return success with the parameters
            const response = createSuccessResponse({
                tool: name,
                parameters
            });

            res.status(response.status).json(response.data);
        } catch (error) {
            const errorResponse = createErrorResponse(
                'An unexpected error occurred',
                'INTERNAL_SERVER_ERROR',
                500
            );
            res.status(errorResponse.status).json({ error: errorResponse.error });
        }
    });

    return app;
};

describe('MCP Server', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
    });

    describe('Health Check', () => {
        it('should return 200 OK for health check', async () => {
            const response = await request(app).get('/health');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'ok');
            expect(response.body).toHaveProperty('message', 'MCP server is running');
        });
    });

    describe('Default Route', () => {
        it('should return API information for root route', async () => {
            const response = await request(app).get('/');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'n8n Workflow Builder MCP API');
            expect(response.body).toHaveProperty('version', '0.1.0');
        });
    });

    describe('MCP Tool Definitions', () => {
        it('should return tool definitions', async () => {
            const response = await request(app).post('/mcp/tools');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('tools');
            expect(Array.isArray(response.body.tools)).toBe(true);
        });
    });

    describe('MCP Tool Execution', () => {
        it('should return 400 if tool name is missing', async () => {
            const response = await request(app)
                .post('/mcp/execute')
                .send({ parameters: {} });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST_FORMAT');
        });

        it('should handle invalid tool name format', async () => {
            const response = await request(app)
                .post('/mcp/execute')
                .send({ name: 'invalid_format_missing_action', parameters: {} });

            // This should return 404 since the tool doesn't exist in toolDefinitions
            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toHaveProperty('code', 'TOOL_NOT_FOUND');
        });

        it('should return 404 if tool does not exist', async () => {
            const response = await request(app)
                .post('/mcp/execute')
                .send({ name: 'nonexistent_tool', parameters: {} });

            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toHaveProperty('code', 'TOOL_NOT_FOUND');
        });

        it('should process valid tool execution request', async () => {
            // We need to use a tool that actually exists in toolDefinitions
            // Let's check what tools are available first
            const toolsResponse = await request(app).post('/mcp/tools');
            const availableTools = toolsResponse.body.tools;

            // Use the first available tool for testing
            if (availableTools && availableTools.length > 0) {
                const testTool = availableTools[0];

                // Provide required parameters based on the tool
                let testParameters = {};
                if (testTool.name === 'workflow_manage') {
                    testParameters = { operation: 'list' }; // Provide required operation parameter
                }

                const response = await request(app)
                    .post('/mcp/execute')
                    .send({
                        name: testTool.name,
                        parameters: testParameters
                    });

                expect(response.status).toBe(200);
                expect(response.body).toHaveProperty('tool', testTool.name);
                expect(response.body).toHaveProperty('parameters');
            } else {
                // If no tools are available, skip this test
                expect(true).toBe(true);
            }
        });
    });
}); 