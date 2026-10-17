
# n8n Workflow Builder MCP

A Model Context Protocol (MCP) server for building and manipulating n8n workflows. Build n8n workflows just by prompting with AI — works with Claude Code, VS Code, Cursor, and any MCP-compatible client.

<a href="https://glama.ai/mcp/servers/@ifmelate/n8n-workflow-builder-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@ifmelate/n8n-workflow-builder-mcp/badge" alt="n8n-workflow-builder-mcp MCP server" />
</a>

## Is this the right MCP server for you?

This server writes n8n workflow **JSON files locally**. It doesn't need a running n8n instance, and it picks node versions from a bundled catalog that covers n8n 1.86.0 – 2.6.2.

**Use this server if you:**
- want to generate workflow files offline and import them yourself (or commit them to git)
- are on an older self-hosted n8n and need workflows whose node `typeVersion`s your instance actually supports. Set `N8N_VERSION` to match it.

**Consider an alternative if you:**
- want the AI to build, test and run workflows directly in your n8n instance. Use n8n's built-in [instance-level MCP server](https://docs.n8n.io/build/ways-of-building-workflows/connect-to-n8n-mcp-server).
- want a large node documentation and template library with deployment through the n8n API. Use [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp).
- need nodes added in n8n after 2.6.2. They aren't in the bundled catalog yet.

