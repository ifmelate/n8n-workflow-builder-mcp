# MCP Protocol Documentation

## Overview

The Multi-agent Conversational Protocol (MCP) provides a standardized way for AI agents to interact with the n8n workflow builder server. This document explains how the protocol works and details the available tools for building and managing n8n workflows.

## What is MCP?

MCP (Multi-agent Conversational Protocol) is a standard protocol for AI agents to interact with external systems through a well-defined API. It enables AI systems to discover available tools, execute operations, and process results in a consistent way.

Key aspects of MCP include:
- Tool-based interaction model
- Structured input/output formats
- Schema validation
- Error handling
- Authentication

## Protocol Structure

All requests to the MCP server follow this general structure:

```json
{
  "category": "string",
  "action": "string",
  "parameters": {
    // Tool-specific parameters
  }
}
```

Where:
- `category`: The tool category (e.g., "workflow", "node", "connection")
- `action`: The specific action to perform (e.g., "create", "list", "search")
- `parameters`: Object containing action-specific parameters

All responses follow this general structure:

```json
{
  "result": {
    // Tool-specific response data
  },
  "error": null // Or error object if an error occurred
}
```

## Authentication

All MCP requests require authentication using an API key provided in the HTTP Authorization header:

```
Authorization: Bearer YOUR_API_KEY
```

API keys can be configured in the `.env` file.

## Available Tools

The n8n workflow builder MCP server provides a comprehensive set of tools for AI agents to interact with n8n workflows. These tools are organized into categories and follow standardized input/output schemas.

For detailed documentation on all available tools, see [Tool Definitions](./ToolDefinitions.md).

### Tool Categories

1. **Node Management:** Tools for discovering, adding, and replacing nodes in workflows
2. **Workflow Management:** Tools for creating, saving, loading, and managing workflows
3. **Connection Management:** Tools for managing connections between nodes
4. **n8n Integration:** Tools for deploying and managing workflows in n8n
5. **Workflow Testing:** Tools for testing workflow execution

### Standardized Format

All tools follow a standardized format:
- Unique name (e.g., `node_search`, `workflow_create`)
- Comprehensive description
- JSON Schema for inputs
- JSON Schema for outputs
- Clear documentation

### Workflow Management

#### workflow_create
Creates a new n8n workflow.

**Parameters:**
```json
{
  "name": "string",
  "description": "string", // optional
  "active": boolean // optional, default: false
}
```

**Response:**
```json
{
  "id": "string",
  "name": "string",
  "created": "ISO-date-string"
}
```

#### workflow_list
Lists existing n8n workflows.

**Parameters:**
```json
{
  "limit": number, // optional, default: 20
  "offset": number, // optional, default: 0
  "active": boolean // optional
}
```

**Response:**
```json
{
  "count": number,
  "workflows": [
    {
      "id": "string",
      "name": "string",
      "active": boolean,
      "created": "ISO-date-string",
      "nodeCount": number
    }
  ]
}
```

### Node Management

#### node_search
Searches for available n8n nodes and their parameters.

**Parameters:**
```json
{
  "category": "string", // optional: Filter by category (e.g., "trigger", "http", "database")
  "keyword": "string", // optional: Search by name or description
  "functionality": "string" // optional: Filter by functionality/purpose
}
```

**Response:**
```json
{
  "count": number,
  "nodes": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "parameters": [
        {
          "name": "string",
          "type": "string",
          "value": any,
          "isCredential": boolean
        }
      ],
      "categories": ["string"]
    }
  ]
}
```

#### node_add
Adds a node to an existing workflow.

**Parameters:**
```json
{
  "workflowId": "string",
  "nodeType": "string",
  "name": "string", // optional, defaults to nodeType
  "position": { // optional
    "x": number,
    "y": number
  },
  "parameters": { // optional
    // Node-specific parameters
  }
}
```

**Response:**
```json
{
  "id": "string",
  "name": "string",
  "type": "string",
  "position": {
    "x": number,
    "y": number
  }
}
```

### Connection Management

#### connection_create
Creates a connection between two nodes in a workflow.

**Parameters:**
```json
{
  "workflowId": "string",
  "sourceNodeId": "string",
  "targetNodeId": "string",
  "sourceOutputIndex": number, // optional, default: 0
  "targetInputIndex": number // optional, default: 0
}
```

