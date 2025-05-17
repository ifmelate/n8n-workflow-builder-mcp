#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Utility to simulate MCP client requests to test the server
function testMcpServer() {
    console.log('Starting MCP server test...');

    // Start the MCP server
    const mcpServer = spawn('node', [path.join(__dirname, 'n8n-workflow-mcp.js')], {
        stdio: ['pipe', 'pipe', process.stderr]
    });

    // Log when server process exits
    mcpServer.on('exit', (code) => {
        console.log(`MCP server process exited with code ${code}`);
    });

    // Simple delay function to wait between requests
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Send test requests to server
    async function sendTestRequests() {
        try {
            // Wait for server to start
            await delay(1000);

            // Initialize request
            const initRequest = {
                jsonrpc: "2.0",
                id: 1,
                method: "Initialize",
                params: {}
            };
            mcpServer.stdin.write(JSON.stringify(initRequest) + '\n');
            console.log('Sent Initialize request');

            // Wait for response before continuing
            await delay(500);

            // List offerings request
            const listRequest = {
                jsonrpc: "2.0",
                id: 2,
                method: "ListOfferings",
                params: {}
            };
            mcpServer.stdin.write(JSON.stringify(listRequest) + '\n');
            console.log('Sent ListOfferings request');

            // Wait for response
            await delay(500);

            // Execute tool request
            const executeRequest = {
                jsonrpc: "2.0",
                id: 3,
                method: "Execute",
                params: {
                    toolName: "list_workflows",
                    params: { filter: "Sample" }
                }
            };
            mcpServer.stdin.write(JSON.stringify(executeRequest) + '\n');
            console.log('Sent Execute request for list_workflows tool');

            // Wait for response
            await delay(1000);

            // Kill server after tests
            mcpServer.kill();
        } catch (error) {
            console.error('Error during test:', error);
            mcpServer.kill();
        }
    }

    // Read and display server responses
    mcpServer.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                try {
                    const response = JSON.parse(line);
                    console.log('Received response:', JSON.stringify(response, null, 2));
                } catch (error) {
                    console.log('Received non-JSON response:', line);
                }
            }
        });
    });

    // Start sending test requests
    sendTestRequests();
}

// Run the test
testMcpServer(); 