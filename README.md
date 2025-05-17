# n8n Workflow Builder MCP

This project provides a Model Context Protocol (MCP) server for building and manipulating n8n workflows in Cursor IDE.

## MCP Server Setup

We've created a custom MCP server that integrates with Cursor IDE to provide tools for working with n8n workflows. For detailed instructions on setting up and troubleshooting the MCP server, see [MCP-README.md](MCP-README.md).

### Quick Setup & Running

1.  **Install Dependencies:**
    If you haven't already, install the project dependencies:
    ```bash
    npm install
    ```

2.  **Build the Project:**
    Compile the TypeScript code to JavaScript:
    ```bash
    npm run build
    ```

3.  **Run the Server:**
    Start the MCP server:
    ```bash
    npm start
    ```
    This will run the compiled code from `dist/index.js`.

    For development with auto-rebuild and restart on changes:
    ```bash
    npm run dev
    ```

4.  **Cursor Integration:**
    Restart Cursor IDE. Go to Settings > Features > MCP Servers.
    - If you are adding this server for the first time, click "Add Server" and provide the **absolute path** to the `dist/index.js` file in your project directory (e.g., `/Users/yourname/n8n-workflow-builder-mcp/dist/index.js`).
    - If you had a previous configuration, ensure it's updated to point to this new `dist/index.js` path.
    - Make sure the server is enabled.

### Available MCP Tools

The MCP server provides the following tools for working with n8n workflows:

- **list_workflows**: List all available workflows in the n8n instance
- **get_workflow_details**: Get detailed information about a specific workflow
- **create_workflow**: Create a new workflow
- **add_node**: Add a node to a workflow

Build and manage n8n workflows programmatically through an AI-friendly API server.

## Overview

This project provides a bridge between AI agents and the n8n workflow automation platform, allowing for the programmatic creation, modification, and execution of n8n workflows. It serves as a specialized API server that implements the MCP (Multi-agent Conversational Protocol) standard to enable seamless interaction with AI systems.

## Key Features

- **Workflow Management**: Create, update, and execute n8n workflows programmatically
- **Node Discovery**: Explore available n8n nodes and their capabilities 
- **Connection Management**: Create connections between workflow nodes
- **Credential Management**: Securely store and manage credentials for nodes
- **AI-Friendly Interface**: Designed specifically for interaction with AI agents

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- n8n instance (running locally or remotely)
- TypeScript compiler (installed as a dev dependency via `npm install`)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/n8n-workflow-builder-mcp.git
   cd n8n-workflow-builder-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create an environment file (if applicable, though current setup primarily uses file storage):
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file if your server requires specific environment variables for n8n credentials or other configurations.

4. Build the TypeScript project:
    ```bash
    npm run build
    ```

5. Start the server:
   To start the server for production/general use:
   ```bash
   npm start
   ```
   For development with automatic recompilation on file changes:
   ```bash
   npm run dev
   ```

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

## API Tools

The server provides several MCP-compatible tools for interacting with n8n:

### Available Tools

- `workflow_create`: Create new n8n workflows
- `workflow_list`: List existing workflows
- `node_search`: Find available n8n nodes and their parameters
- `node_add`: Add nodes to a workflow
- `connection_create`: Connect nodes within a workflow
- `credential_store`: Securely store credentials for nodes

For detailed documentation on each tool, see the [MCP Protocol Documentation](docs/MCP.md).

## Usage Example

```javascript
// Example: Search for database-related nodes
const response = await fetch('http://localhost:3000/api/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    category: 'node',
    action: 'search',
    parameters: {
      category: 'database'
    }
  })
});

const data = await response.json();
console.log(data.nodes); // Array of database-related nodes
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 