**Response:**
```json
{
  "id": "string",
  "source": "string",
  "target": "string"
}
```

### Credential Management

#### credential_store
Securely stores a credential for use with nodes.

**Parameters:**
```json
{
  "name": "string",
  "data": {
    // Credential data to encrypt and store
  },
  "type": "string" // optional: "api", "oauth", "database", or "generic" (default)
}
```

**Response:**
```json
{
  "id": "string",
  "name": "string",
  "type": "string"
}
```

#### credential_get
Retrieves a stored credential.

**Parameters:**
```json
{
  "name": "string"
}
```

**Response:**
```json
{
  "id": "string",
  "name": "string",
  "type": "string",
  "data": {
    // Decrypted credential data
  }
}
```

## Error Handling

When an error occurs, the response will include an error object:

```json
{
  "result": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {} // Optional additional error details
  }
}
```

Common error codes:
- `INVALID_REQUEST_FORMAT`: The request format is invalid
- `AUTHENTICATION_FAILED`: Authentication failed or is missing
- `AUTHORIZATION_FAILED`: User is not authorized to perform the action
- `RESOURCE_NOT_FOUND`: Requested resource was not found
- `VALIDATION_ERROR`: Parameter validation failed
- `INTERNAL_SERVER_ERROR`: An internal server error occurred

## Usage Examples

### Example 1: Creating a Workflow and Adding Nodes

```javascript
// 1. Create a new workflow
const workflowResponse = await fetch('http://localhost:3000/api/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    category: 'workflow',
    action: 'create',
    parameters: {
      name: 'Email Notification',
      description: 'Sends email notifications for new events'
    }
  })
});

const workflow = await workflowResponse.json();
const workflowId = workflow.id;

// 2. Search for email-related nodes
const nodesResponse = await fetch('http://localhost:3000/api/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    category: 'node',
    action: 'search',
    parameters: {
      keyword: 'email'
    }
  })
});

const nodes = await nodesResponse.json();

// 3. Add a trigger node
const triggerResponse = await fetch('http://localhost:3000/api/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    category: 'node',
    action: 'add',
    parameters: {
      workflowId: workflowId,
      nodeType: 'scheduleTrigger',
      position: { x: 100, y: 100 },
      parameters: {
        interval: { unit: 'minutes', value: 5 }
      }
    }
  })
});

const triggerNode = await triggerResponse.json();

// 4. Add an email sending node
const emailResponse = await fetch('http://localhost:3000/api/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    category: 'node',
    action: 'add',
    parameters: {
      workflowId: workflowId,
      nodeType: 'gmail',
      position: { x: 300, y: 100 },
      parameters: {
        operation: 'sendEmail',
        to: 'recipient@example.com',
        subject: 'New notification',
        text: 'This is an automated notification'
      }
    }
  })
});

const emailNode = await emailResponse.json();

// 5. Connect the nodes
const connectionResponse = await fetch('http://localhost:3000/api/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    category: 'connection',
    action: 'create',
    parameters: {
      workflowId: workflowId,
      sourceNodeId: triggerNode.id,
      targetNodeId: emailNode.id
    }
  })
});

const connection = await connectionResponse.json();
```

## Best Practices

1. **Use the discovery tools**: Before creating workflows, use the `node_search` tool to understand available nodes and their parameters.

2. **Handle errors gracefully**: Check for and handle error responses from the MCP server.

3. **Store credentials securely**: Use the credential management tools to securely store any credentials needed for nodes.

4. **Validate parameters**: Ensure that all parameters sent to MCP tools are valid and match the expected schema.

5. **Position nodes thoughtfully**: When adding nodes to a workflow, position them in a logical layout to make the workflow easy to understand.

6. **Use descriptions**: Provide clear descriptions for workflows and meaningful names for nodes to improve usability.

7. **Test workflows**: After building a workflow, test it with various inputs to ensure it works as expected.

## Troubleshooting

- **Authentication errors**: Ensure your API key is correct and properly formatted in the Authorization header.

- **Invalid parameters**: Check that your request parameters match the expected schema for each tool.

- **Resource not found**: Verify that workflow and node IDs exist before trying to reference them in operations.

- **Connection failures**: When creating connections, ensure both the source and target nodes exist in the workflow.

- **Performance issues**: The Node Discovery tool uses caching to improve performance. If you experience slow responses, ensure you're not making excessive requests. 