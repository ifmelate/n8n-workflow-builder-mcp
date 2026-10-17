# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

n8n Workflow Builder MCP — an MCP server that enables AI agents to build n8n workflows via the Model Context Protocol. It exposes 14 tools for workflow lifecycle management (create, add/edit/delete nodes, connect, validate, etc.) over StdIO transport.

## Commands

```bash
npm run build          # TypeScript compile (tsc) + chmod + bundle catalog to dist/
npm run dev            # Watch mode: rebuild & run on src changes
npm test               # Run Jest test suite
npm test -- --testPathPattern="test-name"  # Run a single test file
npm run test:langchain # Mocha test for LangChain LLM format
npm run lint           # ESLint
npm run format         # Prettier
npm run build:nodes-db # Build/update SQLite catalog from workflow_nodes/
npm run rebuild:nodes-db # Full rebuild of SQLite catalog
```

Build order for publish: `build:nodes-db` -> `build` (handled by `prepublishOnly`).

## Architecture

### Entry Point & Server

`src/index.ts` — Main MCP server. Initializes `McpServer` from `@modelcontextprotocol/sdk`, loads n8n version support, registers all tools, starts StdIO transport. This is a large file (~177KB) containing core server logic.

### Tool System

Each tool in `src/mcp/tools/*.ts` exports four things:
- `toolName` — string constant
- `description` — human-readable
- `paramsSchema` — Zod schema for validation
- `handler` — async function returning `{ content: [{ type: "text", text: JSON.stringify(...) }] }`

Tools are registered in `src/mcp/toolRegistry.ts` which calls `server.tool()` for each.

### Key Subsystems

- **Node versioning** (`src/nodes/versioning.ts`, `cache.ts`) — Loads versioned node definitions from `workflow_nodes/{version}/`, uses "closest lower version" matching for backward compatibility across 184+ n8n versions (1.86.0 – 2.6.2).
- **SQLite catalog** (`catalog.sqlite`, `src/utils/nodesDb.ts`) — 27MB database of all n8n node definitions with gzip-compressed JSON blobs. Built by `scripts/build-nodes-db.js`, materialized to filesystem at runtime.
- **Validation** (`src/validation/workflowValidator.ts`, `nodeTypesLoader.ts`) — Validates workflow structure, node types, connections.
- **AI wiring** (`src/tools/wiringService.ts`) — Handles AI-specific connection types (ai_languageModel, ai_tool, ai_memory, ai_embedding, ai_document, ai_vectorStore).
- **Workspace** (`src/utils/workspace.ts`) — Path management with security (traversal prevention, no root access).
- **LLM normalization** (`src/utils/llm.ts`) — Converts LLM agent outputs to valid tool parameters with type coercion.

### Data Flow

```
AI Agent -> StdIO Transport -> McpServer -> Tool Handler (Zod validation)
  -> Service Layer (wiring, validation, node resolution)
  -> Workflow JSON files in workflow_data/
```

### Legacy Code

`src/models/`, `src/middleware/`, `src/routes/` — Legacy JavaScript modules (Express-era). The active server uses the MCP SDK pattern, not Express.

## Testing

- Jest with ts-jest for TypeScript. Config in `jest.config.js`.
- Tests in `tests/unit/` — mix of `.test.js` and `.test.ts` files.
- Module alias `@/` maps to `src/` via `moduleNameMapper`.
- One Mocha test: `tests/unit/langchain-llm-format.test.js`.

## Key Conventions

- Use the official MCP SDK: `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/stdio.js`.
- All tool responses follow the pattern: `{ content: [{ type: "text", text: JSON.stringify({ success, data, error? }) }] }`.
- Node types are auto-prefixed (e.g., `Slack` -> `n8n-nodes-base.slack`). The normalization layer in `cache.ts` handles this.
- Environment variables: `N8N_API_URL`, `N8N_API_KEY`, `N8N_VERSION` (optional, auto-detects).
- Default n8n version fallback: `1.123.2` (in `src/utils/constants.ts`).
- Do not add `Co-Authored-By` lines to git commit messages.
