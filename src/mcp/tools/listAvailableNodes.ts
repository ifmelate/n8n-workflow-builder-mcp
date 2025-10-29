import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { ToolNames } from '../../utils/constants';
import { createSuccessResponse, createErrorResponse } from '../../utils/responses';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentN8nVersion, getSupportedN8nVersions } from '../../nodes/versioning';
import { getNodeInfoCache } from '../../nodes/cache';
import { getWorkspaceDir, WORKFLOWS_FILE_NAME } from '../../utils/workspace';
import { materializeBestVersion } from '../../utils/nodesDb';

export const toolName = ToolNames.list_available_nodes;

export const paramsSchema = z.object({
    search_term: z.string().optional().describe("Filter by name, type, or description. For LangChain nodes, try 'langchain', roles like 'agent', 'lmChat'/'llm', 'tool', 'memory', or provider names such as 'qdrant', 'weaviate', 'milvus', 'openai', 'anthropic'."),
    n8n_version: z.string().optional().describe("Filter nodes by N8N version compatibility. If not provided, uses current configured N8N version."),
    limit: z.number().int().positive().max(1000).optional().describe("Maximum number of nodes to return"),
    cursor: z.string().optional().describe("Opaque cursor for pagination; pass back to get the next page"),
    // Enable smart tag-style matching (e.g., 'llm' → 'lmChat', provider names)
    tags: z.boolean().optional().describe("Enable tag-style synonym search (e.g., 'llm' → 'lmChat', providers). Defaults to true."),
    // How to combine multiple search terms: 'and' requires all tokens, 'or' matches any
    token_logic: z.enum(['and', 'or']).optional().describe("When multiple terms are provided, require all terms ('and') or any ('or'). Defaults to 'or'.")
});

export type Params = z.infer<typeof paramsSchema>;

