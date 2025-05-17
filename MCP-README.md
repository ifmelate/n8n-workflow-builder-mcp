# N8N Workflow Builder MCP Server

This MCP (Model Context Protocol) server integrates with Cursor IDE to provide tools for building and managing n8n workflows.

## Prerequisites

- Node.js (v14 or newer)
- Cursor IDE (v0.48 or newer)
- npm or yarn

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/n8n-workflow-builder-mcp.git
   cd n8n-workflow-builder-mcp
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Make the MCP server script executable:
   ```
   chmod +x n8n-workflow-mcp.js
   ```

## Setup for Cursor Integration

There are two ways to set up the MCP server with Cursor. Try Method 1 first, and if that doesn't work, try Method 2.

### Method 1: Using direct script path

1. Ensure the `.cursor` directory exists:
   ```
   mkdir -p .cursor
   ```

2. Create the MCP configuration file:
   ```
   cat > .cursor/mcp.json << 'EOF'
   {
     "mcpServers": {
       "n8n-workflow-builder": {
         "command": "node",
         "args": ["/Users/work/development/n8n-workflow-builder-mcp/n8n-workflow-mcp.js"]
       }
     }
   }
   EOF


## Manual Testing

You can test the MCP server outside of Cursor using the provided test script:

```
node test-mcp.js
```

This will start the MCP server and send some test requests to verify it's working correctly.

## Troubleshooting Cursor Integration

If you're having trouble getting the MCP server to work with Cursor, try these steps:

1. **Restart Cursor**: After setting up the MCP configuration, completely close and restart Cursor.

2. **Check Cursor MCP settings**:
   - Open Cursor Settings
   - Go to Features > MCP Servers
   - Make sure your server is listed and enabled
   - If it's listed but not working, try clicking the refresh button

3. **Check server logs**: Look for errors in the terminal where you're running the server or in the Cursor Output panel. Select "Cursor MCP" from the dropdown in the Output panel to see MCP-specific logs.

4. **Try different configuration**: If Method 1 doesn't work, try Method 2 as described above.

5. **Verify file permissions**: Make sure the `n8n-workflow-mcp.js` file has execution permissions.

6. **Check for port conflicts**: If there are other MCP servers running, they might conflict. Check for other processes using the same ports.

7. **Check Cursor version**: Make sure you're using Cursor v0.48 or newer, as earlier versions might have different MCP integration methods.

8. **Try global installation**: Instead of using a local path, you can try installing the server globally:
   ```
   npm install -g n8n-workflow-builder-mcp
   ```
   Then update the `.cursor/mcp.json` file to use the global command.

## Common Issues and Solutions

### "Failed to create client"

This usually happens when:
- The MCP server isn't running
- There's a connectivity issue between Cursor and the server
- The server crashed during initialization

Try:
1. Running the test script to make sure the server works correctly
2. Checking for errors in the server logs
3. Restarting Cursor

### MCP Server is not showing up in Cursor

This can happen if:
- The `.cursor/mcp.json` file is not properly formatted
- Cursor hasn't detected the configuration change

Try:
1. Validating the JSON format of your `.cursor/mcp.json` file
2. Restarting Cursor
3. Manually selecting the server in Cursor settings (if it appears there)

### MCP Server shows up but tools aren't available

This can happen if:
- The server isn't properly registering its tools
- There's an issue with the ListOfferings request/response

Try:
1. Running the test script to check if tools are properly registered
2. Clicking the refresh button in the MCP server settings in Cursor
3. Checking the server logs for any errors

## Available Tools

The MCP server provides the following tools:

- **list_workflows**: List all available workflows
- **get_workflow_details**: Get detailed information about a specific workflow
- **create_workflow**: Create a new workflow
- **add_node**: Add a node to a workflow

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 