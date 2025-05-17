# n8n Workflow Builder MCP

This project provides a Model Context Protocol (MCP) server for building and manipulating n8n workflows JSON in Cursor IDE. It's a way to build n8n workflows just by prompting with AI in chat.

## Current status of implementation

It's in early development stage. Basically, it's working, but sometimes llm agents put wrong parameters in the request. I plan to find a way to fix this.
Also, initial prompt does matter. If it's not clear, the agent will go wrong way.

## Key Features

- **Workflow Management**: Create, update, and execute n8n workflows programmatically (execute is not implemented yet)
- **Node Discovery**: Explore available n8n nodes and their capabilities 
- **Connection Management**: Create connections between workflow nodes
- **AI Integration**: Special tools for connecting AI components in workflows
- **AI-Friendly Interface**: Designed specifically for interaction with AI agents


## Prerequisites

- Node.js (v14 or higher)
- Cursor IDE (v0.48 or newer)
- npm or yarn
- TypeScript compiler (installed as a dev dependency via `npm install`)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ifmelate/n8n-workflow-builder-mcp.git
   cd n8n-workflow-builder-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the TypeScript project:
   ```bash
   npm run build
   ```

4. Make the MCP server script executable (if needed):
   ```bash
   chmod +x dist/index.js
   ```

## Running the Server

Start the MCP server:
```bash
npm start
```
This will run the compiled code from `dist/index.js`.

For development with auto-rebuild and restart on changes:
```bash
npm run dev
```

## Cursor IDE Integration

There are two ways to set up the MCP server with Cursor:

### Method 1: Using Cursor Settings UI (Recommended)

1. Start Cursor IDE
2. Go to Settings > Features > MCP Servers
3. Click "Add Server" and provide the **absolute path** to the `dist/index.js` file
   (e.g., `/Users/yourname/n8n-workflow-builder-mcp/dist/index.js`)
4. Make sure the server is enabled
5. Restart Cursor IDE for changes to take effect

### Method 2: Manual Configuration

1. Ensure the `.cursor` directory exists:
   ```bash
   mkdir -p .cursor
   ```

2. Create the MCP configuration file:
   ```bash
   cat > .cursor/mcp.json << 'EOF'
   {
     "mcpServers": {
       "n8n-workflow-builder": {
         "command": "node",
         "args": ["/absolute/path/to/n8n-workflow-builder-mcp/dist/index.js"]
       }
     }
   }
   EOF
   ```
   Make sure to replace `/absolute/path/to` with the actual path on your system.

3. Restart Cursor IDE for changes to take effect

## Manual Testing

You can test the MCP server outside of Cursor using the provided test script:

```bash
node test-mcp.js
```

This will start the MCP server and send test requests to verify it's working correctly.

## Available MCP Tools

The server provides the following tools for working with n8n workflows:

| Tool Name | Description | Key Parameters |
|-----------|-------------|----------------|
| **create_workflow** | Create a new n8n workflow | `workflow_name`, `workspace_dir` |
| **list_workflows** | List all existing workflows | (no parameters) |
| **get_workflow_details** | Get detailed information about a specific workflow | `workflow_name` |
| **add_node** | Add a new node to a workflow | `workflow_name`, `node_type`, `position`, `parameters`, `node_name`, `typeVersion` |
| **edit_node** | Edit an existing node in a workflow | `workflow_name`, `node_id`, `node_type`, `node_name`, `position`, `parameters` |
| **delete_node** | Delete a node from a workflow | `workflow_name`, `node_id` |
| **add_connection** | Add a connection between nodes | `workflow_name`, `source_node_id`, `source_node_output_name`, `target_node_id`, `target_node_input_name` |
| **add_ai_connections** | Add AI connections for LangChain nodes | `workflow_name`, `agent_node_id`, `model_node_id`, `tool_node_ids` |
| **list_available_nodes** | List available node types with optional filtering | `search_term` (optional) |

## Project Structure

- `/src`: Main source code
- `/src/tools`: MCP tools implementation
- `/src/models`: Data models
- `/src/utils`: Utility functions
- `/src/middleware`: Authentication and middleware
- `/config`: Configuration files
- `/tests`: Test files
- `/workflow_nodes`: n8n node definitions
- `/docs`: Additional documentation

## Troubleshooting Cursor Integration

If you're having trouble getting the MCP server to work with Cursor, try these steps:

1. **Restart Cursor**: After setting up the MCP configuration, completely close and restart Cursor.

2. **Check Cursor MCP settings**:
   - Open Cursor Settings
   - Go to Features > MCP Servers
   - Make sure your server is listed and enabled
   - If it's listed but not working, try clicking the refresh button

3. **Check server logs**: Look for errors in the terminal where you're running the server or in the Cursor Output panel. Select "Cursor MCP" from the dropdown in the Output panel to see MCP-specific logs.

4. **Verify file permissions**: Make sure the `dist/index.js` file has execution permissions.

5. **Check for port conflicts**: If there are other MCP servers running, they might conflict. Check for other processes using the same ports.

6. **Check Cursor version**: Make sure you're using Cursor v0.48 or newer, as earlier versions might have different MCP integration methods.

7. **Try global installation**: Instead of using a local path, you can try installing the server globally:
   ```bash
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

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
