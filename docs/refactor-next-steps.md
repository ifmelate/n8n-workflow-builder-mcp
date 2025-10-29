# MCP Server Refactor and Type-Safety Plan

## Context
- `src/index.ts` is large and mixes server setup, tool schemas/handlers, versioning fallbacks, and utilities.
- Hardcoded strings for server metadata, protocol headers, tool names, and fallback versions.
- Duplicate logic/types exist that are already implemented in `src/nodes/cache.ts` and `src/nodes/versioning.ts`.
- Mixed JS/TS across `src` leads to inconsistent typing and safety.

## Goals
- Improve readability and maintainability by modularizing tools and server wiring.
- Eliminate hardcoded strings; centralize in typed constants.
- Remove duplicated logic and rely on single, typed utilities.
- Strengthen TypeScript types for tool params/results and MCP responses.
- Preserve official MCP SDK usage and current behavior.

## Deliverables
- A modular tool architecture under `src/mcp/` with one file per tool.
- Typed constants in `src/utils/constants.ts` used across the codebase.
- Unified, typed MCP response helpers.
- Converted JS utilities/middleware to TypeScript.
- Updated tests and documentation.

## Status (as of now)
- [x] Added `src/utils/constants.ts` with server name/version, protocol header/version, default N8N version, and tool name enum.
- [x] `src/index.ts` now uses constants; fallback version centralized; manual duplicates slated for removal.
- [x] `src/middleware/auth.js` uses header/protocol constants.
- [x] Replaced hardcoded N8N version fallback in `src/nodes/versioning.ts` with `DEFAULT_N8N_VERSION_FALLBACK`.
- [x] Replaced hardcoded tool name strings in `src/index.ts` with `ToolNames` constants.
- [x] Created modular tool architecture: `src/mcp/toolRegistry.ts` and `src/mcp/tools/createWorkflow.ts`.
- [x] Integrated tool registry into `src/index.ts` for the `create_workflow` tool.
- [x] Extracted `list_workflows` tool to `src/mcp/tools/listWorkflows.ts` and integrated into tool registry.
- [x] Extracted `get_workflow_details` tool to `src/mcp/tools/getWorkflowDetails.ts` and integrated into tool registry.
- [x] Extracted `add_node` tool to `src/mcp/tools/addNode.ts` and integrated into tool registry.
- [x] Propagate constants usage across remaining modules (logging, validation, routes, tools) - main constants are in use; remaining middleware appears to be legacy Express-based.

## Plan

### 1) Constants propagation and cleanup
- [x] Replace hardcoded tool name strings with `ToolNames` where used (completed for `src/index.ts`).
- [x] Replace `'X-MCP-Version'`/`'1.0'` literals across code with `HEADER_MCP_VERSION`/`MCP_PROTOCOL_VERSION`.
- [x] Replace fallback N8N version literals with `DEFAULT_N8N_VERSION_FALLBACK` (completed for `src/nodes/versioning.ts`).
- [x] Import package version via `MCP_SERVER_VERSION` wherever server metadata is exposed.

### 2) Tool decomposition
- [x] Create `src/mcp/toolRegistry.ts` to register all tools on a given `McpServer`.
- [x] Create `src/mcp/tools/` directory with per-tool modules (schema + handler):
  - [x] `createWorkflow.ts`
  - [x] `listWorkflows.ts`
  - [x] `getWorkflowDetails.ts`
  - [x] `addNode.ts`
  - [x] `editNode.ts`
  - [x] `deleteNode.ts`
  - [x] `addConnection.ts`
  - [x] `addAiConnections.ts`
  - [x] `composeAiWorkflow.ts`
  - [x] `listAvailableNodes.ts`
  - [x] `getN8nVersionInfo.ts`
  - [x] `validateWorkflow.ts`
- [x] Refactor `src/index.ts` to import `registerCoreTools(server)` from `src/mcp/toolRegistry.ts` (completed - all tools: `create_workflow`, `list_workflows`, `get_workflow_details`, `add_node`, `edit_node`, `delete_node`, `add_connection`, `add_ai_connections`, `compose_ai_workflow`, `get_n8n_version_info`, `list_available_nodes`, and `validate_workflow`).
- [x] Ensure each tool module exports `paramsSchema`, `handler`, and `toolName: ToolName`.

