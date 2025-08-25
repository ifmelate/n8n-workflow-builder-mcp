# n8n Workflow Builder MCP

This project provides a Model Context Protocol (MCP) server for building and manipulating n8n workflows JSON in Cursor IDE. It's a way to build n8n workflows just by prompting with AI in chat.

<a href="https://glama.ai/mcp/servers/@ifmelate/n8n-workflow-builder-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@ifmelate/n8n-workflow-builder-mcp/badge" alt="n8n-workflow-builder-mcp MCP server" />
</a>

# DEMO VIDEO:
[![Watch the video](https://github.com/user-attachments/assets/53706f62-7e99-449f-8537-0ce951c727e1)](https://youtu.be/MKEVLM5QmPA?si=8SJQAcYGeAIuhaBm)

## Current status of implementation

It's in early development stage. Basically, it's working - MCP server creates JSON file with n8n workflow that you can copy and paste to workflow editor in n8n UI.
Current problems:
- sometimes llm agents put wrong parameters in the request. **I plan to find a way to fix this**.
- sometimes connection between nodes is not setting. **I'm working to resolve it**.
- not all types of node are checked working. **I'm working to resolve it**.
- initial prompt does matter. If it's not clear, the agent will go wrong way. **I plan to find a way to fix this**.

## Key Features

- **Workflow Management**: Create, update, and execute n8n workflows programmatically (execute is not implemented yet)
- **Node Discovery**: Explore available n8n nodes and their capabilities 
- **Connection Management**: Create connections between workflow nodes
- **AI Integration**: Special tools for connecting AI components in workflows
- **AI-Friendly Interface**: Designed specifically for interaction with AI agents
- **N8N Version Management**: Automatic version detection and compatibility handling - supports 123+ N8N versions with dynamic node filtering and "closest lower version" matching for backward compatibility

## Prerequisites

- Node.js (v14 or higher)
- Cursor IDE (v0.48 or newer)
- npm (for npx command)

## Installation & Setup

### Recommended: Using npx in mcp.json (Easiest)

The recommended way to install this MCP server is using npx directly in your `.cursor/mcp.json` file:

```json
{
  "mcpServers": {
    "n8n-workflow-builder": {
      "command": "npx",
      "args": [
        "-y",
        "n8n-workflow-builder-mcp"
      ],
      "env": {
        "N8N_API_URL": "http://localhost:5678",
        "N8N_API_KEY": "your-n8n-api-key-here",
       // "N8N_VERSION": "1.72.1" // optional, if not set, the server will try to detect the version automatically
      }
    }
  }
}
```

This approach:
- ✅ Automatically installs the latest version
- ✅ Does not require global installation  
- ✅ Works reliably across different environments
- ✅ No manual building or path configuration needed

**Setup Steps:**
1. Create the `.cursor` directory in your project root (if it doesn't exist):
   ```bash
   mkdir -p .cursor
   ```

3. Create or update `.cursor/mcp.json` with the configuration above, replacing:
   - `N8N_API_URL`: Your n8n instance URL (default: `http://localhost:5678`)
   - `N8N_API_KEY`: Your n8n API key from the n8n settings
   - `N8N_VERSION`: (Optional) Override N8N version - if not set, auto-detects from API

4. Restart Cursor IDE for changes to take effect


### Getting your n8n API Key:
1. Open your n8n instance in a browser
2. Go to Settings > API Keys
3. Click "Create API Key"
4. Copy the generated key and use it in your configuration

### Alternative: Development Installation

For development or local testing, you can clone and build from source:

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

4. Configure in `.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "n8n-workflow-builder": {
         "command": "node",
         "args": ["/absolute/path/to/n8n-workflow-builder-mcp/dist/index.js"],
         "env": {
           "N8N_API_URL": "http://localhost:5678",
           "N8N_API_KEY": "your-n8n-api-key-here",
           //"N8N_VERSION": "1.72.1" - optional
         }
       }
     }
   }
   ```

5. For development with auto-rebuild:
   ```bash
   npm run dev
   ```

## Cursor IDE Integration

### Using Cursor Settings UI (Optional)

Alternatively, you can set up the MCP server through Cursor's interface:

1. Start Cursor IDE
2. Go to Settings > Features > MCP Servers
3. Click "Add Server" 
4. For npx method: Use command `npx` with args `["-y", "n8n-workflow-builder-mcp"]`
5. Add environment variables:
   - `N8N_API_URL`: `http://localhost:5678`
   - `N8N_API_KEY`: `your-n8n-api-key-here`
   - `N8N_VERSION`: `1.72.1` (optional - auto-detects if not set)
6. Make sure the server is enabled
7. Restart Cursor IDE for changes to take effect

## Available MCP Tools

The server provides the following tools for working with n8n workflows:

| Tool Name | Description | Key Parameters |
|-----------|-------------|----------------|
| **create_workflow** | Create a new n8n workflow | `workflow_name`, `workspace_dir` |
| **list_workflows** | List all existing workflows | (no parameters) |
| **get_workflow_details** | Get detailed information about a specific workflow | `workflow_name`, `workflow_path` (optional) |
| **add_node** | Add a new node to a workflow | `workflow_name`, `node_type`, `position`, `parameters`, `node_name`, `typeVersion`, `webhookId`, `workflow_path` (optional), `connect_from` (optional), `connect_to` (optional) |
| **edit_node** | Edit an existing node in a workflow | `workflow_name`, `node_id`, `node_type`, `node_name`, `position`, `parameters`, `typeVersion`, `webhookId`, `workflow_path` (optional), `connect_from` (optional), `connect_to` (optional) |
| **delete_node** | Delete a node from a workflow | `workflow_name`, `node_id`, `workflow_path` (optional) |
| **add_connection** | Add a connection between nodes | `workflow_name`, `source_node_id`, `source_node_output_name`, `target_node_id`, `target_node_input_name`, `target_node_input_index` |
| **add_ai_connections** | Add AI connections for LangChain nodes | `workflow_name`, `agent_node_id`, `model_node_id`, `tool_node_ids`, `memory_node_id` |
| **list_available_nodes** | List available node types with optional filtering. Supports tag-style synonyms and multi-token OR/AND logic. | `search_term` (optional), `n8n_version` (optional), `limit` (optional), `cursor` (optional), `tags` (optional, default: true), `token_logic` (optional: 'or' default, or 'and') |
| **get_n8n_version_info** | Get current N8N version and capabilities | (no parameters) |
| **validate_workflow** | Validate a workflow file against node schemas and connectivity | `workflow_name`, `workflow_path` (optional) |

### Validation behavior

`validate_workflow` promotes warnings to errors and additionally fails when any enabled node is not connected (directly or via AI ports) to the main chain starting at the inferred `startNode`. Use `connect_from`/`connect_to` or `add_ai_connections` to fix connectivity.

## Troubleshooting Cursor Integration

If you're having trouble getting the MCP server to work with Cursor, try these steps:

### For npx installation (Recommended method):

 Make sure your `.cursor/mcp.json` file is properly formatted:
   ```json
   {
     "mcpServers": {
       "n8n-workflow-builder": {
         "command": "npx",
         "args": ["-y", "n8n-workflow-builder-mcp"]
       }
     }
   }
   ```

### General troubleshooting:

1. **Check Cursor MCP settings**:
   - Open Cursor Settings
   - Go to Features > MCP Servers
   - Make sure your server is listed and enabled
   - If it's listed but not working, try clicking the refresh button

2. **Check server logs**: Look for errors in the Cursor Output panel. Select "Cursor MCP" from the dropdown in the Output panel to see MCP-specific logs.

3. **Try manual installation**: If npx fails, try the global installation method as an alternative:
   ```bash
   npm install -g n8n-workflow-builder-mcp
   ```

## Common Issues and Solutions

### "Failed to create client" or "Module not found"

This usually happens when:
- Internet connection issues prevent npx from downloading the package
- Node.js/npm version compatibility issues
- Cursor MCP service is not running properly

Try:
1. Check your internet connection
2. Update Node.js to the latest LTS version
3. Restart Cursor completely
4. Try the global installation method as fallback

### MCP Server is not showing up in Cursor

This can happen if:
- The `.cursor/mcp.json` file is not properly formatted
- Cursor hasn't detected the configuration change
- File permissions on the `.cursor` directory

Try:
1. Validating the JSON format of your `.cursor/mcp.json` file
2. Restarting Cursor
3. Manually selecting the server in Cursor settings (if it appears there)
4. Check file permissions: `chmod 755 .cursor`

### MCP Server shows up but tools aren't available

This can happen if:
- The server isn't properly registering its tools
- Package installation is incomplete
- Version compatibility issues

Try:
1. Check the package was downloaded correctly by npx
2. Clicking the refresh button in the MCP server settings in Cursor
3. Try clearing npm cache: `npm cache clean --force`
4. Use the development installation method for debugging

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

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License
