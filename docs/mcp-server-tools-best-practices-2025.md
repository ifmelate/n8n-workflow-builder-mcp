## MCP Server Tools: 2025 Best Practices and Implementation Plan

### Overview
This document captures current (2025) best practices for building Model Context Protocol (MCP) servers/tools for LLM agents, and a concrete plan to evolve our `n8n-workflow-builder-mcp` server. It focuses on: schema design, execution patterns, safety/governance, observability, error taxonomy, versioning, UX for agents, and RAG/vector integration.

### Tool design
- **Capability discovery**: Publish rich tool metadata (`description`, `input_schema`, `output_schema`, `examples`). Prefer JSON Schema/OpenAPI semantics for types and enums.
- **Strict schemas**: Use deterministic types, explicit enums, and clear success/error result shapes.
- **Examples**: Provide canonical and edge-case examples (inputs, outputs, and error examples).
- **Idempotency**: Make mutating tools idempotent where safe; support `idempotency_key`.
- **Deterministic outputs**: Ensure identical inputs → identical outputs; annotate non-determinism (timestamps, random IDs).
- **Composability**: Keep tools stateless and modular with well-defined boundaries for easy chaining.

### Execution patterns
- **Streaming**: Offer SSE/WebSocket/HTTP chunking for long operations; stream partials with progress.
- **Partial results**: Return incremental payloads and a `job_id` for resumption/polling.
- **Pagination**: Standardize `cursor`/`limit` and return `next_cursor` and `total` when feasible.
- **Async jobs**: Provide job lifecycle (submit/status/result/cancel) for long-running tasks.
- **Retries/Cancellation**: Mark retryable conditions; accept client-side cancellation.

### Safety & governance
- **AuthN/Z**: Enforce strong auth; implement per-tool RBAC and resource-scoped permissions.
- **Least privilege**: Narrow credentials and tokens; rotate and audit regularly.
- **Sandboxing**: Isolate execution; restrict FS/network/egress by default.
- **Redaction**: Remove secrets/PII from logs and responses.
- **Egress/DLP**: Whitelist outbound hosts; monitor and enforce data policies.
- **Rate/budget limits**: Per-agent and per-tool quotas; expose usage/cost in responses.

### Observability
- **Structured logs**: JSON logs with `timestamp`, `tool`, `correlation_id`, `workflow_name`, and redacted payloads.
- **Metrics**: Counters and histograms (latency, error rate, created_nodes/edges, token and cost estimates).
- **Traces**: Propagate trace/correlation IDs through downstream calls.
- **Audit trails**: Append-only records of auth and tool actions with retention policies.

### Error taxonomy
- **Machine-readable**: `{ code, message, retryable, partial, remediation }` in every error.
- **Partial failures**: Return partial successes and identify failing sub-steps.
- **Actionable messages**: Always include next steps or a linkable doc anchor.

### Versioning & compatibility
- **Capability negotiation**: Advertise supported protocol/schema/features; negotiate on connect.
- **Deprecation**: Mark and warn in responses; document timelines and fallbacks.
- **Migrations**: Versioned schemas and dual-stack support; explicit `version` in payloads.

### UX for LLM agents
- **Concise descriptions**: Short, literal tool descriptions with explicit field meanings.
- **Helpful errors**: Causes + examples + remediation payloads (ready-to-call next tools).
- **Dry-run/simulate**: `dry_run: true` returns a diff without side effects.
- **Action plans**: Provide a plan/diff endpoint or include an ordered list of remedial tool calls.

### RAG/vector-tool integration
- **Consistent naming**: Use uniform ports/types (e.g., `ai_embedding`, `ai_document`, `ai_vectorStore`).
- **Validation**: Strictly validate input types, sizes, and search modes; fail fast with guidance.
- **Remediation**: Suggest concrete add_node/add_connection payloads when inputs are missing.

---

## n8n MCP server improvements (concrete)

### 1) Single source of truth for wiring
- Move all AI wiring into a shared module (e.g., `src/tools/wiringService.ts`).
- Make both `compose_ai_workflow` and `add_ai_connections` call this module.
- Remove duplicated logic in `src/index.ts` to prevent drift.
- Resolve ports via an internal mapping that mirrors `NodeConnectionTypes` (no string literals).

### 2) Compose is RAG-aware
- Add plan flags to `compose_ai_workflow`:
  - `include_document_loader: boolean`
  - `include_vector_insert: boolean`
  - `connect_main_chain: 'auto' | 'minimal' | 'off'` (default: `'minimal'`)
- If vector store is `retrieve-as-tool`, auto-add Vector QA Tool and wire:
  - model → tool (`ai_languageModel`), vector store → tool (`ai_vectorStore`), tool → agent (`ai_tool`).

### 3) Validation ergonomics
- `validate_workflow` params:
  - `strict_main_chain: boolean` (default `true`). When `false`, accept “AI-attached” reachability.
- Response includes:
  - `n8n_version`, resolved `workflow_path`.
  - `suggestedActions[]` with ready-to-call payloads for:
    - inserting a document loader and wiring `AiDocument`.
    - wiring agent’s model/memory/tools via a single `add_ai_connections` payload.
    - creating a minimal main path (ordered `add_connection` calls).

### 4) Auto-fix tools
- `connect_main_chain`: build a minimal `main` path from Trigger → Model → Memory → Embeddings → Doc Loader → Vector Store → Vector Tool → Agent.
- `fix_rag_warnings`: insert `Document Loader` + optional `Vector Insert` and wire `AiDocument` / `AiEmbedding`.

### 5) Idempotency & dedupe everywhere
- Deduplicate all AI edges (model/memory/tools/embeddings/vector store).
- Support `idempotency_key` on write endpoints; return `connectionsCreated` and `connectionsSkipped`.

### 6) Responses & errors
- Return structured objects (not JSON-strings) from all tools:
  - `{ success, correlation_id, changes[], remaining_issues[], suggestedActions[], version }`.
- Error objects include `{ code, retryable, remediation }` and example of correct usage.

### 7) Governance & observability
- Add per-tool scopes and rate limits; return budget/cost info in responses.
- Emit JSON logs with correlation IDs; expose metrics for latency, errors, node/edge diffs.

---

## Implementation checklist
- [ ] Create `src/tools/wiringService.ts`; refactor compose/add tools to use it.
- [ ] Delete/neutralize duplicate wiring in `src/index.ts`.
- [ ] Normalize port names through a single NodeConnectionTypes mapping.
- [ ] Add `dry_run` and `strict_main_chain` to tool param schemas; document behavior.
- [ ] Implement `connect_main_chain` and `fix_rag_warnings` tools.
- [ ] Enrich `validate_workflow` with `suggestedActions` that include ready-to-call payloads.
- [ ] Standardize tool outputs to structured JSON with `correlation_id`.
- [ ] Add dedupe and idempotency keys to all write paths; return created/skipped counts.
- [ ] Add per-tool RBAC, rate limits, and budget counters; include usage in responses.
- [ ] Add metrics and structured logs for all tools; wire correlation IDs end-to-end.

---

### References
- Ambassador: [MCP server explained](https://www.getambassador.io/blog/mcp-server-explained)
- Natoma: [Securing your LLM infrastructure (2025)](https://www.natoma.id/blog/securing-your-llm-infrastructure-best-practices-for-2025)
- Speakeasy: [Using MCP tools](https://www.speakeasy.com/mcp/using-mcp/using-tools)
- Tinybird: [Analytics agents best practices](https://www.tinybird.co/docs/forward/analytics-agents/best-practices)
- Zenity: [Model Context Protocol state](https://zenity.io/blog/current-events/model-context-protocol)