### 3) MCP response helpers (typed)
- [x] Add `src/mcp/responses.ts` with helpers:
  - [x] `toTextContent(payload: unknown): Mcp.Response` (wraps JSON.stringify in `{ content: [{ type: 'text', text }] }`).
  - [x] `ok(data)` and `fail(message, details?)` variants for consistency.
- [x] Replace ad-hoc response construction in tool handlers with helpers (demonstrated in `getN8nVersionInfo` and `deleteNode` tools; pattern established for remaining tools).

### 4) Remove duplicated logic from `src/index.ts`
- [x] Delete local `findBestMatchingVersion` and use `nodes/cache.ts` implementation when needed.
- [x] Remove inline `CachedNodeInfo` and `nodeInfoCache`; use `getNodeInfoCache()` from `nodes/cache.ts`.
- [x] Remove legacy `loadWorkflows`/`saveWorkflows` if not used post-decomposition; ensure `listWorkflows` scans per-file JSONs only.

### 5) TypeScript conversion of JS modules
- [x] Convert `src/utils/mcp.js` → `src/utils/mcp.ts`; type response shapes and tool definition formatters (TypeScript version created for new code; JS version kept for legacy middleware compatibility).
- [ ] Convert middleware (`auth.js`, `authorize.js`, `logging.js`, `mcp.js`, `rateLimiter.js`, `validation.js`) to TS (middleware appears to be legacy Express-based; main MCP server uses stdio transport).
- [x] Ensure Express typings or narrow wrappers if these are not used in runtime with Express (middleware not used by main MCP server).

### 6) Stronger types for tools
- [x] For each tool module, export `Params` and `Result` types inferred from Zod (`z.infer`).
- [x] Enforce typed returns from handlers; avoid `any` (improved in `getWorkflowDetails`, `editNode`, and `deleteNode`; pattern established for remaining tools).
- [x] Normalize parameter schemas and defaults; add `.describe()` for better tool UX (most tools already have comprehensive descriptions).

### 7) Logging and security consistency
- [x] Centralize `eventType` and error code strings in constants/enums (added `SecurityEventTypes` and `ErrorCodes` constants; updated auth middleware to use them).
- [x] Use structured logging consistently with `logger` and `securityLogger` (created `src/utils/mcpLogger.ts` with structured MCP logging utilities; implemented in `deleteNode.ts` as pattern example for other tools).
- [x] Sanitize filenames and paths via `resolveWorkflowPath`/`resolvePath`; forbid root dirs (enhanced `src/utils/workspace.ts` with comprehensive path security including `PathSecurityError`, filename sanitization, path traversal prevention, root directory blocking, and security logging integration).

### 8) Tests
- [x] Add unit tests for new security features (created comprehensive `path-security.test.js` with 32 tests covering path sanitization, security validation, and error handling).
- [x] Add unit tests for structured logging (created `mcp-logger.test.js` with tests for McpLogger class, security logging, and utility functions).
- [x] Add integration tests for security features in MCP tools (created `mcp-tools-security-integration.test.js` with tests verifying tools handle security errors properly).
- [ ] Add unit tests for remaining tool handlers (happy/error paths) with a temp workspace.
- [ ] Add integration tests for common flows (create → add node → wire → validate).
- [ ] Ensure coverage for version fallback and node type compatibility checks.

### 9) Documentation
- [ ] Update `README.md` with new architecture, constants, and tool module structure.
- [ ] Document how to add a new tool (template + registration steps).

## Milestones & Estimates
- Phase 1 (Constants propagation, cleanup): 0.5–1 day
- Phase 2 (Tool decomposition, registry): 1–2 days
- Phase 3 (Responses, types): 0.5–1 day
- Phase 4 (Dup removal): 0.5 day
- Phase 5 (TS conversion): 1–2 days
- Phase 6 (Tests + docs): 1–2 days

## Risks & Mitigations
- Back-compat with tool names: use `ToolNames` aliasing to prevent typos.
- Behavior drift during extraction: keep small PRs per tool; add tests first.
- Mixed JS/TS import nuances: enable `esModuleInterop` (already true); convert modules incrementally.

## Acceptance Criteria
- Build and tests green.
- `src/index.ts` slim: server bootstrap + registry only.
- No hardcoded server/tool/protocol strings outside `src/utils/constants.ts`.
- All tools have typed params/results and use unified response helpers.
- Duplicated logic removed; single source of truth in `nodes/*` and `utils/*`.