export async function handler(params: Params, _extra: any) {
    const correlationId = uuidv4();
    console.error(`[${correlationId}] list_available_nodes called with params:`, params);
    let availableNodes: any[] = [];

    // Root directory that contains either JSON files or versioned subdirectories
    // When compiled, this file lives in dist, so workflow_nodes is one level up
    const workflowNodesRootDir = path.resolve(__dirname, '../../../workflow_nodes');
    // We'll compute an "effective" version to use both for reading files and filtering
    let effectiveVersion: string | undefined = params.n8n_version || getCurrentN8nVersion() || undefined;
    const hasExplicitVersion = !!params.n8n_version && params.n8n_version.trim() !== '';

    try {
        // knownNodeBaseCasings should ideally be populated at startup by loadKnownNodeBaseTypes.
        // If it's empty here, it means initial load failed or directory wasn't found then.
        // We might not need to reload it here if startup handles it, but a check doesn't hurt.
        if (getNodeInfoCache().size === 0 && getWorkspaceDir() !== process.cwd()) {
            console.warn("[WARN] nodeInfoCache is empty in list_available_nodes. Attempting to reload node type information.");
            // For now, if cache is empty, it means startup failed to load them.
            // The function will proceed and likely return an empty list or whatever it finds if workflowNodesDir is accessible now.
        }

        // Materialize requested/best version first
        try {
            const preferred = params.n8n_version || getCurrentN8nVersion() || undefined;
            const out = await materializeBestVersion(preferred);
            if (out?.ok && out.version) effectiveVersion = out.version;
        } catch { }

        // Determine if we have versioned subdirectories and pick the exact version directory when available
        let workflowNodesDir = workflowNodesRootDir;
        try {
            const entries = await fs.readdir(workflowNodesRootDir, { withFileTypes: true });
            const versionDirs = entries.filter(e => (e as any).isDirectory?.() === true).map(e => (e as any).name);
            if (versionDirs.length > 0) {
                const parse = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
                versionDirs.sort((a, b) => {
                    const [a0, a1, a2] = parse(a);
                    const [b0, b1, b2] = parse(b);
                    if (a0 !== b0) return b0 - a0;
                    if (a1 !== b1) return b1 - a1;
                    return b2 - a2;
                });
                const preferred = params.n8n_version || getCurrentN8nVersion();
                let candidate = preferred && versionDirs.includes(preferred) ? preferred : versionDirs[0];
                // choose first dir that actually has json files
                let chosen: string | null = null;
                for (const v of [candidate, ...versionDirs.filter(v => v !== candidate)]) {
                    try {
                        const files = await fs.readdir(path.join(workflowNodesRootDir, v));
                        if (files.some(f => f.endsWith('.json'))) { chosen = v; break; }
                    } catch { }
                }
                workflowNodesDir = path.join(workflowNodesRootDir, chosen || candidate);
                effectiveVersion = chosen || candidate;
            }
        } catch {
            // fall back to root
        }

        console.error(`[DEBUG] Reading node definitions from: ${workflowNodesDir}`);
        const files = await fs.readdir(workflowNodesDir);
        const suffix = ".json";
        const allParsedNodes: any[] = []; // Temporary array to hold all nodes before filtering

        for (const file of files) {
            if (file.endsWith(suffix) && file !== WORKFLOWS_FILE_NAME /* ignore old combined file */) {
                const filePath = path.join(workflowNodesDir, file);
                try {
                    const fileContent = await fs.readFile(filePath, 'utf8');
                    const nodeDefinition = JSON.parse(fileContent);

                    if (nodeDefinition.nodeType && nodeDefinition.displayName && nodeDefinition.properties) {
                        // Normalize version(s) to numbers to avoid type mismatches during compatibility checks
                        const rawVersion = nodeDefinition.version ?? 1;
                        const normalizedVersion = Array.isArray(rawVersion)
                            ? rawVersion
                                .map((v: any) => typeof v === 'number' ? v : parseFloat(String(v)))
                                .filter((v: number) => !Number.isNaN(v))
                            : (typeof rawVersion === 'number' ? rawVersion : parseFloat(String(rawVersion)));

                        allParsedNodes.push({
                            nodeType: nodeDefinition.nodeType,
                            displayName: nodeDefinition.displayName,
                            description: nodeDefinition.description || "",
                            version: normalizedVersion,
                            properties: nodeDefinition.properties,
                            credentialsConfig: nodeDefinition.credentialsConfig || [],
                            categories: nodeDefinition.categories || [],
                            usageExamples: Array.isArray(nodeDefinition.usageExamples) ? nodeDefinition.usageExamples : [],
                            io: nodeDefinition.io || {},
                            wiring: nodeDefinition.wiring || {},
                            // Also add simplified versions of the node type for reference
                            simpleName: nodeDefinition.nodeType.includes('n8n-nodes-base.')
                                ? nodeDefinition.nodeType.split('n8n-nodes-base.')[1]
                                : nodeDefinition.nodeType
                        });
                    } else {
                        console.warn(`[WARN] File ${file} does not seem to be a valid node definition. Skipping.`);
                    }
                } catch (parseError: any) {
                    console.warn(`[WARN] Failed to parse ${file}: ${parseError.message}. Skipping.`);
                }
            }
        }

        if (params.search_term && params.search_term.trim() !== "") {
            // Tokenized and tag-aware search (supports multi-word like "webhook trigger")
            const raw = params.search_term.trim().toLowerCase();
            const baseTokens = raw.split(/[\s,]+/).filter(Boolean);
            const useTags = params.tags !== false; // default true
            const tokenLogic = params.token_logic === 'and' ? 'and' : 'or';

            // Known synonym tags to expand common queries
            const synonymMap: Record<string, string[]> = {
                llm: ['lmchat', 'language', 'model', 'chat', 'openai', 'anthropic', 'mistral', 'groq', 'xai', 'vertex', 'gpt'],
                agent: ['tools', 'tool', 'actions'],
                tool: ['tools', 'agent'],
                memory: ['buffer', 'vector', 'memory'],
                vector: ['qdrant', 'weaviate', 'milvus', 'pinecone', 'pgvector', 'chromadb', 'faiss'],
                embedding: ['embed', 'embeddings'],
                webhook: ['trigger', 'http'],
                trigger: ['start', 'webhook']
            };

            const expandedTokensSet = new Set<string>(baseTokens);
            if (useTags) {
                for (const t of baseTokens) {
                    if (synonymMap[t]) {
                        for (const syn of synonymMap[t]) expandedTokensSet.add(syn);
                    }
                }
            }

            const expandedTokens = Array.from(expandedTokensSet);

            availableNodes = allParsedNodes.filter(node => {
                const parts: string[] = [];
                if (node.displayName) parts.push(String(node.displayName));
                if (node.nodeType) parts.push(String(node.nodeType));
                if (node.description) parts.push(String(node.description));
                if (node.simpleName) parts.push(String(node.simpleName));
                if (node.categories && Array.isArray(node.categories)) parts.push(...node.categories.map((c: any) => String(c)));
                if (node.properties && Array.isArray(node.properties)) {
                    for (const prop of node.properties) {
                        if (prop?.name) parts.push(String(prop.name));
                        if (prop?.displayName) parts.push(String(prop.displayName));
                        if (prop?.options && Array.isArray(prop.options)) {
                            for (const opt of prop.options) {
                                if (opt?.name) parts.push(String(opt.name));
                                if (opt?.value) parts.push(String(opt.value));
                            }
                        }
                    }
                }

                const searchableText = parts.join(' ').toLowerCase();
                if (expandedTokens.length === 0) return true;
                if (tokenLogic === 'or') {
                    return expandedTokens.some(t => searchableText.includes(t));
                }
                // Default AND logic
                return expandedTokens.every(t => searchableText.includes(t));
            });
            console.log(`[DEBUG] Filtered nodes by '${params.search_term}' (tags=${useTags}, logic=${tokenLogic}). Found ${availableNodes.length} of ${allParsedNodes.length}.`);
        } else {
            availableNodes = allParsedNodes; // No search term, return all nodes
        }

        // Note: diagnostic logging intentionally omitted to avoid test environment teardown issues

        if (availableNodes.length === 0 && allParsedNodes.length > 0 && params.search_term) {
            console.warn(`[WARN] No nodes matched the search term: '${params.search_term}'.`);
        } else if (allParsedNodes.length === 0) {
            console.warn("[WARN] No node definitions found in workflow_nodes. Ensure the directory is populated with JSON files from the scraper.");
        }

        // Filter by N8N version compatibility if specified
        const targetVersion = effectiveVersion || undefined;
        let versionFilteredNodes = availableNodes;

        if (targetVersion && targetVersion !== 'latest') {
            versionFilteredNodes = availableNodes.filter(node => {
                // Check if node is supported in the target N8N version
                const targetVersionInfo = getSupportedN8nVersions().get(targetVersion);
                if (!targetVersionInfo) {
                    // If target version info isn't loaded yet, don't over-filter
                    return true;
                }

                const supportedVersions = targetVersionInfo.supportedNodes.get(node.nodeType);
                if (!supportedVersions) {
                    // If specific node type not present, assume supported to avoid false negatives
                    return true;
                }

                // Check if any of the node's versions are supported
                const nodeVersionsRaw = Array.isArray(node.version) ? node.version : [node.version];
                const nodeVersions = nodeVersionsRaw
                    .map((v: any) => typeof v === 'number' ? v : parseFloat(String(v)))
                    .filter((v: number) => !Number.isNaN(v));
                return nodeVersions.some((v: number) => supportedVersions.has(v));
            });

            console.error(`[DEBUG] Filtered ${availableNodes.length} nodes to ${versionFilteredNodes.length} compatible with N8N ${targetVersion}`);
        }

        // Format the results to be more user-friendly and informative
        const formattedNodes = versionFilteredNodes.map(node => {
            const targetVersionInfo = getSupportedN8nVersions().get(targetVersion || getCurrentN8nVersion() || "1.108.0");
            const supportedVersions = targetVersionInfo?.supportedNodes.get(node.nodeType);
            const compatibleVersions = supportedVersions ? Array.from(supportedVersions) : [];

            return {
                // Keep only the most relevant information
                nodeType: node.nodeType, // Full node type with correct casing
                displayName: node.displayName,
                description: node.description,
                simpleName: node.simpleName, // The part after n8n-nodes-base
                categories: node.categories || [],
                version: node.version,
                compatibleVersions: compatibleVersions.length > 0 ? compatibleVersions : [node.version],
                role: (node.wiring && (node.wiring as any).role) || undefined,
                ioSummary: (() => {
                    try {
                        const inputs = Array.isArray((node.io as any)?.inputs) ? (node.io as any).inputs.length : 0;
                        const outputs = Array.isArray((node.io as any)?.outputs) ? (node.io as any).outputs.length : 0;
                        return { inputs, outputs };
                    } catch { return undefined; }
                })(),
                // Count parameters but don't include details to keep response size manageable
                parameterCount: node.properties ? node.properties.length : 0,
                // Provide a small, safe preview of properties by default
                propertiesPreview: (() => {
                    try {
                        const props = Array.isArray(node.properties) ? node.properties : [];
                        const MAX_PROPS = 5;
                        return props.slice(0, MAX_PROPS).map((p: any) => {
                            const optionValues = Array.isArray(p?.options)
                                ? p.options
                                    .slice(0, 5)
                                    .map((o: any) => (o?.value ?? o?.name))
                                    .filter((v: any) => v !== undefined)
                                : undefined;
                            const preview: any = {
                                name: p?.name ?? p?.displayName,
                                displayName: p?.displayName ?? p?.name,
                                type: p?.type ?? (Array.isArray(p?.options) ? 'options' : undefined)
                            };
                            if (typeof p?.default !== 'undefined') preview.default = p.default;
                            if (p?.required === true) preview.required = true;
                            if (optionValues && optionValues.length) preview.optionValues = optionValues;
                            return preview;
                        });
                    } catch {
                        return [] as any[];
                    }
                })(),
                usageExamplesPreview: (() => {
                    try {
                        const examples = Array.isArray(node.usageExamples) ? node.usageExamples : [];
                        const MAX = 3;
                        const names = examples.slice(0, MAX).map((ex: any) => String(ex?.name || '')).filter(Boolean);
                        return { count: examples.length, names };
                    } catch { return { count: 0, names: [] as string[] }; }
                })()
            };
        });

        // Ranking boost: prioritize the core Webhook node at the top of results when present
        // This reflects common usage in n8n where the Webhook node is frequently the starting trigger
        const orderedNodes = (() => {
            // Work on a shallow copy to avoid mutating the base array
            const copy = formattedNodes.slice();
            const isWebhookNode = (n: any) => {
                const dn = String(n?.displayName || '').toLowerCase();
                const sn = String(n?.simpleName || '').toLowerCase();
                const nt = String(n?.nodeType || '').toLowerCase();
                return dn === 'webhook' || sn === 'webhook' || nt.endsWith('.webhook');
            };

            const webhookIndex = copy.findIndex(isWebhookNode);
            if (webhookIndex > 0) {
                const [webhookNode] = copy.splice(webhookIndex, 1);
                copy.unshift(webhookNode);
            }

            return copy;
        })();

        // Include usage guidance in the response
        // usage guidance moved to rules; keep formattedNodes only

        // Apply pagination
        const startIndex = params?.cursor ? Number(params.cursor) || 0 : 0;
        const limit = params?.limit ?? orderedNodes.length;
        const page = orderedNodes.slice(startIndex, startIndex + limit);
        const nextIndex = startIndex + limit;
        const nextCursor = nextIndex < orderedNodes.length ? String(nextIndex) : null;

        // Return backward-compatible shape expected by tests (top-level nodes)
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    success: true,
                    nodes: page,
                    total: orderedNodes.length,
                    nextCursor,
                    filteredFor: targetVersion ? `N8N ${targetVersion}` : 'All versions',
                    currentN8nVersion: targetVersion || getCurrentN8nVersion(),
                    correlationId
                })
            }]
        };

    } catch (error: any) {
        console.error("[ERROR] Failed to list available nodes:", error);
        if (error.code === 'ENOENT') {
            console.warn("[WARN] workflow_nodes directory not found. Cannot list available nodes.");
            return createSuccessResponse({ nodes: [], message: 'workflow_nodes directory not found.' }, { correlationId });
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: 'Failed to list available nodes: ' + error.message }) }] };
    }
}
