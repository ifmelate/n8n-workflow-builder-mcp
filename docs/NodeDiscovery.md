# Node Discovery Tool Documentation

## Overview

The Node Discovery Tool (`node_search`) is an MCP-compatible tool that allows AI agents to explore and understand available n8n nodes and their parameters. This tool is essential for AI agents to discover what nodes are available and how to configure them when building workflows.

## Features

- **Comprehensive Node Scanning**: Automatically scans and parses all n8n node definition files
- **Intelligent Categorization**: Analyzes node names and structures to categorize them (Trigger, HTTP, Database, etc.)
- **Flexible Search Capabilities**: Search for nodes by category, keyword, or functionality
- **Secure Credential Handling**: Automatically identifies and sanitizes credential parameters
- **Performance Optimization**: Implements caching with configurable TTL for improved response times

## Usage

### MCP Request Format

```json
{
  "category": "node",
  "action": "search",
  "parameters": {
    "category": "string", // optional: Filter by category (e.g., "trigger", "http", "database")
    "keyword": "string", // optional: Search by name or description
    "functionality": "string" // optional: Filter by functionality/purpose
  }
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| category | string | No | Filter nodes by category (e.g., "trigger", "http", "database") |
| keyword | string | No | Search by node name or description |
| functionality | string | No | Filter by node functionality or purpose |

You can use any combination of these parameters to filter the results. If no parameters are provided, all available nodes will be returned.

### Response Format

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

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| count | number | Total number of nodes in the response |
| nodes | array | Array of node objects matching the search criteria |
| node.id | string | Unique identifier for the node |
| node.name | string | Display name of the node |
| node.description | string | Human-readable description of the node's purpose |
| node.parameters | array | Array of parameter objects for the node |
| node.categories | array | Categories the node belongs to |
| parameter.name | string | Name of the parameter |
| parameter.type | string | Data type of the parameter (string, number, boolean, object, array) |
| parameter.value | any | Default value or example value for the parameter |
| parameter.isCredential | boolean | Indicates if the parameter is credential-related |

## Examples

### Example 1: Search for Database Nodes

**Request:**
```json
{
  "category": "node",
  "action": "search",
  "parameters": {
    "category": "database"
  }
}
```

**Response:**
```json
{
  "count": 2,
  "nodes": [
    {
      "id": "postgres",
      "name": "PostgreSQL",
      "description": "Interact with PostgreSQL database",
      "parameters": [
        {
          "name": "operation",
          "type": "string",
          "value": "",
          "isCredential": false
        },
        {
          "name": "credentials",
          "type": "object",
          "value": {
            "credentialType": "credentials"
          },
          "isCredential": true
        }
      ],
      "categories": ["Database", "SQL"]
    },
    {
      "id": "mysql",
      "name": "MySQL",
      "description": "Interact with MySQL database",
      "parameters": [
        {
          "name": "operation",
          "type": "string",
          "value": "",
          "isCredential": false
        },
        {
          "name": "credentials",
          "type": "object",
          "value": {
            "credentialType": "credentials"
          },
          "isCredential": true
        }
      ],
      "categories": ["Database", "SQL"]
    }
  ]
}
```

### Example 2: Search for Nodes by Keyword

**Request:**
```json
{
  "category": "node",
  "action": "search",
  "parameters": {
    "keyword": "email"
  }
}
```

**Response:**
```json
{
  "count": 3,
  "nodes": [
    {
      "id": "gmail",
      "name": "Gmail",
      "description": "Send or process emails with Gmail",
      "parameters": [...],
      "categories": ["Email"]
    },
    {
      "id": "smtp",
      "name": "SMTP",
      "description": "Send emails via SMTP",
      "parameters": [...],
      "categories": ["Email"]
    },
    {
      "id": "mailchimp",
      "name": "Mailchimp",
      "description": "Manage email campaigns with Mailchimp",
      "parameters": [...],
      "categories": ["Email", "Marketing"]
    }
  ]
}
```

### Example 3: Combined Search

**Request:**
```json
{
  "category": "node",
  "action": "search",
  "parameters": {
    "category": "trigger",
    "functionality": "webhook"
  }
}
```

This would return all trigger nodes related to webhooks.

## Implementation Details

### Node Categorization

The tool determines categories for each node based on:

1. **Node ID Analysis**: Examines the node identifier for patterns like "Trigger" or specific service names
2. **Parameter Analysis**: Analyzes the node's parameter structure for operation types
3. **Name Pattern Matching**: Uses regular expressions to identify common node types

### Credential Handling

The tool automatically identifies credential-related parameters by:

1. Looking for parameter names containing terms like "credential", "apiKey", "token", etc.
2. Checking parameter types and credential references
3. Sanitizing credential values to prevent sensitive data exposure

When a credential parameter is identified, the actual value is replaced with a reference structure:

```json
{
  "credentialType": "parameterName"
}
```

### Caching Mechanism

To improve performance, especially with larger n8n installations with many node types, the tool implements caching:

- Default cache TTL: 1 hour
- Cache is invalidated when:
  - TTL expires
  - Application restarts
  - The workflow_nodes directory changes (if monitoring is enabled)

## Error Handling

Common errors that may occur:

- **Directory not found**: The workflow_nodes directory could not be found
- **File parsing error**: One or more node definition files could not be parsed
- **Invalid parameters**: The search parameters provided are invalid

Each error includes a descriptive message to help diagnose the issue.

## Best Practices

1. **Start with broad searches**: Begin with general category searches to understand available nodes

2. **Refine search incrementally**: Gradually add additional parameters to narrow down results

3. **Use the tool early in workflow design**: Search for available nodes before planning your workflow structure

4. **Check parameter details**: Examine the parameters returned to understand how to configure each node

5. **Look for credential requirements**: Pay attention to `isCredential: true` parameters to identify what credentials need to be configured

6. **Cache results when possible**: If building a client application, consider caching results to reduce load on the server 