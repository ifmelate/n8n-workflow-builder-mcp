import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { ToolNames, ErrorCodes } from '../../utils/constants';
import { resolveWorkflowPath, tryDetectWorkspaceForName } from '../../utils/workspace';
import { validateAndNormalizeWorkflow } from '../../validation/workflowValidator';
import { loadNodeTypesForCurrentVersion } from '../../validation/nodeTypesLoader';
import { getCurrentN8nVersion } from '../../nodes/versioning';
import { createSuccessResponse, createErrorResponse, createConnectionSuggestion, createAiConnectionsSuggestion } from '../../utils/responses';
import { v4 as uuidv4 } from 'uuid';

export const toolName = ToolNames.validate_workflow;

export const paramsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow to validate"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file"),
    strict_main_chain: z.boolean().optional().default(true).describe("When true, requires all nodes to be reachable via main connections. When false, accepts AI-attached reachability."),
    dry_run: z.boolean().optional().default(false).describe("If true, returns validation results without side effects")
});

export type Params = z.infer<typeof paramsSchema>;

export async function handler(params: Params, _extra: any) {
    const correlationId = uuidv4();
    console.error(`[${correlationId}] validate_workflow called with:`, Object.keys(params));

    try {
        let filePath = resolveWorkflowPath(params.workflow_name, params.workflow_path);
        try {
            if (!params.workflow_path) {
                await fs.access(filePath).catch(async () => {
                    const detected = await tryDetectWorkspaceForName(params.workflow_name);
                    if (detected) filePath = detected;
                });
            }
        } catch { }
        const raw = await fs.readFile(filePath, 'utf8');
        const workflow = JSON.parse(raw);
        const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../../../workflow_nodes'), getCurrentN8nVersion());
        const report = validateAndNormalizeWorkflow(workflow, nodeTypes);

        // For validate_workflow tool, treat warnings as errors (with targeted exceptions)
        const allErrors = [...report.errors];

        // Convert warnings to errors for this tool, but skip:
        // 1) Benign trigger-specific AI port warnings (chatTrigger)
        // 2) Vector Store missing AiDocument when the store is used only as a retrieval tool (has ai_vectorStore output)
        const normalized = report.normalized || { nodes: {}, connectionsBySource: {}, connectionsByDestination: {} } as any;
        const connectionsBySource: Record<string, any> = normalized.connectionsBySource || {};

        if (report.warnings.length > 0) {
            for (const warning of report.warnings) {
                const warnType = String((warning as any)?.details?.type || '').toLowerCase();
                const isTriggerAiPortWarning = warning.code === 'ai_node_without_ai_ports' && warnType.includes('chattrigger');
                if (isTriggerAiPortWarning) continue;

                // Skip VectorStore AiDocument requirement when it's wired as a tool
                const nodeName = (warning as any)?.nodeName as string | undefined;
                const inputName = String((warning as any)?.details?.input || '').toLowerCase();
                const isMissingRequiredInput = warning.code === 'missing_required_input';
                const looksLikeVectorStore = nodeName ? String((normalized.nodes?.[nodeName]?.type || '')).toLowerCase().includes('vectorstore') : false;
                const hasVectorToolOutput = nodeName ? Array.isArray(connectionsBySource[nodeName]?.ai_vectorStore) && (connectionsBySource[nodeName]?.ai_vectorStore || []).some((g: any[]) => Array.isArray(g) && g.some((c) => !!c)) : false;
                const isAiDocument = inputName === 'aidocument'.toLowerCase();
                const skipVectorStoreDoc = isMissingRequiredInput && looksLikeVectorStore && isAiDocument && hasVectorToolOutput;
                if (skipVectorStoreDoc) continue;

                allErrors.push({
                    code: warning.code,
                    message: warning.message,
                    nodeName: warning.nodeName,
                    details: warning.details
                });
            }
        }

        // Additional validation ONLY for validate_workflow tool:
        // Ensure every enabled node is connected to the main workflow chain
        try {
            const normalized = report.normalized || { nodes: {}, connectionsBySource: {}, connectionsByDestination: {} } as any;
            const nodesByName: Record<string, any> = normalized.nodes || {};
            const connectionsBySource: Record<string, any> = normalized.connectionsBySource || {};
            const startNode = report.startNode;

            // Detect legacy IF branching shape where connections use top-level "true"/"false" keys
            // instead of encoding both branches as outputs on the "main" connection array.
            // This commonly causes many downstream nodes to be flagged as not in the main chain.
            const legacyBranchNodes: Array<{ name: string; hasBoolean: boolean; numericKeys: string[] }> = [];
            try {
                for (const [src, byType] of Object.entries(connectionsBySource)) {
                    const keys = Object.keys(byType || {});
                    const hasBoolean = keys.includes('true') || keys.includes('false');
                    const numericKeys = keys.filter((k) => /^\d+$/.test(k));
                    if (hasBoolean || numericKeys.length > 0) legacyBranchNodes.push({ name: src, hasBoolean, numericKeys });
                }
            } catch { /* best-effort detection only */ }

            if (startNode) {
                // Build adjacency for 'main' edges (forward only)
                // Be lenient for legacy IF shapes: treat 'true'/'false' keys as main-like for reachability
                const mainNeighbors: Record<string, Set<string>> = {};
                const getMainLikeGroups = (byType: any): Array<Array<any>> => {
                    const groupsMain = (byType || {}).main || [];
                    if (Array.isArray(groupsMain) && groupsMain.length > 0) return groupsMain as Array<Array<any>>;
                    const tfTrue = Array.isArray((byType || {}).true) ? (byType || {}).true : [];
                    const tfFalse = Array.isArray((byType || {}).false) ? (byType || {}).false : [];
                    if (tfTrue.length > 0 || tfFalse.length > 0) return [...tfTrue, ...tfFalse] as Array<Array<any>>;
                    // Handle numeric switch outputs: '0','1','2',...
                    const numericKeys = Object.keys(byType || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b));
                    if (numericKeys.length > 0) {
                        const out: Array<Array<any>> = [];
                        for (const k of numericKeys) {
                            const arr = (byType || {})[k];
                            if (Array.isArray(arr)) out.push(...arr);
                        }
                        return out;
                    }
                    return [];
                };
                for (const [src, byType] of Object.entries(connectionsBySource)) {
                    const groups = getMainLikeGroups(byType);
                    for (const group of groups || []) {
                        for (const conn of group || []) {
                            if (!conn) continue;
                            if (!mainNeighbors[src]) mainNeighbors[src] = new Set<string>();
                            mainNeighbors[src]!.add(conn.node as string);
                        }
                    }
                }

                // BFS from start via 'main' edges
                const reachableMain = new Set<string>();
                const queue: string[] = [];
                reachableMain.add(startNode);
                queue.push(startNode);
                while (queue.length > 0) {
                    const cur = queue.shift()!;
                    const neigh = Array.from(mainNeighbors[cur] || []);
                    for (const n of neigh) {
                        if (!reachableMain.has(n)) {
                            reachableMain.add(n);
                            queue.push(n);
                        }
                    }
                }

                // Build undirected adjacency for all types to include attached AI/model/tool/memory nodes
                const allNeighbors: Record<string, Set<string>> = {};
                const addUndirected = (a: string, b: string) => {
                    if (!allNeighbors[a]) allNeighbors[a] = new Set<string>();
                    if (!allNeighbors[b]) allNeighbors[b] = new Set<string>();
                    allNeighbors[a]!.add(b);
                    allNeighbors[b]!.add(a);
                };
                for (const [src, byType] of Object.entries(connectionsBySource)) {
                    for (const groups of Object.values(byType || {})) {
                        for (const group of (groups as any) || []) {
                            for (const conn of group || []) {
                                if (!conn) continue;
                                addUndirected(src, conn.node as string);
                            }
                        }
                    }
                }

                // Expand from reachableMain using undirected edges to include attached non-main neighbors
                const reachableExtended = new Set<string>(reachableMain);
                const q2: string[] = Array.from(reachableMain);
                while (q2.length > 0) {
                    const cur = q2.shift()!;
                    const neigh = Array.from(allNeighbors[cur] || []);
                    for (const n of neigh) {
                        if (!reachableExtended.has(n)) {
                            reachableExtended.add(n);
                            q2.push(n);
                        }
                    }
                }

                // Always strict now; multiple chains are not allowed
                const strictMainOnly = true;
                const targetSet = strictMainOnly ? reachableMain : reachableExtended;

                // Any enabled node not in targetSet is disconnected from main chain → error
                for (const [name, node] of Object.entries(nodesByName)) {
                    if ((node as any).disabled === true) continue;
                    if (!targetSet.has(name)) {
                        allErrors.push({
                            code: 'node_not_in_main_chain',
                            message: `Node "${name}" (ID: ${(node as any).id || 'unknown'}) is not connected to the main workflow chain starting at "${startNode}"`,
                            nodeName: name,
                            details: { nodeId: (node as any).id, type: (node as any).type }
                        });
                    }
                }

                // Emit a targeted, actionable error for each IF node using legacy boolean keys
                // to guide users toward using main[0] (true) and main[1] (false) plus proper Merge inputs.
                if (legacyBranchNodes.length > 0) {
                    for (const entry of legacyBranchNodes) {
                        const node = nodesByName[entry.name] || {};
                        const shapeKeys = Object.keys(connectionsBySource[entry.name] || {});
                        if (entry.hasBoolean && entry.numericKeys.length > 0) {
                            allErrors.push({
                                code: 'legacy_mixed_branch_shape',
                                message: `Node "${entry.name}" encodes branches under both 'true'/'false' and numeric keys (${entry.numericKeys.join(', ')}). Convert to 'main' outputs only: for IF use main[0]/main[1], for Switch use main[index].`,
                                nodeName: entry.name,
                                details: { nodeId: (node as any).id, type: (node as any).type, keys: shapeKeys }
                            });
                        } else if (entry.hasBoolean) {
                            allErrors.push({
                                code: 'legacy_if_branch_shape',
                                message: `Node "${entry.name}" encodes IF branches under 'true'/'false'. Use 'main' with two outputs (index 0 → true, index 1 → false). Ensure Merge nodes consume these via input indexes 0 and 1.`,
                                nodeName: entry.name,
                                details: { nodeId: (node as any).id, type: (node as any).type, keys: shapeKeys }
                            });
                        } else if (entry.numericKeys.length > 0) {
                            allErrors.push({
                                code: 'legacy_switch_branch_shape',
                                message: `Node "${entry.name}" encodes Switch branches under numeric keys (${entry.numericKeys.join(', ')}). Use 'main' with outputs where index corresponds to the case: main[0], main[1], ...`,
                                nodeName: entry.name,
                                details: { nodeId: (node as any).id, type: (node as any).type, keys: entry.numericKeys }
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[WARN] Connectivity validation errored in validate_workflow:', (e as any)?.message || e);
        }

        // Build actionable guidance to help users fix wiring instead of deleting nodes
        type SuggestedAction = {
            type: 'add_connection' | 'add_ai_connections' | 'check_configuration' | 'general_advice';
            title: string;
            params?: Record<string, unknown>;
            note?: string;
        };

        const suggestedActions: SuggestedAction[] = [];

        try {
            // Build helper indexes of nodes and produced/required types
            const normalized = report.normalized || { nodes: {}, connectionsBySource: {}, connectionsByDestination: {} };
            const nodesByName: Record<string, any> = normalized.nodes || {};
            const connectionsBySource: Record<string, any> = normalized.connectionsBySource || {};

            const getTypeDesc = (node: any) => node ? nodeTypes.getByNameAndVersion(node.type, node.typeVersion) : undefined;

            const producersByType: Record<string, Array<{ name: string; id?: string; }>> = {};
            for (const node of Object.values(nodesByName)) {
                const desc = getTypeDesc(node);
                const produces: string[] = (((desc as any)?.description?.wiring?.produces) || []) as string[];
                for (const t of produces) {
                    const key = String(t);
                    producersByType[key] = producersByType[key] || [];
                    producersByType[key].push({ name: node.name, id: node.id });
                }
            }

            const addConnectSuggestion = (opts: {
                fromName: string; fromId?: string; fromOutput: string;
                toName: string; toId?: string; toInput: string;
            }) => {
                suggestedActions.push({
                    type: 'add_connection',
                    title: `Connect ${opts.fromName} → ${opts.toName} via ${opts.toInput}`,
                    params: {
                        workflow_name: params.workflow_name,
                        source_node_id: opts.fromId || '<SOURCE_NODE_ID>',
                        source_node_output_name: opts.fromOutput,
                        target_node_id: opts.toId || '<TARGET_NODE_ID>',
                        target_node_input_name: opts.toInput,
                        target_node_input_index: 0
                    }
                });
            };

            const addAgentWireSuggestion = (agent: any, model?: any, tools?: any[], memory?: any) => {
                suggestedActions.push({
                    type: 'add_ai_connections',
                    title: `Wire AI nodes to agent ${agent?.name}`,
                    params: {
                        workflow_name: params.workflow_name,
                        agent_node_id: agent?.id || '<AGENT_ID>',
                        model_node_id: model?.id,
                        tool_node_ids: (tools || []).map(t => t.id),
                        memory_node_id: memory?.id
                    },
                    note: 'Models → ai_languageModel, Tools → ai_tool, Memory → ai_memory'
                });
            };

            // Walk through promoted warnings to craft targeted suggestions
            for (const issue of [...report.warnings]) {
                if (!issue || !issue.code) continue;
                const node = issue.nodeName ? nodesByName[issue.nodeName] : undefined;
                const desc = getTypeDesc(node);
                const role = (desc as any)?.description?.wiring?.role as string | undefined;

                if (issue.code === 'unconnected_node' && node) {
                    if (role === 'vectorStore') {
                        // Suggest connecting AiDocument (required) and AiEmbedding (optional)
                        const docProducers = producersByType['AiDocument'] || [];
                        if (docProducers.length > 0) {
                            const from = docProducers[0];
                            addConnectSuggestion({
                                fromName: from.name, fromId: from.id, fromOutput: 'AiDocument',
                                toName: node.name, toId: node.id, toInput: 'AiDocument'
                            });
                        }
                        const embProducers = producersByType['AiEmbedding'] || [];
                        if (embProducers.length > 0) {
                            const from = embProducers[0];
                            addConnectSuggestion({
                                fromName: from.name, fromId: from.id, fromOutput: 'AiEmbedding',
                                toName: node.name, toId: node.id, toInput: 'AiEmbedding'
                            });
                        }
                        suggestedActions.push({
                            type: 'check_configuration',
                            title: `Set Qdrant Vector Store mode`,
                            note: 'Use mode "retrieve-as-tool" to expose the store as an AI tool for the agent.'
                        });
                    } else if (role === 'agent') {
                        // Suggest wiring model/tools/memory to agent
                        addAgentWireSuggestion(node);
                    } else if (node?.type?.toLowerCase()?.includes('embeddings')) {
                        // Suggest connecting embeddings to a vector store
                        const vectorStores = Object.values(nodesByName).filter(n => ((getTypeDesc(n) as any)?.description?.wiring?.role) === 'vectorStore');
                        if (vectorStores.length > 0) {
                            const store = vectorStores[0];
                            addConnectSuggestion({
                                fromName: node.name, fromId: node.id, fromOutput: 'AiEmbedding',
                                toName: store.name, toId: store.id, toInput: 'AiEmbedding'
                            });
                        } else {
                            suggestedActions.push({
                                type: 'general_advice',
                                title: `Connect embeddings to a Vector Store`,
                                note: 'Add a vector store (e.g., Qdrant) and connect AiEmbedding → AiEmbedding.'
                            });
                        }
                    }
                }

                if (issue.code === 'ai_node_without_ai_ports' && node) {
                    // Likely an agent not wired via ai_* ports
                    addAgentWireSuggestion(node);
                }

                if (issue.code === 'missing_required_input' && node && (issue as any).details?.input) {
                    const req = String((issue as any).details.input);
                    // Try to find a producer for the required type
                    const candidates = producersByType[req] || [];
                    if (candidates.length > 0) {
                        const from = candidates[0];
                        // Special-case agent requirements to prefer add_ai_connections
                        if (((getTypeDesc(node) as any)?.description?.wiring?.role) === 'agent' && req.toLowerCase() === 'ailanguagemodel') {
                            addAgentWireSuggestion(node, { id: from.id, name: from.name });
                        } else {
                            addConnectSuggestion({
                                fromName: from.name, fromId: from.id, fromOutput: req,
                                toName: node.name, toId: node.id, toInput: req
                            });
                        }
                    }
                }
            }

            // Additional suggestion: if any node uses legacy IF boolean keys, add a general advice item
            try {
                for (const [src, byType] of Object.entries(connectionsBySource)) {
                    const keys = Object.keys(byType || {});
                    const hasBoolean = keys.includes('true') || keys.includes('false');
                    const numericKeys = keys.filter((k) => /^\d+$/.test(k));
                    if (hasBoolean && numericKeys.length > 0) {
                        suggestedActions.push({
                            type: 'general_advice',
                            title: `Convert mixed IF/Switch branches on "${src}" to main outputs`,
                            note: `Remove 'true'/'false' and numeric branch keys. Use a single 'main' outputs array: for IF use main[0] (true) and main[1] (false); for Switch map cases to main[index]. Merge inputs should match (0 ↔ input 0, 1 ↔ input 1).`
                        });
                    } else if (hasBoolean) {
                        suggestedActions.push({
                            type: 'general_advice',
                            title: `Convert IF branches on "${src}" to main outputs`,
                            note: `Replace top-level 'true'/'false' connection keys with 'main' outputs: main[0] → true, main[1] → false. When merging, wire one branch into Merge input index 0 and the other into index 1.`
                        });
                    } else if (numericKeys.length > 0) {
                        suggestedActions.push({
                            type: 'general_advice',
                            title: `Convert Switch branches on "${src}" to main outputs`,
                            note: `Replace numeric branch keys (${numericKeys.join(', ')}) with 'main' outputs array: main[0], main[1], ... in ascending order. Keep Merge inputs matched (0 ↔ input 0, 1 ↔ input 1).`
                        });
                    }
                }
            } catch { /* best-effort suggestions only */ }
        } catch (e) {
            console.warn('[WARN] Failed to compute remediation suggestions in validate_workflow:', (e as any)?.message || e);
        }

        // Workflow is only OK if there are no errors after promotion and connectivity checks
        const validationOk = allErrors.length === 0;

        const responseData = {
            validation: {
                ok: validationOk,
                errors: allErrors,
                warnings: report.warnings,
                startNode: report.startNode,
                originalWarningCount: report.warnings.length,
                note: report.warnings.length > 0 ? "Warnings have been promoted to errors for validation tool" : undefined,
                nodeIssues: report.nodeIssues
            },
            workflowPath: filePath,
            n8nVersion: getCurrentN8nVersion(),
            strictMainChain: params.strict_main_chain
        };

        const remainingIssues = allErrors.map(err => ({
            code: err.code,
            message: err.message,
            severity: 'error' as const,
            nodeName: err.nodeName,
            details: err.details
        }));

        if (validationOk) {
            return createSuccessResponse(responseData, {
                correlationId,
                suggestedActions: suggestedActions.length > 0 ? suggestedActions : undefined,
                version: getCurrentN8nVersion() || undefined
            });
        } else {
            return createErrorResponse(
                `Workflow validation failed with ${allErrors.length} error(s)`,
                {
                    code: ErrorCodes.VALIDATION_ERROR,
                    correlationId,
                    retryable: false,
                    remediation: "Fix the validation errors listed in suggestedActions",
                    details: responseData,
                    suggestedActions
                }
            );
        }
    } catch (error: any) {
        console.error(`[${correlationId}] Failed to validate workflow:`, error);
        return createErrorResponse(
            `Failed to validate workflow: ${error.message}`,
            {
                code: ErrorCodes.INTERNAL_SERVER_ERROR,
                correlationId,
                retryable: true,
                remediation: "Check workflow file existence and permissions, then retry"
            }
        );
    }
}
