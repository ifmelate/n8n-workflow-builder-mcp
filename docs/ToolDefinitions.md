# MCP Tool Definitions Documentation

This document describes the standardized tool definitions used in the n8n Workflow Builder MCP API.

## Overview

The n8n Workflow Builder exposes a set of tools via MCP (Multi-agent Conversational Protocol) that allow AI agents to create and manage n8n workflows. Each tool has a standardized definition that includes:

- Name: A unique identifier for the tool
- Description: A human-readable description of what the tool does
- Input Schema: A JSON Schema that defines the parameters the tool accepts
- Output Schema: A JSON Schema that defines the expected output format

## Tool Categories

Tools are grouped into the following categories:

1. **Node Management:** Tools for discovering, adding, and replacing nodes in workflows
2. **Workflow Management:** Tools for creating, saving, loading, and managing workflows
3. **Connection Management:** Tools for managing connections between nodes
4. **N8N Integration:** Tools for deploying and managing workflows in n8n
5. **Workflow Testing:** Tools for testing workflow execution

## Node Management Tools

### node_search

Searches for available n8n nodes with optional filtering.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Filter nodes by category (e.g., 'trigger', 'http', 'database')"
    },
    "keyword": {
      "type": "string",
      "description": "Search by name or description"
    },
    "functionality": {
      "type": "string",
      "description": "Filter by node functionality/purpose"
    }
  }
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "count": { 
      "type": "number",
      "description": "Number of nodes found" 
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "parameters": { "type": "object" },
          "categories": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  },
  "required": ["nodes"]
}
```

### node_add

Adds a node to an existing workflow.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "workflowId": {
      "type": "string",
      "description": "ID or path of the workflow to add the node to"
    },
    "nodeType": {
      "type": "string",
      "description": "Type of node to add (as found through search_nodes)"
    },
    "position": {
      "type": "object",
      "description": "Position of the node in the workflow canvas",
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" }
      }
    },
    "parameters": {
      "type": "object",
      "description": "Parameters for the node"
    }
  },
  "required": ["workflowId", "nodeType"]
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "nodeId": { "type": "string" },
    "workflowData": { "type": "object" }
  },
  "required": ["success", "nodeId"]
}
```

### node_replace

Replaces an existing node in a workflow with a new node type.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "workflowId": {
      "type": "string",
      "description": "ID or path of the workflow containing the node"
    },
    "targetNodeId": {
      "type": "string",
      "description": "ID of the node to replace"
    },
    "newNodeType": {
      "type": "string",
      "description": "Type of the new node to replace with (as found through search_nodes)"
    },
    "parameters": {
      "type": "object",
      "description": "Parameters for the new node"
    }
  },
  "required": ["workflowId", "targetNodeId", "newNodeType"]
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "nodeId": { "type": "string" },
    "workflowData": { "type": "object" },
    "compatibilityReport": {
      "type": "object",
      "properties": {
        "maintainedConnections": { "type": "array", "items": { "type": "string" } },
        "removedConnections": { "type": "array", "items": { "type": "string" } }
      }
    }
  },
  "required": ["success", "nodeId"]
}
```

## Workflow Management Tools

### workflow_create

Creates a new workflow with the basic structure required by n8n.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Name of the workflow"
    },
    "description": {
      "type": "string",
      "description": "Description of the workflow"
    },
    "active": {
      "type": "boolean",
      "description": "Whether the workflow should be active"
    },
    "settings": {
      "type": "object",
      "description": "Custom workflow settings"
    }
  },
  "required": ["name"]
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "workflowId": { "type": "string" },
    "workflowData": { "type": "object" }
  },
  "required": ["workflowId", "workflowData"]
}
```

### workflow_save

Saves a workflow to the filesystem.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "workflowId": {
      "type": "string",
      "description": "Unique identifier for the workflow"
    },
    "workflowData": {
      "type": "object",
      "description": "Complete workflow data to save"
    },
    "filePath": {
      "type": "string",
      "description": "Filepath where the workflow should be saved"
    }
  },
  "required": ["workflowId", "workflowData", "filePath"]
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "filePath": { "type": "string" }
  },
  "required": ["success", "filePath"]
}
```

### workflow_load

Loads a workflow from a specific filepath.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "workflowIdOrPath": {
      "type": "string",
      "description": "The complete filepath to the workflow JSON file"
    }
  },
  "required": ["workflowIdOrPath"]
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "workflowId": { "type": "string" },
    "workflowData": { "type": "object" }
  },
  "required": ["workflowId", "workflowData"]
}
```

### workflow_list

Lists workflows from a directory.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "directoryPath": {
      "type": "string",
      "description": "Directory path to list workflows from"
    },
    "limit": {
      "type": "integer",
      "description": "Maximum number of workflows to return"
    },
    "offset": {
      "type": "integer",
      "description": "Number of workflows to skip"
    }
  }
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "workflows": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "path": { "type": "string" },
          "lastModified": { "type": "string" }
        }
      }
    },
    "total": { "type": "number" }
  },
  "required": ["workflows", "total"]
}
```

## Connection Management Tools

### connection_create

Creates a connection between two nodes in a workflow.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "workflowId": {
      "type": "string",
      "description": "ID or path of the workflow to modify"
    },
    "sourceNodeId": {
      "type": "string",
      "description": "ID of the source node"
    },
    "targetNodeId": {
      "type": "string",
      "description": "ID of the target node"
    },
    "sourceOutput": {
      "type": "string",
      "description": "Output name on source node (default: 'main')"
    },
    "targetInput": {
      "type": "string",
      "description": "Input name on target node (default: 'main')"
    }
  },
  "required": ["workflowId", "sourceNodeId", "targetNodeId"]
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "connection": { 
      "type": "object",
      "properties": {
        "sourceNodeId": { "type": "string" },
        "targetNodeId": { "type": "string" },
        "sourceOutput": { "type": "string" },
        "targetInput": { "type": "string" }
      }
    },
    "workflowData": { "type": "object" }
  },
  "required": ["success", "connection"]
}
```

## Testing Tools

### test_workflow

Tests a workflow by executing it and returning results.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "workflowId": {
      "type": "string",
      "description": "ID of the workflow to execute"
    },
    "testData": {
      "type": "object",
      "description": "Test data to use for the execution"
    },
    "timeout": {
      "type": "number",
      "description": "Timeout in milliseconds for the execution (default: 60000)"
    }
  },
  "required": ["workflowId"]
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "executionId": { "type": "string" },
    "data": { "type": "object" },
    "logs": { 
      "type": "array",
      "items": { "type": "string" }
    },
    "executionTime": { "type": "number" },
    "status": { "type": "string" }
  },
  "required": ["success", "executionId", "status"]
}
```

## Using the Tools

### Tool Definition Endpoint

To get the definitions of all available tools, send a POST request to `/mcp/tools`.

### Tool Execution Endpoint

To execute a tool, send a POST request to `/mcp/execute` with a body containing:

```json
{
  "name": "node_search",
  "parameters": {
    "category": "trigger"
  }
}
```

## Error Handling

Tools may return errors in the following format:

```json
{
  "error": {
    "message": "Description of the error",
    "code": "ERROR_CODE",
    "details": { "additional": "information" }
  }
}
```

Common error codes include:

- `TOOL_NOT_FOUND`: The specified tool does not exist
- `INVALID_REQUEST_FORMAT`: The request format is invalid
- `INVALID_TOOL_PARAMETERS`: The tool parameters are invalid
- `TOOL_EXECUTION_ERROR`: An error occurred while executing the tool
- `INTERNAL_SERVER_ERROR`: An unexpected error occurred 