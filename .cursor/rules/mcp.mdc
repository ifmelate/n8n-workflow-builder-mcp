---
description:
globs:
alwaysApply: false
---
# MCP Server Implementation Best Practices

These guidelines ensure our MCP server follows the latest Model Context Protocol (2025) standards, providing a consistent API experience for AI model interactions.

## Core Architecture

- **Follow JSON-RPC 2.0 Message Format**
  - All server responses must include `jsonrpc: "2.0"`, `id`, and either `result` or `error`
  - Error objects must contain `code` and `message` properties
  - Include proper request IDs in all responses

  ```javascript
  // ✅ DO: Format responses following JSON-RPC 2.0
  const createJsonRpcResponse = (id, result) => ({
    jsonrpc: "2.0",
    id,
    result
  });

  const createJsonRpcError = (id, code, message) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message }
  });
  
  // ❌ DON'T: Return arbitrary JSON structures
  res.json({ success: true, data: result });
  ```

- **Implement Proper Transport Layers**
  - Support standard MCP transports (Stdio, HTTP, WebSockets)
  - Transport selection should be configurable
  - Handle connection lifecycle events properly

  ```javascript
  // ✅ DO: Use standardized transport implementations
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const transport = new StdioServerTransport();
  server.connect(transport);
  
  // ❌ DON'T: Create custom message formats
  process.stdin.on('data', (data) => {
    // Custom parsing logic...
  });
  ```

- **Implement Capability Negotiation**
  - Explicitly declare supported capabilities (tools, resources, prompts, sampling)
  - Follow the MCP specification version declaration
  - Respond to capability request messages

  ```javascript
  // ✅ DO: Properly declare server capabilities
  app.post('/mcp/capabilities', (req, res) => {
    res.status(200).json({
      jsonrpc: "2.0",
      id: req.body.id,
      result: {
        capabilities: {
          tools: true,
          resources: true,
          prompts: false,
          sampling: false
        },
        version: "2025-03-26"
      }
    });
  });
  ```

## Tool Definitions

- **Standardize Tool Schemas**
  - Each tool must have `name`, `description`, and `parameters`
  - Parameter validation must follow JSON Schema (via Zod, Ajv, etc.)
  - Include required vs. optional parameter designation
  - Document expected inputs and outputs

  ```javascript
  // ✅ DO: Use well-structured tool definitions
  const createTool = (description, parameters, execute) => ({
    description,
    parameters: {
      type: 'object',
      properties: parameters,
      required: Object.keys(parameters).filter(key => !parameters[key].optional)
    },
    execute,
    required_on_execute: true,
    categories: ['workflow'],
    parallelizable: false
  });
  
  // ❌ DON'T: Use loosely typed parameters
  const simpleTool = {
    run: (params) => {
      // No validation before execution
    }
  };
  ```

- **Implement Comprehensive Parameter Validation**
  - Validate all parameters before tool execution
  - Provide descriptive error messages for invalid parameters
  - Include type checking, bounds checking, and format validation
  - Support nested objects and array validation

  ```javascript
  // ✅ DO: Validate parameters with detailed errors
  const validate = ajv.compile(schema);
  const valid = validate(params);
  
  if (!valid) {
    const errors = validate.errors.map(err =>
      `${err.instancePath} ${err.message}`
    ).join('; ');
    
    throw new Error(`Invalid parameters: ${errors}`);
  }
  
  // ❌ DON'T: Use loose validation or manual checks
  if (!params.name) {
    throw new Error('Name is required');
  }
  ```

## Security

- **Implement Robust Authentication & Authorization**
  - Authenticate all MCP requests
  - Apply authorization rules for tool execution
  - Log authentication failures
  - Use refresh tokens and proper session management

  ```javascript
  // ✅ DO: Implement proper auth with tool-specific authorization
  const enhancedAuth = (req, res, next) => {
    // Validate authentication
    authenticate(req, res, (err) => {
      if (err) return next(err);
      
      // Add authorization check
      const { toolInfo } = req;
      if (toolInfo && !authorizeToolAccess(req.user, toolInfo)) {
        return res.status(403).json({
          error: {
            message: 'Not authorized to use this tool',
            code: 'UNAUTHORIZED_TOOL_ACCESS'
          }
        });
      }
      next();
    });
  };
  
  // ❌ DON'T: Use simple global authentication without tool-specific authorization
  app.use(basicAuthMiddleware);
  ```

- **Secure Configuration Management**
  - Store secrets in environment variables or secure storage
  - Support multiple environments (dev, staging, prod)
  - Never hardcode credentials
  - Use separate configuration files for non-sensitive settings

  ```javascript
  // ✅ DO: Use environment variables for secrets
  require('dotenv').config();
  const apiKey = process.env.API_KEY;
  
  // ❌ DON'T: Hardcode credentials
  const apiKey = 'sk_live_abcdef123456';
  ```

## Error Handling

- **Implement Consistent Error Responses**
  - Use standardized error codes
  - Provide human-readable error messages
  - Include debugging information in development
  - Mask sensitive data in error responses

  ```javascript
  // ✅ DO: Return structured error responses
  const createErrorResponse = (message, code, status = 500) => {
    logger.error(`MCP Error: ${code} - ${message}`);
    
    return {
      error: {
        message,
        code
      },
      status
    };
  };
  
  // ❌ DON'T: Return inconsistent error formats
  res.status(500).json({ message: "Something went wrong" });
  ```

