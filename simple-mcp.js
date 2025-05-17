/**
 * Simple MCP Server for Cursor
 * This is a minimal implementation that should work with Cursor's MCP system
 */

// Simple tools we can offer
const tools = [
    {
        name: "hello_world",
        description: "Simple hello world tool for testing",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Name to greet"
                }
            },
            required: ["name"]
        }
    }
];

// Keep process alive
const keepAliveInterval = setInterval(() => { }, 60000);

// Handle SIGINT
process.on('SIGINT', () => {
    clearInterval(keepAliveInterval);
    process.exit(0);
});

// Basic JSON-RPC request handler
function handleRequest(request) {
    if (request.method === 'Initialize') {
        return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
                capabilities: {
                    experimental: {},
                    runtimeOptions: {
                        automaticResponseStreaming: false
                    }
                }
            }
        };
    } else if (request.method === 'ListOfferings') {
        return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
                offerings: {
                    tools: tools,
                    resources: [],
                    resourceTemplates: []
                }
            }
        };
    } else if (request.method === 'Execute') {
        const { toolName, params } = request.params;

        if (toolName === 'hello_world') {
            return {
                jsonrpc: "2.0",
                id: request.id,
                result: {
                    result: `Hello, ${params.name || 'world'}!`
                }
            };
        } else {
            return {
                jsonrpc: "2.0",
                id: request.id,
                error: {
                    code: -32601,
                    message: "Method not found",
                    data: { error: `Tool ${toolName} not found` }
                }
            };
        }
    } else {
        return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
                code: -32601,
                message: "Method not found",
                data: { error: `Method ${request.method} not supported` }
            }
        };
    }
}

// Process input stream
let buffer = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
    process.stderr.write(`Received chunk: ${chunk}\n`);
    buffer += chunk;

    // Find newline character
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex !== -1) {
        // Extract the line
        const line = buffer.substring(0, newlineIndex);
        buffer = buffer.substring(newlineIndex + 1);

        // Process the line if it's not empty
        if (line.trim() !== '') {
            try {
                const request = JSON.parse(line);
                process.stderr.write(`Parsed request: ${JSON.stringify(request)}\n`);
                const response = handleRequest(request);

                // Write response
                process.stderr.write(`Sending response: ${JSON.stringify(response)}\n`);
                process.stdout.write(JSON.stringify(response) + '\n');
            } catch (error) {
                // If parsing fails, send error
                process.stderr.write(`Parse error: ${error.message}\n`);
                const errorResponse = {
                    jsonrpc: "2.0",
                    id: null,
                    error: {
                        code: -32700,
                        message: "Parse error",
                        data: { error: error.message }
                    }
                };
                process.stdout.write(JSON.stringify(errorResponse) + '\n');
            }
        }
    }
});

// Handle end of input
process.stdin.on('end', () => {
    // Keep process alive even after stdin ends
});

// Handle errors
process.stdin.on('error', (error) => {
    process.stderr.write(`stdin error: ${error.message}\n`);
});

process.stdout.on('error', (error) => {
    process.stderr.write(`stdout error: ${error.message}\n`);
});

// Prevent uncaught exceptions from crashing the process
process.on('uncaughtException', (error) => {
    process.stderr.write(`Uncaught exception: ${error.message}\n${error.stack}\n`);
});

// Prevent unhandled promise rejections from crashing the process
process.on('unhandledRejection', (reason) => {
    process.stderr.write(`Unhandled promise rejection: ${reason}\n`);
});

// Now that we're ready to process requests, log to stderr
process.stderr.write('MCP server is ready\n'); 