# DEMO VIDEO:
[![Watch the video](https://github.com/user-attachments/assets/53706f62-7e99-449f-8537-0ce951c727e1)](https://youtu.be/MKEVLM5QmPA?si=8SJQAcYGeAIuhaBm)

## Cursor rules
- File with rules is in `rules/n8n-mcp-server-rules.mdc`

## Key Features

- **Workflow Management**: Create, update, and execute n8n workflows programmatically (execute is not implemented yet)
- **Node Discovery**: Explore available n8n nodes and their capabilities 
- **Connection Management**: Create connections between workflow nodes
- **AI Integration**: Special tools for connecting AI components in workflows
- **AI-Friendly Interface**: Designed specifically for interaction with AI agents
- **N8N Version Management**: Automatic version detection and compatibility handling - supports 184+ n8n versions (1.86.0 – 2.6.2) with dynamic node filtering and "closest lower version" matching for backward compatibility

## Prerequisites

- Node.js (v18 or higher)
- npm (for npx command)
- An MCP-compatible client (Claude Code, VS Code, Cursor, etc.)

## Installation & Setup

### Getting your n8n API Key

The API key is optional. The server only uses `N8N_API_URL`/`N8N_API_KEY` to detect your n8n version. To work fully offline, skip them and set `N8N_VERSION` (e.g. `N8N_VERSION=1.123.2`) instead.

1. Open your n8n instance in a browser
2. Go to **Settings > API Keys**
3. Click **Create API Key**
4. Copy the generated key and use it in your configuration

### Claude Code (Recommended)

Add the MCP server using the Claude Code CLI:

```bash
claude mcp add n8n-workflow-builder -- npx -y n8n-workflow-builder-mcp
```

Then set the environment variables:

```bash
claude mcp add n8n-workflow-builder \
  -e N8N_API_URL=http://localhost:5678 \
  -e N8N_API_KEY=your-n8n-api-key-here \
  -- npx -y n8n-workflow-builder-mcp
```

> `N8N_VERSION` is optional — the server auto-detects it from the API.

### VS Code / Cursor

Add to your MCP config file (`.vscode/mcp.json` for VS Code, `.cursor/mcp.json` for Cursor):

```json
{
  "mcpServers": {
    "n8n-workflow-builder": {
      "command": "npx",
      "args": ["-y", "n8n-workflow-builder-mcp"],
      "env": {
        "N8N_API_URL": "http://localhost:5678",
        "N8N_API_KEY": "your-n8n-api-key-here"
      }
    }
  }
}
```

Restart your IDE for changes to take effect.

### Development Installation

For development or local testing, clone and build from source:

```bash
git clone https://github.com/ifmelate/n8n-workflow-builder-mcp.git
cd n8n-workflow-builder-mcp
npm install
npm run build
```

Then point your MCP client to the built entry point:

```bash
# Claude Code
claude mcp add n8n-workflow-builder -- node /absolute/path/to/n8n-workflow-builder-mcp/dist/index.js

# VS Code / Cursor — use the same JSON config above with "command": "node" and "args": ["/absolute/path/to/dist/index.js"]
```

For development with auto-rebuild:
```bash
npm run dev
```

## Available MCP Tools

The server provides the following tools for working with n8n workflows:

### Core Workflow Management

| Tool Name | Description | Key Parameters |
|-----------|-------------|----------------|
| **create_workflow** | Create a new n8n workflow | `workflow_name`, `workspace_dir` |
| **list_workflows** | List workflows in the workspace | `limit` (optional), `cursor` (optional) |
| **get_workflow_details** | Get detailed information about a specific workflow | `workflow_name`, `workflow_path` (optional) |
| **validate_workflow** | Validate a workflow file against node schemas and connectivity | `workflow_name`, `workflow_path` (optional) |

### Node Management

| Tool Name | Description | Key Parameters |
|-----------|-------------|----------------|
| **add_node** | Add a new node to a workflow | `workflow_name`, `node_type`, `position` (optional), `parameters` (optional), `node_name` (optional), `typeVersion` (optional), `webhookId` (optional), `workflow_path` (optional), `connect_from` (optional), `connect_to` (optional) |
| **edit_node** | Edit an existing node in a workflow | `workflow_name`, `node_id`, `node_type` (optional), `node_name` (optional), `position` (optional), `parameters` (optional), `typeVersion` (optional), `webhookId` (optional), `workflow_path` (optional), `connect_from` (optional), `connect_to` (optional) |
| **delete_node** | Delete a node from a workflow | `workflow_name`, `node_id`, `workflow_path` (optional) |
| **list_available_nodes** | List available node types with optional filtering. Supports tag-style synonyms and multi-token OR/AND logic | `search_term` (optional), `n8n_version` (optional), `limit` (optional), `cursor` (optional), `tags` (optional, default: true), `token_logic` (optional: 'or' default, or 'and') |

### Connection Management

| Tool Name | Description | Key Parameters |
|-----------|-------------|----------------|
| **add_connection** | Create a connection between two nodes | `workflow_name`, `source_node_id`, `source_node_output_name`, `target_node_id`, `target_node_input_name`, `target_node_input_index` (optional), `workflow_path` (optional) |
| **add_ai_connections** | Wire AI model, tools, and memory to an agent | `workflow_name`, `agent_node_id`, `model_node_id` (optional), `tool_node_ids` (optional), `memory_node_id` (optional), `embeddings_node_id` (optional), `vector_store_node_id` (optional), `vector_insert_node_id` (optional), `vector_tool_node_id` (optional), `workflow_path` (optional) |
| **connect_main_chain** | Build a minimal main path through AI workflow nodes (Trigger → Model → Memory → Embeddings → Doc Loader → Vector Store → Vector Tool → Agent) | `workflow_name`, `workflow_path` (optional), `dry_run` (optional), `idempotency_key` (optional) |

### Workflow Planning & Composition

| Tool Name | Description | Key Parameters |
|-----------|-------------|----------------|
| **plan_workflow** | Create a non-destructive plan (nodes and connections) to update a workflow. Does not write files | `workflow_name`, `target` (nodes, connections), `workspace_dir` (optional) |
| **review_workflow_plan** | Apply a plan in-memory and return validation errors, warnings, and suggested fixes. Does not write files | `workflow_name`, `plan`, `workflow_path` (optional) |
| **apply_workflow_plan** | Apply a previously reviewed plan to the workflow on disk (atomic write) | `workflow_name`, `plan`, `workflow_path` (optional) |
| **compose_ai_workflow** | Compose a complex AI workflow (agent + model + memory + embeddings + vector + tools + trigger) in one call, including wiring and basic validation | `workflow_name`, `plan`, `n8n_version` (optional) |

### Parameter Management

| Tool Name | Description | Key Parameters |
|-----------|-------------|----------------|
| **suggest_node_params** | Suggest minimal valid parameters for a node type using defaults and required fields | `node_type`, `typeVersion` (optional), `existing_parameters` (optional) |
| **list_missing_parameters** | List required parameters missing for a node considering visibility rules | `node_type`, `typeVersion` (optional), `parameters` |
| **fix_node_params** | Return parameters with defaults applied for required fields that are missing | `node_type`, `typeVersion` (optional), `parameters` (optional) |

### Templates & Discovery

| Tool Name | Description | Key Parameters |
|-----------|-------------|----------------|
| **list_template_examples** | List node usage examples extracted from free templates. Filter by node_type or template_name | `node_type` (optional), `template_name` (optional), `limit` (optional), `cursor` (optional) |
| **get_n8n_version_info** | Get current N8N version and capabilities | `random_string` |

### Validation behavior

`validate_workflow` promotes warnings to errors and additionally fails when any enabled node is not connected (directly or via AI ports) to the main chain starting at the inferred `startNode`. Use `connect_from`/`connect_to` or `add_ai_connections` to fix connectivity.

## Troubleshooting

### General

1. **Check your MCP config** — make sure JSON is valid and the server name matches.
2. **Update Node.js** to the latest LTS version.
3. **Clear npm cache** if npx fails: `npm cache clean --force`
4. **Try global install** as a fallback: `npm install -g n8n-workflow-builder-mcp`

### Claude Code

- Run `claude mcp list` to verify the server is registered.
- Check logs with `claude mcp logs n8n-workflow-builder`.

### VS Code / Cursor

- Check the Output panel — select "MCP" from the dropdown to see server logs.
- Make sure the server is enabled in Settings > Features > MCP Servers.
- Restart the IDE after config changes.

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
