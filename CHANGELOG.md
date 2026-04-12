# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-12

### n8n 2.x Support & Bundled Node Catalog

This release adds full n8n 2.x compatibility, ships a working node catalog with the npm package (previously broken), and fixes multiple bugs found during integration testing against a live n8n 2.6.2 instance.

### Added

- **Bundled SQLite node catalog** — npm package now ships `dist/catalog.sqlite` with all node definitions. Previously users got an empty catalog and tools like `list_available_nodes` returned nothing.
- **Content-addressed dedup + gzip** in catalog DB — 475 MB raw JSON compressed to ~34 MB SQLite (52x dedup ratio, per-row gzip). Schema: `blobs(sha256, gz, len)` + `nodes(id, version, sha256)`.
- **n8n 2.6.2 node catalog** — 532 nodes scraped and added. Full version coverage from 1.86.0 through 2.6.2 (229 versions).
- **Version-aware workflow activation** — `workflowActivationDefaults()` helper omits `active` field for n8n 2.x (where it's read-only) and includes `active: false` for 1.x.
- **`isN8n2xOrLater()`** / **`getN8nMajorVersion()`** helpers in versioning module.
- **Langchain short-name aliases** — type `chatTrigger` instead of `@n8n/n8n-nodes-langchain.chatTrigger`. Also reverse aliases for tool nodes: `httpRequestTool` -> `toolHttpRequest`.
- **Unknown node type warnings** — `add_node` now warns when a type isn't found in the catalog (still allows add for community nodes).
- **`bundle-nodes-db.js`** postbuild script — copies catalog to `dist/` automatically.
- **DB fallback chain** — runtime checks: `N8N_NODES_DB_PATH` env -> `~/.cache/n8n-nodes/catalog.sqlite` -> bundled `dist/catalog.sqlite`.
- **Legacy schema auto-migration** — `build-nodes-db.js` detects old `raw TEXT` schema and migrates to dedup+gzip in-place.

### Fixed

- **CRITICAL: Node cache was always empty** — `loadKnownNodeBaseTypes()` resolved `__dirname/../workflow_nodes` (= `dist/workflow_nodes/`, doesn't exist) instead of `../../workflow_nodes`. All node types fell through to `n8n-nodes-base.*` prefix with `typeVersion: 1`. Fixed path to match `versioning.ts`.
- **CRITICAL: Langchain nodes got wrong prefix** — Without cache, `chatTrigger` resolved to `n8n-nodes-base.chatTrigger` instead of `@n8n/n8n-nodes-langchain.chatTrigger`. Root cause was the empty cache above.
- **`active: false` rejected by n8n 2.x** — n8n 2.6.2 returns `400 "request/body/active is read-only"` when `active` is present in workflow creation. All 8 workflow-creation sites now use `...workflowActivationDefaults()`.
- **`compose_ai_workflow` node duplication** — repeated calls created 2x-3x duplicate nodes. Added name-based dedup in both the inline handler (index.ts, the real one) and modular handler.
- **Filename sanitization mismatch** — `create_workflow` used aggressive regex (`/[^a-z0-9_.-]/gi`) while `resolveWorkflowPath` used `sanitizeFilename()` (preserves spaces). Unified to use `sanitizeFilename` everywhere.
- **Validator false-positive on AI sub-nodes** — `node_not_in_main_chain` error for nodes connected via AI handles (ai_languageModel, ai_memory, etc.). Now uses extended reachability graph that traverses all connection types.
- **`httpRequestTool` not found** — LLMs guess `httpRequestTool` but catalog stores `toolHttpRequest`. Added reverse aliases for all `tool*` langchain nodes.

### Changed

- `DEFAULT_N8N_VERSION_FALLBACK` bumped from `1.104.1` to `1.123.2`.
- `N8nWorkflow.active` field changed from `boolean` to `boolean | undefined` (optional).
- `package.json` `files` now includes `dist/catalog.sqlite`.
- Tests updated: `httpRequest` expected typeVersion `4.3` -> `4.4` (reflects 2.6.2 catalog).

## [1.0.2] - 2025-12-10

### Patch release

- Fix: add build step to npm publish workflow
- Update version to 1.0.2

## [1.0.0] - 2025-12-05

### 🎉 Major Release: Database-Backed Node Management & Modular Architecture

This release represents a major architectural refactor that migrates from file-based node definitions to a SQLite database-backed system, significantly improves code organization, and adds comprehensive testing infrastructure.

### ⚠️ BREAKING CHANGES

- **Node Definitions Storage**: Migrated from static JSON files to SQLite database
  - `workflow_nodes/` directory is no longer shipped with the package
  - Node definitions are now materialized on-demand from `~/.cache/n8n-nodes/catalog.sqlite`
  - First-time users need to build the database: `npm run build:nodes-db`
- **Package Files**: Removed `workflow_nodes/` from package distribution
  - Only `dist/`, `README.md`, and `LICENSE` are now included in published package
- **Database Cache Location**: Node definitions are cached at `~/.cache/n8n-nodes/catalog.sqlite` instead of repository directory

### ✨ Added

#### Database Infrastructure
- **SQLite Database Backend** (`src/utils/nodesDb.ts`)
  - Introduced `better-sqlite3` for node definition storage
  - Database schema with `versions` and `nodes` tables with proper indexing
  - Materialization system that generates `workflow_nodes/` on-demand from database
  - New functions:
    - `materializeVersionFromDb(version: string)` - Materialize specific n8n version
    - `materializeBestVersion(preferred?: string)` - Materialize best available version
    - `listDbVersions()` - List all available versions in database
  - Centralized caching in `~/.cache/n8n-nodes/catalog.sqlite`
  - Read-only database access by default for security

#### Build Tooling
- **Database Build Script** (`scripts/build-nodes-db.js`)
  - Populates SQLite catalog from source node definitions
  - `npm run build:nodes-db` - Build database from source
  - `npm run rebuild:nodes-db` - Full rebuild of database

#### Modular MCP Tool Architecture
- **Tool Registry System** (`src/mcp/toolRegistry.ts`)
  - Centralized tool registration via `registerCoreTools(server)`
  - Standardized tool interface: `toolName`, `description`, `paramsSchema`, `handler`
- **14 Modular Tools** (`src/mcp/tools/`)
  - Extracted from monolithic `src/index.ts` into discrete modules:
    - `createWorkflow.ts`
    - `listWorkflows.ts`
    - `getWorkflowDetails.ts`
    - `addNode.ts`
    - `editNode.ts`
    - `deleteNode.ts`
    - `addConnection.ts`
    - `addAiConnections.ts`
    - `composeAiWorkflow.ts`
    - `connectMainChain.ts`
    - `listAvailableNodes.ts`
    - `listTemplateExamples.ts`
    - `getN8nVersionInfo.ts`
    - `validateWorkflow.ts`
- **Standardized Response Helpers** (`src/mcp/responses.ts`)
  - `toTextContent(payload: unknown)` - Convert payload to MCP text content
  - `ok(data)` - Create success response
  - `fail(message, details?)` - Create error response with details

#### Enhanced Workflow Validation
- **Improved Validation** (`src/validation/workflowValidator.ts`)
  - Added `visibilityRulesNormalized` support for conditional field visibility
  - Enhanced start node detection (prefers `chatTrigger`, then `webhook`, then any trigger)
  - Better required parameter detection respecting display conditions
  - New helper: `collectMissingParameters()` for structured error reporting
- **Node Types Loader** (`src/validation/nodeTypesLoader.ts`)
  - Improved node type loading and validation

#### Testing Infrastructure
- **Jest Configuration** (`jest.config.js`)
  - Added Jest with TypeScript support via `ts-jest`
  - Comprehensive test suite with 29+ unit tests
- **New Test Suites**
  - `tests/unit/ai-embeddings-key-shape.test.js` - Validates AI embedding node structure
  - `tests/unit/list-available-nodes-fields.test.js` - Tests node search/discovery
  - `tests/unit/mcp-logger.test.js` - Logging infrastructure tests (454 lines)
  - `tests/unit/path-security.test.js` - Security validation tests (304 lines)
  - `tests/unit/validate-start-node-webhook.test.js` - Webhook trigger validation
  - `tests/unit/visibility-rules-normalized.test.js` - Conditional field logic tests
- **Test Fixtures** (`workflow_data/`)
  - Added example workflows for integration testing

#### Documentation
- **Best Practices Guide** (`docs/mcp-server-tools-best-practices-2025.md`)
  - Tool design patterns (schemas, idempotency, composability)
  - Execution patterns (streaming, pagination, async jobs)
  - Safety & governance (auth, sandboxing, redaction)
  - Observability (structured logs, metrics, traces)
  - Error taxonomy & versioning guidelines
- **Refactor Roadmap** (`docs/refactor-next-steps.md`)
  - Status tracking for completed and remaining refactor tasks
  - Architecture migration documentation

#### Constants & Utilities
- **Constants Module** (`src/utils/constants.ts`)
  - Centralized constants propagation throughout codebase

### 🔄 Changed

- **Code Organization**
  - Decomposed monolithic `src/index.ts` into modular tool architecture
  - Improved separation of concerns with dedicated modules for tools, validation, and utilities
- **Node Materialization**
  - Changed from static file shipping to on-demand materialization from database
  - Reduced repository size by ~57,000 files
  - Dynamic version support without shipping all version files
- **Performance Improvements**
  - Faster node lookups via indexed database queries vs filesystem scanning
  - Better caching strategy with centralized SQLite database
  - Skip re-materialization if existing version has sufficient nodes

### 🗑️ Removed

- **Static Node Files**
  - Removed `workflow_nodes/1.100.0/` directory (~57,000 JSON files)
  - Replaced with database-backed materialization system
- **Legacy Configuration Files**
  - Removed `.cursor/rules/` - Cursor-specific rules
  - Removed `.roo/rules/` - Roo assistant rules
  - Removed `.windsurfrules`, `.roomodes`, `.taskmasterconfig` - Legacy configs
- **Build Artifacts**
  - Removed `dist/` from version control (generated on build)
- **Legacy Test Files**
  - Removed `tests/auth.test.js`
  - Removed `tests/authorize.test.js`
  - Removed `tests/unit/n8nIntegration.test.js`

### 🔒 Security

- **Path Security**
  - Added comprehensive path traversal protection tests
  - SQLite database opened in read-only mode by default
- **Input Validation**
  - Enhanced parameter validation with Zod schemas
  - Improved visibility rules evaluation

### 📦 Dependencies

#### Added
- `better-sqlite3@^9.6.0` - SQLite database engine
- `@types/better-sqlite3@^7.6.13` - TypeScript types for better-sqlite3
- `@jest/globals@^30.0.5` - Jest testing framework
- `ts-jest@^29.4.1` - TypeScript support for Jest
- `ts-node@^10.9.2` - TypeScript execution for Node.js

### 🐛 Fixed

- Improved error handling in node materialization
- Enhanced workflow validation with better visibility rules support
- Fixed start node detection logic
- Improved required parameter detection

### 📝 Migration Guide

#### For Existing Users

1. **Database Initialization**
   ```bash
   npm install
   npm run build:nodes-db
   ```
   This will create `~/.cache/n8n-nodes/catalog.sqlite` from source definitions.

2. **Update Configuration**
   - No changes required to `.cursor/mcp.json` configuration
   - The server will automatically materialize node definitions on first use

3. **Cache Location**
   - Node definitions are now cached at `~/.cache/n8n-nodes/catalog.sqlite`
   - Old `workflow_nodes/` directory in repository is no longer used

#### For Developers

- Run `npm run build:nodes-db` after cloning to populate the database
- Use `npm run rebuild:nodes-db` for full database rebuild
- Database is automatically materialized on first server start if not present

### 🔍 Known Issues

- Database initialization requires source node definitions (see Migration Guide)
- First materialization may take time depending on number of nodes
- Consider adding telemetry for materialization performance (future enhancement)

---

## [0.1.8] - Previous Release

Previous version before major refactor. See git history for details.