- **Log Errors with Context**
  - Include request context in error logs
  - Log stack traces in development
  - Use structured logging formats (JSON)
  - Implement different log levels (debug, info, error)

  ```javascript
  // ✅ DO: Log detailed error context
  logger.error({
    message: `Tool execution error: ${error.message}`,
    toolName: req.toolInfo.name,
    parameters: maskSensitiveData(req.toolInfo.parameters),
    errorCode: error.code,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
  
  // ❌ DON'T: Log minimal information
  console.error("Error:", error.message);
  ```

## Performance & Scalability

- **Implement Rate Limiting**
  - Limit requests per client/API key
  - Apply graduated rate limits based on client tier
  - Return standard 429 responses when limits exceeded
  - Include rate limit information in response headers

  ```javascript
  // ✅ DO: Implement proper rate limiting
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    handler: (req, res) => {
      const error = createErrorResponse(
        'Too many requests, please try again later.',
        'RATE_LIMIT_EXCEEDED',
        429
      );
      res.status(error.status).json({ error: error.error });
    }
  }));
  ```

- **Optimize Tool Execution**
  - Implement caching for frequently used tool results
  - Use connection pooling for external API calls
  - Apply timeouts for long-running operations
  - Consider async execution for non-blocking operations

  ```javascript
  // ✅ DO: Implement caching for expensive operations
  const cache = new NodeCache({ stdTTL: 300 }); // 5 minute default TTL
  
  const getCachedOrFetch = async (key, fetchFn) => {
    const cached = cache.get(key);
    if (cached) return cached;
    
    const result = await fetchFn();
    cache.set(key, result);
    return result;
  };
  ```

## Testing & Reliability

- **Create Comprehensive Test Suites**
  - Test all tool endpoints
  - Include positive and negative test cases
  - Test parameter validation logic
  - Mock external dependencies

  ```javascript
  // ✅ DO: Test success and error cases
  it('should return 400 if tool name is missing', async () => {
    const response = await request(app)
      .post('/mcp/execute')
      .send({ parameters: {} });
    
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('code', 'MISSING_TOOL_NAME');
  });
  
  it('should process valid tool execution request', async () => {
    const response = await request(app)
      .post('/mcp/execute')
      .send({ 
        name: 'workflow_list', 
        parameters: { limit: 10 } 
      });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('tool', 'workflow_list');
  });
  ```

- **Implement Health Checks**
  - Create a health endpoint that verifies all dependencies
  - Include version information in health response
  - Check external service connectivity
  - Implement readiness and liveness probes

  ```javascript
  // ✅ DO: Implement detailed health checks
  app.get('/health', async (req, res) => {
    try {
      // Check database connection
      await db.ping();
      
      // Check external API connectivity
      await externalApi.status();
      
      res.status(200).json({ 
        status: 'ok', 
        version: '0.1.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(503).json({ 
        status: 'error', 
        message: 'Service unavailable',
        details: error.message
      });
    }
  });
  ```

## Resources & Context

- **Implement Resource Endpoints**
  - Expose useful context via resource endpoints
  - Structure resources hierarchically
  - Support resource retrieval by ID
  - Include metadata with resources

  ```javascript
  // ✅ DO: Implement proper resource endpoints
  app.post('/mcp/resources/list', authenticate, (req, res) => {
    const resources = [
      { id: 'workflow-templates', name: 'Workflow Templates', type: 'collection' },
      { id: 'node-types', name: 'Node Types', type: 'collection' },
      { id: 'integration-docs', name: 'Integration Documentation', type: 'document' }
    ];
    
    const response = createJsonRpcResponse(req.body.id, { resources });
    res.status(200).json(response);
  });
  ```

- **Support Context Awareness**
  - Allow tools to access contextual information
  - Share context between related tool calls
  - Maintain session state when appropriate
  - Document context dependencies

  ```javascript
  // ✅ DO: Implement context-aware tools
  const executeWorkflow = async (params, context) => {
    // Access the current user context
    const userId = context.user.id;
    
    // Access previously established session information
    const sessionData = context.session.get('workflowData') || {};
    
    // Store results for future tool calls
    context.session.set('lastExecutionId', executionId);
    
    return result;
  };
  ```

## Documentation

- **Generate API Documentation**
  - Create OpenAPI/Swagger documentation
  - Document all tools and their parameters
  - Include example requests and responses
  - Provide error code references

  ```javascript
  // ✅ DO: Use OpenAPI annotations for documentation
  /**
   * @openapi
   * /mcp/execute:
   *   post:
   *     summary: Execute an MCP tool
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *             properties:
   *               name:
   *                 type: string
   *                 description: Tool name in format "category_action"
   *               parameters:
   *                 type: object
   *                 description: Tool-specific parameters
   */
  ```

- **Provide Clear Tool Documentation**
  - Document each tool's purpose and behavior
  - Explain parameter requirements clearly
  - Provide usage examples
  - Document potential errors and resolutions

  ```javascript
  // ✅ DO: Document tools thoroughly
  /**
   * Create a new n8n workflow
   * 
   * @param {Object} parameters - Tool parameters
   * @param {string} parameters.name - Name of the workflow
   * @param {boolean} [parameters.active=false] - Whether the workflow should be active
   * @returns {Promise<Object>} Created workflow details
   * @throws {Error} If workflow creation fails
   */
  ```
