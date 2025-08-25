#!/usr/bin/env node

// N8N Workflow Builder MCP Server
// Using the official MCP SDK as required

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { validateAndNormalizeWorkflow } from './validation/workflowValidator';
import { loadNodeTypesForCurrentVersion } from './validation/nodeTypesLoader';
import { Workflow, N8nWorkflow, N8nWorkflowNode, N8nConnections, N8nConnectionDetail } from './types/n8n';
import { ensureWorkflowDir, ensureWorkflowParentDir, resolvePath, resolveWorkflowPath, WORKFLOW_DATA_DIR_NAME, WORKFLOWS_FILE_NAME, setWorkspaceDir, getWorkspaceDir, tryDetectWorkspaceForName } from './utils/workspace';
import { generateInstanceId, generateN8nId, generateUUID } from './utils/id';
import { normalizeLLMParameters } from './utils/llm';
import { initializeN8nVersionSupport, detectN8nVersion, setN8nVersion, getSupportedN8nVersions, getCurrentN8nVersion, getN8nVersionInfo } from './nodes/versioning';
import { loadKnownNodeBaseTypes, normalizeNodeTypeAndVersion, isNodeTypeSupported, updateNodeCacheForVersion, getNodeInfoCache } from './nodes/cache';

// Log initial workspace
console.error(`[DEBUG] Default workspace directory: ${getWorkspaceDir()}`);

// Initialize supported N8N versions and their node capabilities
// Remove in-file type/interface/utility definitions in favor of imports

// Find the best matching version for a target N8N version
// Returns exact match if available, otherwise closest lower version
function findBestMatchingVersion(targetVersion: string, availableVersions: string[]): string | null {
    if (availableVersions.length === 0) {
        return null;
    }

    // Check for exact match first
    if (availableVersions.includes(targetVersion)) {
        return targetVersion;
    }

    // Parse version numbers for comparison
    const parseVersion = (version: string) => {
        const parts = version.split('.').map(part => parseInt(part, 10) || 0);
        // Ensure we have at least 3 parts (major.minor.patch)
        while (parts.length < 3) {
            parts.push(0);
        }
        return parts;
    };

    const targetParts = parseVersion(targetVersion);

    // Find all versions that are less than or equal to target version
    const candidateVersions = availableVersions.filter(version => {
        const versionParts = parseVersion(version);

        // Compare version parts (major.minor.patch)
        for (let i = 0; i < Math.max(targetParts.length, versionParts.length); i++) {
            const targetPart = targetParts[i] || 0;
            const versionPart = versionParts[i] || 0;

            if (versionPart < targetPart) {
                return true; // This version is lower
            } else if (versionPart > targetPart) {
                return false; // This version is higher
            }
            // If equal, continue to next part
        }

        return true; // Versions are equal (this shouldn't happen since we checked exact match above)
    });

    if (candidateVersions.length === 0) {
        return null; // No suitable lower version found
    }

    // Sort candidates in descending order and return the highest (closest to target)
    candidateVersions.sort((a, b) => {
        const aParts = parseVersion(a);
        const bParts = parseVersion(b);

        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aPart = aParts[i] || 0;
            const bPart = bParts[i] || 0;

            if (aPart !== bPart) {
                return bPart - aPart; // Descending order
            }
        }

        return 0;
    });

    return candidateVersions[0];
}

// Check if a node type is supported in current N8N version
// moved isNodeTypeSupported to nodes/cache

// Store for known node type casings (lowercase -> CorrectCase)
// let knownNodeBaseCasings: Map<string, string> = new Map(); // OLD MAP

interface CachedNodeInfo {
    officialType: string; // The correctly cased, full type string (e.g., "n8n-nodes-base.HttpRequest" or "@n8n/n8n-nodes-langchain.allowFileUploads")
    version: number | number[]; // The version information from the node's definition file
}
let nodeInfoCache: Map<string, CachedNodeInfo> = new Map();

// normalizeLLMParameters imported from utils/llm

// loadKnownNodeBaseTypes handled in nodes/cache

// Helper function to load nodes from a specific directory
// loadNodesFromDirectory handled in nodes/cache

// Helper function to normalize node types (OLD - to be replaced)
// function normalizeNodeType(inputType: string): string { ... } // OLD FUNCTION

// New function to get normalized type and version
// normalizeNodeTypeAndVersion handled in nodes/cache

// Helper function to resolve paths against workspace
// Always treat paths as relative to WORKSPACE_DIR by stripping leading slashes
// resolvePath handled in utils/workspace

// Helper function to resolve workflow file path with optional direct path
// resolveWorkflowPath handled in utils/workspace

// Helper function to ensure the parent directory exists for a workflow file path
// ensureWorkflowParentDir handled in utils/workspace

// ID Generation Helpers
// id helpers handled in utils/id

// Constants
// constants handled in utils/workspace

// Helper functions
// ensureWorkflowDir handled in utils/workspace

async function loadWorkflows(): Promise<Workflow[]> {
    // This function will need to be updated if list_workflows is to work with the new format.
    // For now, it's related to the old format.
    const resolvedFile = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, WORKFLOWS_FILE_NAME));
    try {
        await ensureWorkflowDir(); // Ensures dir exists, doesn't create workflows.json anymore unless called by old logic
        const data = await fs.readFile(resolvedFile, 'utf8');
        console.error("[DEBUG] Loaded workflows (old format):", data);
        return JSON.parse(data) as Workflow[];
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.error("[DEBUG] No workflows.json file found (old format), returning empty array");
            // If workflows.json is truly deprecated, this might try to create it.
            // For now, let's assume ensureWorkflowDir handles directory creation.
            // And if the file doesn't exist, it means no workflows (in old format).
            await fs.writeFile(resolvedFile, JSON.stringify([], null, 2)); // Create if not exists for old logic
            return [];
        }
        console.error('[ERROR] Failed to load workflows (old format):', error);
        throw error;
    }
}

async function saveWorkflows(workflows: Workflow[]): Promise<void> {
    // This function is for the old format (saving an array to workflows.json).
    try {
        await ensureWorkflowDir();
        const resolvedFile = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, WORKFLOWS_FILE_NAME));
        console.error("[DEBUG] Saving workflows (old format):", JSON.stringify(workflows, null, 2));
        await fs.writeFile(resolvedFile, JSON.stringify(workflows, null, 2));
    } catch (error) {
        console.error('[ERROR] Failed to save workflows (old format):', error);
        throw error;
    }
}

// Create the MCP server
const server = new McpServer({
    name: "n8n-workflow-builder",
    version: "1.0.0"
});

// Tool definitions

// Create Workflow
const createWorkflowParamsSchema = z.object({
    workflow_name: z.string().describe("The name for the new workflow"),
    workspace_dir: z.string().describe("Absolute path to the project root directory where workflow_data will be stored")
});
server.tool(
    "create_workflow",
    "Create a new n8n workflow",
    createWorkflowParamsSchema.shape,
    async (params: z.infer<typeof createWorkflowParamsSchema>, _extra: any) => {
        console.error("[DEBUG] create_workflow called with params:", params);
        const workflowName = params.workflow_name;
        const workspaceDir = params.workspace_dir;

        if (!workflowName || workflowName.trim() === "") {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Parameter 'workflow_name' is required." }) }] };
        }
        if (!workspaceDir || workspaceDir.trim() === "") {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Parameter 'workspace_dir' is required." }) }] };
        }

        try {
            const stat = await fs.stat(workspaceDir);
            if (!stat.isDirectory()) {
                return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Provided 'workspace_dir' is not a directory." }) }] };
            }

            // Check if the workspaceDir is the root directory
            if (path.resolve(workspaceDir) === path.resolve('/')) {
                console.error("[ERROR] 'workspace_dir' cannot be the root directory ('/'). Please specify a valid project subdirectory.");
                return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "'workspace_dir' cannot be the root directory. Please specify a project subdirectory." }) }] };
            }

            setWorkspaceDir(workspaceDir);
            await ensureWorkflowDir(); // Ensures WORKFLOW_DATA_DIR_NAME exists

            const newN8nWorkflow: N8nWorkflow = {
                name: workflowName,
                id: generateN8nId(), // e.g., "Y6sBMxxyJQtgCCBQ"
                nodes: [], // Initialize with empty nodes array
                connections: {}, // Initialize with empty connections object
                active: false,
                pinData: {},
                settings: {
                    executionOrder: "v1"
                },
                versionId: generateUUID(),
                meta: {
                    instanceId: generateInstanceId()
                },
                tags: []
            };

            // Sanitize workflowName for filename or ensure it's safe.
            // For now, using directly. Consider a sanitization function for production.
            const filename = `${workflowName.replace(/[^a-z0-9_.-]/gi, '_')}.json`;
            const filePath = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, filename));

            await fs.writeFile(filePath, JSON.stringify(newN8nWorkflow, null, 2));
            console.error("[DEBUG] Workflow created and saved to:", filePath);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, workflow: newN8nWorkflow, recommended_next_step: "Call 'list_available_nodes' before adding nodes. Use 'search_term' (e.g., 'langchain') to find AI nodes." }) }] };

        } catch (error: any) {
            console.error("[ERROR] Failed to create workflow:", error);
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to create workflow: " + error.message }) }] };
        }
    }
);

// List Workflows
// NOTE: This tool reads individual .json files from the workflow_data directory.
const listWorkflowsParamsSchema = z.object({
    limit: z.number().int().positive().max(1000).optional().describe("Maximum number of workflows to return"),
    cursor: z.string().optional().describe("Opaque cursor for pagination; pass back to get the next page")
});
server.tool(
    "list_workflows",
    "List workflows in the workspace",
    listWorkflowsParamsSchema.shape,
    async (params: z.infer<typeof listWorkflowsParamsSchema>, _extra: any) => {
        console.error("[DEBUG] list_workflows called - (current impl uses old format and might be broken)");
        try {
            // This implementation needs to change to scan directory for .json files
            // and aggregate them. For now, it will likely fail or return empty
            // if workflows.json doesn't exist or is empty.
            await ensureWorkflowDir(); // Ensures directory exists
            const workflowDataDir = resolvePath(WORKFLOW_DATA_DIR_NAME);
            const files = await fs.readdir(workflowDataDir);
            const workflowFiles = files.filter(file => file.endsWith('.json') && file !== WORKFLOWS_FILE_NAME);

            const workflows: N8nWorkflow[] = [];
            for (const file of workflowFiles) {
                try {
                    const data = await fs.readFile(path.join(workflowDataDir, file), 'utf8');
                    workflows.push(JSON.parse(data) as N8nWorkflow);
                } catch (err) {
                    console.error(`[ERROR] Failed to read or parse workflow file ${file}:`, err);
                    // Decide how to handle: skip, error out, etc.
                }
            }
            console.error(`[DEBUG] Retrieved ${workflows.length} workflows from individual files.`);
            // Apply simple offset cursor pagination
            const startIndex = params?.cursor ? Number(params.cursor) || 0 : 0;
            const limit = params?.limit ?? workflows.length;
            const page = workflows.slice(startIndex, startIndex + limit);
            const nextIndex = startIndex + limit;
            const nextCursor = nextIndex < workflows.length ? String(nextIndex) : null;

            return { content: [{ type: "text", text: JSON.stringify({ success: true, workflows: page, nextCursor, total: workflows.length }) }] };
        } catch (error: any) {
            console.error("[ERROR] Failed to list workflows:", error);
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to list workflows: " + error.message }) }] };
        }
    }
);

// Get Workflow Details
// NOTE: This tool will need to be updated. It currently assumes workflow_id is
// an ID found in the old workflows.json structure. It should now probably
// expect workflow_id to be the workflow name (to form the filename) or the new N8n ID.
const getWorkflowDetailsParamsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow to get details for"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});
server.tool(
    "get_workflow_details",
    "Get workflow details by name or path",
    getWorkflowDetailsParamsSchema.shape,
    async (params: z.infer<typeof getWorkflowDetailsParamsSchema>, _extra: any) => {
        const workflowName = params.workflow_name;
        console.error("[DEBUG] get_workflow_details called with name:", workflowName);
        try {
            let filePath = resolveWorkflowPath(workflowName, params.workflow_path);
            // Auto-detect workspace when only workflow_name is provided and default path doesn't exist
            try {
                if (!params.workflow_path) {
                    await fs.access(filePath).catch(async () => {
                        const detected = await tryDetectWorkspaceForName(workflowName);
                        if (detected) filePath = detected;
                    });
                }
            } catch { }

            // Ensure parent directory only when explicit path provided
            if (params.workflow_path) {
                await ensureWorkflowParentDir(filePath);
            }

            try {
                const data = await fs.readFile(filePath, 'utf8');
                const workflow = JSON.parse(data) as N8nWorkflow;
                console.error("[DEBUG] Found workflow by name in file:", filePath);
                return { content: [{ type: "text", text: JSON.stringify({ success: true, workflow }) }] };
            } catch (error: any) {
                if (error.code === 'ENOENT') {
                    console.warn(`[DEBUG] Workflow file ${filePath} not found using name: ${workflowName}.`);
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Workflow with name ${workflowName} not found` }) }] };
                } else {
                    throw error; // Re-throw other read errors
                }
            }
        } catch (error: any) {
            console.error("[ERROR] Failed to get workflow details:", error);
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to get workflow details: " + error.message }) }] };
        }
    }
);

// Add Node
// NOTE: This tool will need significant updates to load the specific workflow file,
// add the node to its 'nodes' array, and save the file.
const addNodeParamsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow to add the node to"),
    node_type: z.string().describe("The type of node to add (e.g., 'gmail', 'slack', 'openAi'). You can specify with or without the 'n8n-nodes-base.' prefix. The system will handle proper casing (e.g., 'openai' will be converted to 'openAi' if that's the correct casing)."),
    position: z.object({
        x: z.number(),
        y: z.number()
    }).optional().describe("The position of the node {x,y} - will be converted to [x,y] for N8nWorkflowNode"),
    parameters: z.record(z.string(), z.any()).optional().describe("The parameters for the node"),
    node_name: z.string().optional().describe("The name for the new node (e.g., 'My Gmail Node')"),
    typeVersion: z.number().optional().describe("The type version for the node (e.g., 1, 1.1). Defaults to 1 if not specified."),
    webhookId: z.string().optional().describe("Optional webhook ID for certain node types like triggers."),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach."),
    connect_from: z.array(z.object({
        source_node_id: z.string().describe("Existing node ID to connect FROM"),
        source_node_output_name: z.string().describe("Output handle on the source node (e.g., 'main' or 'ai_tool')"),
        target_node_input_name: z.string().default('main').describe("Input handle on the new node"),
        target_node_input_index: z.number().optional().default(0).describe("Input index on the new node (default: 0)")
    })).optional().describe("Optional: create connections from existing nodes to this new node"),
    connect_to: z.array(z.object({
        target_node_id: z.string().describe("Existing node ID to connect TO"),
        source_node_output_name: z.string().describe("Output handle on the new node (e.g., 'main' or 'ai_languageModel')"),
        target_node_input_name: z.string().default('main').describe("Input handle on the target node"),
        target_node_input_index: z.number().optional().default(0).describe("Input index on the target node (default: 0)")
    })).optional().describe("Optional: create connections from this new node to existing nodes")
});
server.tool(
    "add_node",
    "Add a node to an n8n workflow",
    addNodeParamsSchema.shape,
    async (params: z.infer<typeof addNodeParamsSchema>, _extra: any) => {
        console.error("[DEBUG] add_node called with:", params);
        const workflowName = params.workflow_name;
        try {
            // Attempt to reload node types if cache is empty and workspace changed
            if (getNodeInfoCache().size === 0 && getWorkspaceDir() !== process.cwd()) {
                console.warn("[WARN] nodeInfoCache is empty in add_node. Attempting to reload based on current WORKSPACE_DIR.");
                await loadKnownNodeBaseTypes();
            }

            let filePath = resolveWorkflowPath(workflowName, params.workflow_path);
            // If only workflow_name is provided and default path doesn't exist, try to detect workspace
            try {
                if (!params.workflow_path) {
                    await fs.access(filePath).catch(async () => {
                        const detected = await tryDetectWorkspaceForName(workflowName);
                        if (detected) filePath = detected;
                    });
                } else {
                    await ensureWorkflowParentDir(filePath);
                }
            } catch { }

            let workflow: N8nWorkflow;
            try {
                const data = await fs.readFile(filePath, 'utf8');
                workflow = JSON.parse(data) as N8nWorkflow;
            } catch (readError: any) {
                if (readError.code === 'ENOENT') {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Workflow with name ${workflowName} not found at ${filePath}` }) }] };
                }
                throw readError;
            }

            // Ensure workflow.nodes exists
            if (!Array.isArray(workflow.nodes)) {
                workflow.nodes = [];
            }

            const defaultPos = params.position || { x: Math.floor(Math.random() * 500), y: Math.floor(Math.random() * 500) };

            // Normalize the node type and resolve to a compatible typeVersion automatically
            const { finalNodeType, finalTypeVersion } = normalizeNodeTypeAndVersion(params.node_type, params.typeVersion);
            let resolvedVersion = finalTypeVersion;

            // Check if node type is supported in current N8N version
            if (!isNodeTypeSupported(finalNodeType, finalTypeVersion)) {
                // Auto-heal: if the chosen version is not supported, try to downgrade to the highest supported one
                const supported = getN8nVersionInfo()?.supportedNodes.get(finalNodeType);
                if (supported && supported.size > 0) {
                    const sorted = Array.from(supported).map(v => Number(v)).filter(v => !isNaN(v)).sort((a, b) => b - a);
                    const fallback = sorted[0];
                    if (fallback !== undefined) {
                        console.warn(`[WARN] Requested ${finalNodeType}@${finalTypeVersion} not supported on ${getCurrentN8nVersion()}; falling back to ${fallback}`);
                        resolvedVersion = fallback;
                    }
                } else {
                    const supportedVersionsList = supported ? Array.from(supported).join(', ') : 'none';
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: `Node type '${finalNodeType}' version ${finalTypeVersion} is not supported in N8N version ${getCurrentN8nVersion()}. Supported versions: ${supportedVersionsList}. Check 'list_available_nodes' for compatible alternatives or set N8N_VERSION environment variable.`
                            })
                        }]
                    };
                }
            }

            // Process parameters for LangChain LLM nodes
            let nodeParameters = params.parameters || {};
            // Prepare optional node-level credentials placeholder map
            let nodeCredentials: Record<string, { id: string; name: string }> = {};

            // Check if this is a LangChain LLM node
            const isLangChainLLM = finalNodeType.includes('@n8n/n8n-nodes-langchain') &&
                (finalNodeType.includes('lmChat') || finalNodeType.includes('llm'));

            // Apply normalization for LangChain LLM nodes
            if (isLangChainLLM) {
                console.error(`[DEBUG] Applying parameter normalization for LangChain LLM node`);
                nodeParameters = normalizeLLMParameters(nodeParameters);
            } else {
                // Handle OpenAI credentials specifically for non-LangChain nodes
                if ((params.parameters as any)?.options?.credentials?.providerType === 'openAi') {
                    console.error(`[DEBUG] Setting up proper OpenAI credentials format for standard node`);

                    // Remove credentials from options and set at node level
                    if ((nodeParameters as any).options?.credentials) {
                        const credentialsType = (nodeParameters as any).options.credentials.providerType;
                        delete (nodeParameters as any).options.credentials;

                        // Set a placeholder for credentials that would be filled in the n8n UI
                        if (!(nodeParameters as any).credentials) {
                            (nodeParameters as any).credentials = {};
                        }

                        // Add credentials in the proper format for OpenAI (also reflect at node-level for validator)
                        const credId = generateN8nId();
                        (nodeParameters as any).credentials = {
                            "openAiApi": {
                                "id": credId,
                                "name": "OpenAi account"
                            }
                        };
                        nodeCredentials["openAiApi"] = { id: credId, name: "OpenAi account" };
                    }
                }
            }

            // Generic credential placeholder injection based on node definition (to pass validator pre-checks)
            try {
                const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
                const nodeTypeDef = nodeTypes.getByNameAndVersion(finalNodeType, resolvedVersion as any);
                const credsCfg = (nodeTypeDef as any)?.description?.credentialsConfig as Array<{ name: string; required?: boolean }> | undefined;
                if (Array.isArray(credsCfg)) {
                    for (const cfg of credsCfg) {
                        if (cfg?.required) {
                            const key = String(cfg.name);
                            if (!nodeCredentials[key]) {
                                nodeCredentials[key] = { id: generateN8nId(), name: `${key}-placeholder` };
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[WARN] Could not compute credential placeholders for node:', (e as any)?.message || e);
            }

            const newNode: N8nWorkflowNode = {
                id: generateUUID(),
                type: finalNodeType,
                typeVersion: resolvedVersion, // Use version from normalizeNodeTypeAndVersion (or auto-healed)
                position: [defaultPos.x, defaultPos.y],
                parameters: nodeParameters,
                name: params.node_name || `${finalNodeType} Node`, // Use finalNodeType for default name
                ...(params.webhookId && { webhookId: params.webhookId }) // Add webhookId if provided
            };
            if (Object.keys(nodeCredentials).length > 0) {
                (newNode as any).credentials = nodeCredentials;
            }
            // Pre-validate before persisting
            try {
                const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
                const tentative = { ...workflow, nodes: [...workflow.nodes, newNode] };
                const preReport = validateAndNormalizeWorkflow(tentative as any, nodeTypes);
                // Filter out credential issues from blocking validation (for add operations)
                const hasBlockingIssues = preReport.nodeIssues && Object.values(preReport.nodeIssues).some((arr: any) =>
                    Array.isArray(arr) && arr.some((issue: any) =>
                        issue.code && issue.code !== 'missing_credentials'
                    )
                );
                // Only fail validation if there are actual errors OR non-credential blocking issues
                if (!preReport.ok || (preReport.errors && preReport.errors.length > 0) || hasBlockingIssues) {
                    console.warn('[WARN] Blocking validation on add_node:', { errors: preReport.errors, nodeIssues: preReport.nodeIssues });
                    // Sanitize validation payload to avoid leaking transient node IDs when creation fails
                    const idsToRedact = [newNode.id];
                    const redactText = (text: any) => {
                        if (typeof text !== 'string') return text;
                        let out = text;
                        for (const id of idsToRedact) {
                            if (id && typeof id === 'string') {
                                out = out.split(id).join('[redacted]');
                            }
                        }
                        return out;
                    };
                    const sanitizeWarnings = (warnings: any) => {
                        if (!Array.isArray(warnings)) return warnings;
                        return warnings.map((w: any) => {
                            const copy: any = { ...w };
                            if (copy.message) copy.message = redactText(copy.message);
                            if (copy.details && typeof copy.details === 'object') {
                                copy.details = { ...copy.details };
                                if (idsToRedact.includes(copy.details.nodeId)) delete copy.details.nodeId;
                            }
                            return copy;
                        });
                    };
                    const sanitizeErrors = (errors: any) => {
                        if (!Array.isArray(errors)) return errors;
                        return errors.map((e: any) => {
                            if (typeof e === 'string') return redactText(e);
                            if (e && typeof e === 'object') {
                                const ec: any = { ...e };
                                if (ec.message) ec.message = redactText(ec.message);
                                return ec;
                            }
                            return e;
                        });
                    };
                    const sanitizeNodeIssues = (nodeIssues: any) => {
                        if (!nodeIssues || typeof nodeIssues !== 'object') return nodeIssues;
                        const out: any = {};
                        for (const [nodeName, issues] of Object.entries(nodeIssues)) {
                            out[nodeName] = Array.isArray(issues)
                                ? (issues as any[]).map((iss: any) => {
                                    const ic: any = { ...iss };
                                    if (ic.message) ic.message = redactText(ic.message);
                                    return ic;
                                })
                                : issues;
                        }
                        return out;
                    };
                    const sanitizedValidation = {
                        ok: preReport.ok,
                        errors: sanitizeErrors(preReport.errors),
                        warnings: sanitizeWarnings(preReport.warnings),
                        nodeIssues: sanitizeNodeIssues(preReport.nodeIssues)
                    };
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Validation failed for node creation", validation: sanitizedValidation }) }] };
                }
            } catch (e: any) {
                console.warn('[WARN] Pre-write validation step errored in add_node:', e?.message || e);
            }

            workflow.nodes.push(newNode);
            await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
            console.error(`[DEBUG] Added node ${newNode.id} to workflow ${workflowName} in file ${filePath}`);
            // Optional wiring after add
            const createdConnections: Array<{ from: string; fromOutput: string; to: string; toInput: string; index: number }> = [];
            try {
                if (params.connect_from && params.connect_from.length > 0) {
                    for (const instr of params.connect_from) {
                        const sourceNode = workflow.nodes.find(n => n.id === instr.source_node_id);
                        const targetNode = newNode;
                        if (!sourceNode) {
                            console.warn(`[WARN] connect_from source not found: ${instr.source_node_id}`);
                            continue;
                        }
                        const sourceNameKey = sourceNode.name;
                        const outName = instr.source_node_output_name;
                        const inName = instr.target_node_input_name || 'main';
                        const inIndex = instr.target_node_input_index ?? 0;
                        if (!workflow.connections) workflow.connections = {} as any;
                        if (!workflow.connections[sourceNameKey]) workflow.connections[sourceNameKey] = {} as any;
                        if (!workflow.connections[sourceNameKey][outName]) workflow.connections[sourceNameKey][outName] = [] as any;
                        (workflow.connections[sourceNameKey][outName] as any[]).push([{ node: targetNode.name, type: inName, index: inIndex }]);
                        createdConnections.push({ from: `${sourceNode.name} (${sourceNode.id})`, fromOutput: outName, to: `${targetNode.name} (${targetNode.id})`, toInput: inName, index: inIndex });
                    }
                }
                if (params.connect_to && params.connect_to.length > 0) {
                    for (const instr of params.connect_to) {
                        const sourceNode = newNode;
                        const targetNode = workflow.nodes.find(n => n.id === instr.target_node_id);
                        if (!targetNode) {
                            console.warn(`[WARN] connect_to target not found: ${instr.target_node_id}`);
                            continue;
                        }
                        const sourceNameKey = sourceNode.name;
                        const outName = instr.source_node_output_name;
                        const inName = instr.target_node_input_name || 'main';
                        const inIndex = instr.target_node_input_index ?? 0;
                        if (!workflow.connections) workflow.connections = {} as any;
                        if (!workflow.connections[sourceNameKey]) workflow.connections[sourceNameKey] = {} as any;
                        if (!workflow.connections[sourceNameKey][outName]) workflow.connections[sourceNameKey][outName] = [] as any;
                        (workflow.connections[sourceNameKey][outName] as any[]).push([{ node: targetNode.name, type: inName, index: inIndex }]);
                        createdConnections.push({ from: `${sourceNode.name} (${sourceNode.id})`, fromOutput: outName, to: `${targetNode.name} (${targetNode.id})`, toInput: inName, index: inIndex });
                    }
                }
                if (createdConnections.length > 0) {
                    await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
                    console.error(`[DEBUG] add_node created ${createdConnections.length} connection(s) as requested`);
                }
            } catch (e: any) {
                console.warn('[WARN] Optional wiring in add_node failed:', e?.message || e);
            }
            // Validate after modification
            try {
                const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
                const report = validateAndNormalizeWorkflow(workflow as any, nodeTypes);
                if (!report.ok || (report.warnings && report.warnings.length > 0)) {
                    if (!report.ok) console.warn('[WARN] Workflow validation failed after add_node', report.errors);
                    return { content: [{ type: "text", text: JSON.stringify({ success: true, node: newNode, workflowId: workflow.id, createdConnections, validation: { ok: report.ok, errors: report.errors, warnings: report.warnings, nodeIssues: report.nodeIssues } }) }] };
                }
            } catch (e: any) {
                console.warn('[WARN] Validation step errored after add_node:', e?.message || e);
            }
            return { content: [{ type: "text", text: JSON.stringify({ success: true, node: newNode, workflowId: workflow.id, createdConnections }) }] };
        } catch (error: any) {
            console.error("[ERROR] Failed to add node:", error);
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to add node: " + error.message }) }] };
        }
    }
);

// Edit Node
// NOTE: This tool also needs updates for single-file workflow management.
const editNodeParamsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow containing the node"),
    node_id: z.string().describe("The ID of the node to edit"),
    node_type: z.string().optional().describe("The new type for the node (e.g., 'gmail', 'slack', 'openAi'). You can specify with or without the 'n8n-nodes-base.' prefix. The system will handle proper casing (e.g., 'openai' will be converted to 'openAi' if that's the correct casing)."),
    node_name: z.string().optional().describe("The new name for the node"),
    position: z.object({ // API still takes {x,y}
        x: z.number(),
        y: z.number()
    }).optional().describe("The new position {x,y} - will be converted to [x,y]"),
    parameters: z.record(z.string(), z.any()).optional().describe("The new parameters"),
    typeVersion: z.number().optional().describe("The new type version for the node"),
    webhookId: z.string().optional().describe("Optional new webhook ID for the node."),
    workflow_path: z.string().optional().describe("Optional workflow path to the workflow file"),
    connect_from: z.array(z.object({
        source_node_id: z.string().describe("Existing node ID to connect FROM"),
        source_node_output_name: z.string().describe("Output handle on the source node (e.g., 'main' or 'ai_tool')"),
        target_node_input_name: z.string().default('main').describe("Input handle on this node"),
        target_node_input_index: z.number().optional().default(0).describe("Input index on this node (default: 0)")
    })).optional().describe("Optional: create connections from existing nodes to this node after edit"),
    connect_to: z.array(z.object({
        target_node_id: z.string().describe("Existing node ID to connect TO"),
        source_node_output_name: z.string().describe("Output handle on this node (e.g., 'main' or 'ai_languageModel')"),
        target_node_input_name: z.string().default('main').describe("Input handle on the target node"),
        target_node_input_index: z.number().optional().default(0).describe("Input index on the target node (default: 0)")
    })).optional().describe("Optional: create connections from this node to existing nodes after edit")
});
server.tool(
    "edit_node",
    "Edit an existing node in a workflow",
    editNodeParamsSchema.shape,
    async (params: z.infer<typeof editNodeParamsSchema>, _extra: any) => {
        console.error("[DEBUG] edit_node called with:", params);
        const workflowName = params.workflow_name;
        try {
            // Similar cache reload logic as in add_node
            if (getNodeInfoCache().size === 0 && getWorkspaceDir() !== process.cwd()) {
                console.warn("[WARN] nodeInfoCache is empty in edit_node. Attempting to reload based on current WORKSPACE_DIR.");
                await loadKnownNodeBaseTypes();
            }

            const filePath = resolveWorkflowPath(workflowName, params.workflow_path);

            // Only ensure the default workflow directory if using standard approach
            if (!params.workflow_path) {
                await ensureWorkflowDir();
            } else {
                // Ensure the parent directory of the custom workflow file exists
                await ensureWorkflowParentDir(filePath);
            }

            let workflow: N8nWorkflow;
            try {
                const data = await fs.readFile(filePath, 'utf8');
                workflow = JSON.parse(data) as N8nWorkflow;
            } catch (readError: any) {
                if (readError.code === 'ENOENT') {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Workflow with name ${workflowName} not found at ${filePath}` }) }] };
                }
                throw readError;
            }

            const nodeIndex = workflow.nodes.findIndex(n => n.id === params.node_id);
            if (nodeIndex === -1) {
                return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Node with id ${params.node_id} not found in workflow ${workflowName}` }) }] };
            }

            const nodeToEdit = workflow.nodes[nodeIndex];

            let newType = nodeToEdit.type;
            let newTypeVersion = nodeToEdit.typeVersion;

            if (params.node_type) {
                // If node_type is changing, typeVersion should be re-evaluated based on the new type,
                // unless a specific params.typeVersion is also given for this edit.
                const { finalNodeType, finalTypeVersion: determinedVersionForNewType } = normalizeNodeTypeAndVersion(params.node_type, params.typeVersion);
                newType = finalNodeType;
                newTypeVersion = determinedVersionForNewType; // This uses params.typeVersion if valid, else default for new type.

                // Guard against incompatible version by selecting the highest supported for current n8n
                if (!isNodeTypeSupported(newType, newTypeVersion)) {
                    const supported = getN8nVersionInfo()?.supportedNodes.get(newType);
                    if (supported && supported.size > 0) {
                        const sorted = Array.from(supported).map(v => Number(v)).filter(v => !isNaN(v)).sort((a, b) => b - a);
                        if (sorted.length > 0) newTypeVersion = sorted[0];
                    }
                }
            } else if (params.typeVersion !== undefined && !isNaN(Number(params.typeVersion))) {
                // Only typeVersion is being changed, node_type remains the same.
                newTypeVersion = Number(params.typeVersion);
            } else if (params.typeVersion !== undefined && isNaN(Number(params.typeVersion))) {
                console.warn(`[WARN] Provided typeVersion '${params.typeVersion}' for editing node ${nodeToEdit.id} is NaN. typeVersion will not be changed.`);
            }

            nodeToEdit.type = newType;
            nodeToEdit.typeVersion = newTypeVersion;

            if (params.node_name) nodeToEdit.name = params.node_name;
            if (params.position) nodeToEdit.position = [params.position.x, params.position.y];

            // Process new parameters if provided
            if (params.parameters) {
                let newParameters = params.parameters;

                // Check if this is a LangChain LLM node
                const isLangChainLLM = newType.includes('@n8n/n8n-nodes-langchain') &&
                    (newType.includes('lmChat') || newType.includes('llm'));

                // Apply normalization for LangChain LLM nodes
                if (isLangChainLLM) {
                    console.error(`[DEBUG] Applying parameter normalization for LangChain LLM node during edit`);
                    newParameters = normalizeLLMParameters(newParameters);
                } else {
                    // Handle OpenAI credentials specifically for non-LangChain nodes
                    if (newParameters.options?.credentials?.providerType === 'openAi') {
                        console.error(`[DEBUG] Setting up proper OpenAI credentials format for standard node during edit`);

                        // Remove credentials from options and set at node level
                        if (newParameters.options?.credentials) {
                            const credentialsType = newParameters.options.credentials.providerType;
                            delete newParameters.options.credentials;

                            // Set a placeholder for credentials that would be filled in the n8n UI
                            if (!newParameters.credentials) {
                                newParameters.credentials = {};
                            }

                            // Add credentials in the proper format for OpenAI
                            newParameters.credentials = {
                                "openAiApi": {
                                    "id": generateN8nId(),
                                    "name": "OpenAi account"
                                }
                            };
                        }
                    }
                }

                nodeToEdit.parameters = newParameters;
            }

            if (params.webhookId !== undefined) { // Allow setting or unsetting webhookId
                if (params.webhookId === null || params.webhookId === "") { // Check for explicit clear
                    delete nodeToEdit.webhookId;
                } else {
                    nodeToEdit.webhookId = params.webhookId;
                }
            }

            // Inject generic credential placeholders for required credentials if missing
            try {
                const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
                const typeDef = nodeTypes.getByNameAndVersion(nodeToEdit.type, nodeToEdit.typeVersion as any);
                const credsCfg = (typeDef as any)?.description?.credentialsConfig as Array<{ name: string; required?: boolean }> | undefined;
                if (Array.isArray(credsCfg) && credsCfg.length > 0) {
                    (nodeToEdit as any).credentials = (nodeToEdit as any).credentials || {};
                    for (const cfg of credsCfg) {
                        if (cfg?.required) {
                            const key = String(cfg.name);
                            if (!(nodeToEdit as any).credentials[key]) {
                                (nodeToEdit as any).credentials[key] = { id: generateN8nId(), name: `${key}-placeholder` };
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[WARN] Could not inject credential placeholders during edit_node:', (e as any)?.message || e);
            }

            // Pre-validate before persisting
            try {
                const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
                const tentative = { ...workflow, nodes: workflow.nodes.map((n, i) => i === nodeIndex ? nodeToEdit : n) };
                const preReport = validateAndNormalizeWorkflow(tentative as any, nodeTypes);
                // Filter out credential issues from blocking validation (for edit operations)
                const hasBlockingIssues = preReport.nodeIssues && Object.values(preReport.nodeIssues).some((arr: any) =>
                    Array.isArray(arr) && arr.some((issue: any) =>
                        issue.code && issue.code !== 'missing_credentials'
                    )
                );
                // Only fail validation if there are actual errors OR non-credential blocking issues
                if (!preReport.ok || (preReport.errors && preReport.errors.length > 0) || hasBlockingIssues) {
                    console.warn('[WARN] Blocking validation on edit_node:', { errors: preReport.errors, nodeIssues: preReport.nodeIssues });
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Validation failed for node edit", validation: { ok: preReport.ok, errors: preReport.errors, warnings: preReport.warnings, nodeIssues: preReport.nodeIssues } }) }] };
                }
            } catch (e: any) {
                console.warn('[WARN] Pre-write validation step errored in edit_node:', e?.message || e);
            }

            workflow.nodes[nodeIndex] = nodeToEdit;
            await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
            console.error(`[DEBUG] Edited node ${params.node_id} in workflow ${workflowName} in file ${filePath}`);
            // Optional wiring after edit
            const createdConnections: Array<{ from: string; fromOutput: string; to: string; toInput: string; index: number }> = [];
            try {
                if (params.connect_from && params.connect_from.length > 0) {
                    for (const instr of params.connect_from) {
                        const sourceNode = workflow.nodes.find(n => n.id === instr.source_node_id);
                        const targetNode = nodeToEdit;
                        if (!sourceNode) {
                            console.warn(`[WARN] connect_from source not found: ${instr.source_node_id}`);
                            continue;
                        }
                        const sourceNameKey = sourceNode.name;
                        const outName = instr.source_node_output_name;
                        const inName = instr.target_node_input_name || 'main';
                        const inIndex = instr.target_node_input_index ?? 0;
                        if (!workflow.connections) workflow.connections = {} as any;
                        if (!workflow.connections[sourceNameKey]) workflow.connections[sourceNameKey] = {} as any;
                        if (!workflow.connections[sourceNameKey][outName]) workflow.connections[sourceNameKey][outName] = [] as any;
                        (workflow.connections[sourceNameKey][outName] as any[]).push([{ node: targetNode.name, type: inName, index: inIndex }]);
                        createdConnections.push({ from: `${sourceNode.name} (${sourceNode.id})`, fromOutput: outName, to: `${targetNode.name} (${targetNode.id})`, toInput: inName, index: inIndex });
                    }
                }
                if (params.connect_to && params.connect_to.length > 0) {
                    for (const instr of params.connect_to) {
                        const sourceNode = nodeToEdit;
                        const targetNode = workflow.nodes.find(n => n.id === instr.target_node_id);
                        if (!targetNode) {
                            console.warn(`[WARN] connect_to target not found: ${instr.target_node_id}`);
                            continue;
                        }
                        const sourceNameKey = sourceNode.name;
                        const outName = instr.source_node_output_name;
                        const inName = instr.target_node_input_name || 'main';
                        const inIndex = instr.target_node_input_index ?? 0;
                        if (!workflow.connections) workflow.connections = {} as any;
                        if (!workflow.connections[sourceNameKey]) workflow.connections[sourceNameKey] = {} as any;
                        if (!workflow.connections[sourceNameKey][outName]) workflow.connections[sourceNameKey][outName] = [] as any;
                        (workflow.connections[sourceNameKey][outName] as any[]).push([{ node: targetNode.name, type: inName, index: inIndex }]);
                        createdConnections.push({ from: `${sourceNode.name} (${sourceNode.id})`, fromOutput: outName, to: `${targetNode.name} (${targetNode.id})`, toInput: inName, index: inIndex });
                    }
                }
                if (createdConnections.length > 0) {
                    await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
                    console.error(`[DEBUG] edit_node created ${createdConnections.length} connection(s) as requested`);
                }
            } catch (e: any) {
                console.warn('[WARN] Optional wiring in edit_node failed:', e?.message || e);
            }
            // Validate after modification
            try {
                const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
                const report = validateAndNormalizeWorkflow(workflow as any, nodeTypes);
                if (!report.ok || (report.warnings && report.warnings.length > 0)) {
                    if (!report.ok) console.warn('[WARN] Workflow validation failed after edit_node', report.errors);
                    return { content: [{ type: "text", text: JSON.stringify({ success: true, node: nodeToEdit, createdConnections, validation: { ok: report.ok, errors: report.errors, warnings: report.warnings, nodeIssues: report.nodeIssues } }) }] };
                }
            } catch (e: any) {
                console.warn('[WARN] Validation step errored after edit_node:', e?.message || e);
            }
            return { content: [{ type: "text", text: JSON.stringify({ success: true, node: nodeToEdit, createdConnections }) }] };
        } catch (error: any) {
            console.error("[ERROR] Failed to edit node:", error);
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to edit node: " + error.message }) }] };
        }
    }
);

// Delete Node
// NOTE: This tool also needs updates for single-file workflow management.
const deleteNodeParamsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow containing the node"),
    node_id: z.string().describe("The ID of the node to delete"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});
server.tool(
    "delete_node",
    "Delete a node from a workflow",
    deleteNodeParamsSchema.shape,
    async (params: z.infer<typeof deleteNodeParamsSchema>, _extra: any) => {
        console.error("[DEBUG] delete_node called with:", params);
        const workflowName = params.workflow_name;
        try {
            const filePath = resolveWorkflowPath(workflowName, params.workflow_path);

            // Only ensure the default workflow directory if using standard approach
            if (!params.workflow_path) {
                await ensureWorkflowDir();
            } else {
                // Ensure the parent directory of the custom workflow file exists
                await ensureWorkflowParentDir(filePath);
            }

            let workflow: N8nWorkflow;
            try {
                const data = await fs.readFile(filePath, 'utf8');
                workflow = JSON.parse(data) as N8nWorkflow;
            } catch (readError: any) {
                if (readError.code === 'ENOENT') {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Workflow with name ${workflowName} not found at ${filePath}` }) }] };
                }
                throw readError;
            }

            const nodeIndex = workflow.nodes.findIndex(n => n.id === params.node_id);
            if (nodeIndex === -1) {
                return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Node with id ${params.node_id} not found in workflow ${workflowName}` }) }] };
            }

            const deletedNodeName = workflow.nodes[nodeIndex].name;
            workflow.nodes.splice(nodeIndex, 1);

            // Also remove connections related to this node
            // This is a simplified connection removal. n8n's logic might be more complex.
            const newConnections: N8nConnections = {};
            for (const sourceNodeName in workflow.connections) {
                if (sourceNodeName === deletedNodeName) continue; // Skip connections FROM the deleted node

                const outputConnections = workflow.connections[sourceNodeName];
                const newOutputConnectionsForSource: N8nConnections[string] = {};

                for (const outputKey in outputConnections) {
                    const connectionChains = outputConnections[outputKey];
                    const newConnectionChains: N8nConnectionDetail[][] = [];

                    for (const chain of connectionChains) {
                        const newChain = chain.filter(connDetail => connDetail.node !== deletedNodeName);
                        if (newChain.length > 0) {
                            newConnectionChains.push(newChain);
                        }
                    }
                    if (newConnectionChains.length > 0) {
                        newOutputConnectionsForSource[outputKey] = newConnectionChains;
                    }
                }
                if (Object.keys(newOutputConnectionsForSource).length > 0) {
                    newConnections[sourceNodeName] = newOutputConnectionsForSource;
                }
            }
            workflow.connections = newConnections;

            await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
            console.error(`[DEBUG] Deleted node ${params.node_id} from workflow ${workflowName} in file ${filePath}`);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `Node ${params.node_id} deleted successfully from workflow ${workflowName}` }) }] };
        } catch (error: any) {
            console.error("[ERROR] Failed to delete node:", error);
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to delete node: " + error.message }) }] };
        }
    }
);

// Add Connection
const addConnectionParamsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow to add the connection to"),
    source_node_id: z.string().describe("The ID of the source node for the connection"),
    source_node_output_name: z.string().describe("The name of the output handle on the source node (e.g., 'main')"),
    target_node_id: z.string().describe("The ID of the target node for the connection"),
    target_node_input_name: z.string().describe("The name of the input handle on the target node (e.g., 'main')"),
    target_node_input_index: z.number().optional().default(0).describe("The index for the target node's input handle (default: 0)"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});

server.tool(
    "add_connection",
    "Create a connection between two nodes",
    addConnectionParamsSchema.shape,
    async (params: z.infer<typeof addConnectionParamsSchema>, _extra: any) => {
        console.error("[DEBUG] add_connection called with:", params);
        const { workflow_name, source_node_id, source_node_output_name, target_node_id, target_node_input_name, target_node_input_index } = params;

        try {
            let filePath = resolveWorkflowPath(workflow_name, (params as any).workflow_path);
            try {
                if (!(params as any).workflow_path) {
                    await fs.access(filePath).catch(async () => {
                        const detected = await tryDetectWorkspaceForName(workflow_name);
                        if (detected) filePath = detected;
                    });
                }
            } catch { }

            let workflow: N8nWorkflow;
            try {
                const data = await fs.readFile(filePath, 'utf8');
                workflow = JSON.parse(data) as N8nWorkflow;
            } catch (readError: any) {
                if (readError.code === 'ENOENT') {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Workflow with name ${workflow_name} not found at ${filePath}` }) }] };
                }
                throw readError;
            }

            const sourceNode = workflow.nodes.find(node => node.id === source_node_id);
            const targetNode = workflow.nodes.find(node => node.id === target_node_id);

            if (!sourceNode) {
                return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Source node with ID ${source_node_id} not found in workflow ${workflow_name}` }) }] };
            }
            if (!targetNode) {
                return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Target node with ID ${target_node_id} not found in workflow ${workflow_name}` }) }] };
            }

            const sourceNodeNameKey = sourceNode.name; // n8n connections are keyed by node *name*
            const targetNodeNameValue = targetNode.name;

            // Detect if we're working with LangChain AI nodes that require special connection handling
            const isLangChainSource = sourceNode.type.includes('@n8n/n8n-nodes-langchain');
            const isLangChainTarget = targetNode.type.includes('@n8n/n8n-nodes-langchain');
            const isAIConnection = source_node_output_name.startsWith('ai_') || target_node_input_name.startsWith('ai_');

            let connectionDirection = "forward"; // Default: source -> target

            // Check if we need to reverse connection direction for AI nodes
            // This handles the special case for LangChain nodes where tools and models 
            // connect TO the agent rather than the agent connecting to them
            if ((isLangChainSource || isLangChainTarget) && isAIConnection) {
                // Check if this might be a case where direction needs to be reversed
                // - Models/Tools point TO Agent (reversed)
                // - Agent points to regular nodes (forward)
                // - Triggers point to any node (forward)
                // - Memory nodes point TO Agent (reversed)
                if (
                    // If it's a LLM, Tool, or Memory node pointing to an agent
                    (sourceNode.type.includes('lmChat') ||
                        sourceNode.type.includes('tool') ||
                        sourceNode.type.toLowerCase().includes('request') ||
                        sourceNode.type.includes('memory'))
                    && targetNode.type.includes('agent')
                ) {
                    console.warn("[WARN] LangChain AI connection detected. N8n often expects models, tools, and memory to connect TO agents rather than agents connecting to them.");
                    console.warn("[WARN] Connections will be created as specified, but if they don't appear correctly in n8n UI, try reversing the source and target.");

                    // Special hint for memory connections
                    if (sourceNode.type.includes('memory')) {
                        if (source_node_output_name !== 'ai_memory') {
                            console.warn("[WARN] Memory nodes should usually connect to agents using 'ai_memory' output, not '" + source_node_output_name + "'.");
                        }
                        if (target_node_input_name !== 'ai_memory') {
                            console.warn("[WARN] Agents should receive memory connections on 'ai_memory' input, not '" + target_node_input_name + "'.");
                        }
                    }
                }
            }

            const newConnectionObject: N8nConnectionDetail = {
                node: targetNodeNameValue,
                type: target_node_input_name,
                index: target_node_input_index
            };

            if (!workflow.connections) {
                workflow.connections = {};
            }

            if (!workflow.connections[sourceNodeNameKey]) {
                workflow.connections[sourceNodeNameKey] = {};
            }

            if (!workflow.connections[sourceNodeNameKey][source_node_output_name]) {
                workflow.connections[sourceNodeNameKey][source_node_output_name] = [];
            }

            // n8n expects an array of connection arrays for each output handle.
            // Each inner array represents a set of connections originating from the same output point if it splits.
            // For a simple new connection, we add it as a new chain: [newConnectionObject]
            workflow.connections[sourceNodeNameKey][source_node_output_name].push([newConnectionObject]);

            await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
            console.error(`[DEBUG] Added connection from ${sourceNodeNameKey}:${source_node_output_name} to ${targetNodeNameValue}:${target_node_input_name} in workflow ${workflow_name}`);

            // Add a special note for AI connections
            let message = "Connection added successfully";
            if ((isLangChainSource || isLangChainTarget) && isAIConnection) {
                message += ". Note: For LangChain nodes, connections might need specific output/input names and connection direction. If connections don't appear in n8n UI, check that:";
                message += "\n- Models connect TO the agent using 'ai_languageModel' ports";
                message += "\n- Tools connect TO the agent using 'ai_tool' ports";
                message += "\n- Memory nodes connect TO the agent using 'ai_memory' ports";
            }

            // Validate after modification
            try {
                const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
                const report = validateAndNormalizeWorkflow(workflow as any, nodeTypes);
                if (!report.ok || (report.warnings && report.warnings.length > 0)) {
                    if (!report.ok) console.warn('[WARN] Workflow validation failed after add_connection', report.errors);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                message,
                                connection: {
                                    from: `${sourceNode.name} (${source_node_id})`,
                                    fromOutput: source_node_output_name,
                                    to: `${targetNode.name} (${target_node_id})`,
                                    toInput: target_node_input_name,
                                    index: target_node_input_index
                                },
                                validation: { ok: report.ok, errors: report.errors, warnings: report.warnings, nodeIssues: report.nodeIssues }
                            })
                        }]
                    };
                }
            } catch (e: any) {
                console.warn('[WARN] Validation step errored after add_connection:', e?.message || e);
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        message,
                        connection: {
                            from: `${sourceNode.name} (${source_node_id})`,
                            fromOutput: source_node_output_name,
                            to: `${targetNode.name} (${target_node_id})`,
                            toInput: target_node_input_name,
                            index: target_node_input_index
                        }
                    })
                }]
            };

        } catch (error: any) {
            console.error("[ERROR] Failed to add connection:", error);
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to add connection: " + error.message }) }] };
        }
    }
);

// Add AI Connections (special case for LangChain nodes)
const addAIConnectionsParamsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow to add the AI connections to"),
    agent_node_id: z.string().describe("The ID of the agent node that will use the model and tools"),
    model_node_id: z.string().optional().describe("The ID of the language model node (optional)"),
    tool_node_ids: z.array(z.string()).optional().describe("Array of tool node IDs to connect to the agent (optional)"),
    memory_node_id: z.string().optional().describe("The ID of the memory node (optional)"),
    // New optional nodes for extended AI wiring
    embeddings_node_id: z.string().optional().describe("The ID of the embeddings node (optional)"),
    vector_store_node_id: z.string().optional().describe("The ID of the vector store node (optional)"),
    vector_insert_node_id: z.string().optional().describe("The ID of the vector store insert node (optional)"),
    vector_tool_node_id: z.string().optional().describe("The ID of the Vector Store Question Answer Tool node (optional)"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});

server.tool(
    "add_ai_connections",
    "Wire AI model, tools, and memory to an agent",
    addAIConnectionsParamsSchema.shape,
    async (params: z.infer<typeof addAIConnectionsParamsSchema>, _extra: any) => {
        console.error("[DEBUG] add_ai_connections called with:", params);
        const { workflow_name, agent_node_id, model_node_id, tool_node_ids, memory_node_id, embeddings_node_id, vector_store_node_id, vector_insert_node_id, vector_tool_node_id, workflow_path } = params;

        if (!model_node_id && (!tool_node_ids || tool_node_ids.length === 0) && !memory_node_id) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: "At least one of model_node_id, memory_node_id, or tool_node_ids must be provided"
                    })
                }]
            };
        }

        try {
            let filePath = resolveWorkflowPath(workflow_name, workflow_path);
            // Auto-detect workspace when path not provided and default path doesn't exist
            try {
                if (!workflow_path) {
                    await fs.access(filePath).catch(async () => {
                        const detected = await tryDetectWorkspaceForName(workflow_name);
                        if (detected) filePath = detected;
                    });
                }
            } catch { }

            let workflow: N8nWorkflow;
            try {
                const data = await fs.readFile(filePath, 'utf8');
                workflow = JSON.parse(data) as N8nWorkflow;
            } catch (readError: any) {
                if (readError.code === 'ENOENT') {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Workflow with name ${workflow_name} not found at ${filePath}` }) }] };
                }
                throw readError;
            }

            // First verify all nodes exist
            const agentNode = workflow.nodes.find(node => node.id === agent_node_id);
            if (!agentNode) {
                return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Agent node with ID ${agent_node_id} not found in workflow ${workflow_name}` }) }] };
            }

            // Enforce that the target node is actually an Agent (per node definition wiring.role)
            try {
                const workflowNodesRootDir = path.resolve(__dirname, '../workflow_nodes');
                const nodeTypes = await loadNodeTypesForCurrentVersion(workflowNodesRootDir, getCurrentN8nVersion() || undefined);
                const agentType = nodeTypes.getByNameAndVersion(agentNode.type, (agentNode as any).typeVersion);
                const role = (agentType as any)?.description?.wiring?.role;
                const looksLikeAgent = String(agentNode.type || '').toLowerCase().includes('agent');
                if (role !== 'agent' && !looksLikeAgent) {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Node ${agentNode.name} (${agent_node_id}) is not an Agent node (type=${agentNode.type}).` }) }] };
                }
            } catch (e) {
                console.warn('[WARN] Could not verify agent node type against node definitions:', (e as any)?.message || e);
            }

            let modelNode = null;
            if (model_node_id) {
                modelNode = workflow.nodes.find(node => node.id === model_node_id);
                if (!modelNode) {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Model node with ID ${model_node_id} not found in workflow ${workflow_name}` }) }] };
                }
            }

            let memoryNode = null;
            if (memory_node_id) {
                memoryNode = workflow.nodes.find(node => node.id === memory_node_id);
                if (!memoryNode) {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Memory node with ID ${memory_node_id} not found in workflow ${workflow_name}` }) }] };
                }
            }

            let embeddingsNode: N8nWorkflowNode | null = null;
            if (embeddings_node_id) {
                embeddingsNode = workflow.nodes.find(node => node.id === embeddings_node_id) || null;
                if (!embeddingsNode) {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Embeddings node with ID ${embeddings_node_id} not found in workflow ${workflow_name}` }) }] };
                }
            }

            let vectorStoreNode: N8nWorkflowNode | null = null;
            if (vector_store_node_id) {
                vectorStoreNode = workflow.nodes.find(node => node.id === vector_store_node_id) || null;
                if (!vectorStoreNode) {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Vector store node with ID ${vector_store_node_id} not found in workflow ${workflow_name}` }) }] };
                }
            }

            let vectorInsertNode: N8nWorkflowNode | null = null;
            if (vector_insert_node_id) {
                vectorInsertNode = workflow.nodes.find(node => node.id === vector_insert_node_id) || null;
                if (!vectorInsertNode) {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Vector insert node with ID ${vector_insert_node_id} not found in workflow ${workflow_name}` }) }] };
                }
            }

            let vectorToolNode: N8nWorkflowNode | null = null;
            if (vector_tool_node_id) {
                vectorToolNode = workflow.nodes.find(node => node.id === vector_tool_node_id) || null;
                if (!vectorToolNode) {
                    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Vector tool node with ID ${vector_tool_node_id} not found in workflow ${workflow_name}` }) }] };
                }
            }

            const toolNodes: N8nWorkflowNode[] = [];
            if (tool_node_ids && tool_node_ids.length > 0) {
                for (const toolId of tool_node_ids) {
                    const toolNode = workflow.nodes.find(node => node.id === toolId);
                    if (!toolNode) {
                        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Tool node with ID ${toolId} not found in workflow ${workflow_name}` }) }] };
                    }
                    toolNodes.push(toolNode);
                }
            }

            if (!workflow.connections) {
                workflow.connections = {};
            }

            // For AI nodes in n8n, we need to:
            // 1. Language model connects TO the agent using ai_languageModel ports
            // 2. Tools connect TO the agent using ai_tool ports
            // 3. Memory nodes connect TO the agent using ai_memory ports
            // Extended wiring:
            // 4. Embeddings connect TO Vector Store using ai_embeddings
            // 5. Vector Store connects TO Vector Insert using ai_document
            // 6. Vector Store connects TO Vector QA Tool using ai_vectorStore
            // 7. Language model connects TO Vector QA Tool using ai_languageModel

            // Create the language model connection if a model node was provided
            if (modelNode) {
                const modelNodeName = modelNode.name;

                // Initialize model node's connections if needed
                if (!workflow.connections[modelNodeName]) {
                    workflow.connections[modelNodeName] = {};
                }

                // Add the AI language model output
                if (!workflow.connections[modelNodeName]["ai_languageModel"]) {
                    workflow.connections[modelNodeName]["ai_languageModel"] = [];
                }

                // Add connection from model to agent
                const modelConnection: N8nConnectionDetail = {
                    node: agentNode.name,
                    type: "ai_languageModel",
                    index: 0
                };

                // Check if this connection already exists
                const existingModelConnection = workflow.connections[modelNodeName]["ai_languageModel"].some(
                    conn => conn.some(detail => detail.node === agentNode.name && detail.type === "ai_languageModel")
                );

                if (!existingModelConnection) {
                    workflow.connections[modelNodeName]["ai_languageModel"].push([modelConnection]);
                    console.error(`[DEBUG] Added AI language model connection from ${modelNodeName} to ${agentNode.name}`);
                } else {
                    console.error(`[DEBUG] AI language model connection from ${modelNodeName} to ${agentNode.name} already exists`);
                }
            }

            // Create memory connection if a memory node was provided
            if (memoryNode) {
                const memoryNodeName = memoryNode.name;

                // Initialize memory node's connections if needed
                if (!workflow.connections[memoryNodeName]) {
                    workflow.connections[memoryNodeName] = {};
                }

                // Add the AI memory output
                if (!workflow.connections[memoryNodeName]["ai_memory"]) {
                    workflow.connections[memoryNodeName]["ai_memory"] = [];
                }

                // Add connection from memory to agent
                const memoryConnection: N8nConnectionDetail = {
                    node: agentNode.name,
                    type: "ai_memory",
                    index: 0
                };

                // Check if this connection already exists
                const existingMemoryConnection = workflow.connections[memoryNodeName]["ai_memory"].some(
                    conn => conn.some(detail => detail.node === agentNode.name && detail.type === "ai_memory")
                );

                if (!existingMemoryConnection) {
                    workflow.connections[memoryNodeName]["ai_memory"].push([memoryConnection]);
                    console.error(`[DEBUG] Added AI memory connection from ${memoryNodeName} to ${agentNode.name}`);
                } else {
                    console.error(`[DEBUG] AI memory connection from ${memoryNodeName} to ${agentNode.name} already exists`);
                }
            }

            // Create tool connections if tool nodes were provided
            if (toolNodes.length > 0) {
                for (const toolNode of toolNodes) {
                    const toolNodeName = toolNode.name;

                    // Initialize tool node's connections if needed
                    if (!workflow.connections[toolNodeName]) {
                        workflow.connections[toolNodeName] = {};
                    }

                    // Add the AI tool output
                    if (!workflow.connections[toolNodeName]["ai_tool"]) {
                        workflow.connections[toolNodeName]["ai_tool"] = [];
                    }

                    // Add connection from tool to agent
                    const toolConnection: N8nConnectionDetail = {
                        node: agentNode.name,
                        type: "ai_tool",
                        index: 0
                    };

                    // Check if this connection already exists (dedupe)
                    const exists = workflow.connections[toolNodeName]["ai_tool"].some(
                        (group) => Array.isArray(group) && group.some((d) => d && d.node === agentNode.name && d.type === "ai_tool")
                    );
                    if (!exists) {
                        workflow.connections[toolNodeName]["ai_tool"].push([toolConnection]);
                        console.error(`[DEBUG] Added AI tool connection from ${toolNodeName} to ${agentNode.name}`);
                    } else {
                        console.error(`[DEBUG] AI tool connection from ${toolNodeName} to ${agentNode.name} already exists`);
                    }
                }
            }

            // Embeddings → Vector Store (ai_embeddings)
            if (embeddingsNode && vectorStoreNode) {
                const fromName = embeddingsNode.name;
                const toName = vectorStoreNode.name;
                if (!workflow.connections[fromName]) workflow.connections[fromName] = {} as any;
                if (!workflow.connections[fromName]["ai_embeddings"]) workflow.connections[fromName]["ai_embeddings"] = [] as any;
                const exists = (workflow.connections[fromName]["ai_embeddings"] as any[]).some((group: any[]) => Array.isArray(group) && group.some((d: any) => d && d.node === toName && d.type === "ai_embeddings"));
                if (!exists) {
                    (workflow.connections[fromName]["ai_embeddings"] as any[]).push([{ node: toName, type: "ai_embeddings", index: 0 }]);
                    console.error(`[DEBUG] Added embeddings connection from ${fromName} to ${toName} (ai_embeddings)`);
                }
            }

            // Vector Store → Vector Insert (ai_document)
            if (vectorStoreNode && vectorInsertNode) {
                const fromName = vectorStoreNode.name;
                const toName = vectorInsertNode.name;
                if (!workflow.connections[fromName]) workflow.connections[fromName] = {} as any;
                if (!workflow.connections[fromName]["ai_document"]) workflow.connections[fromName]["ai_document"] = [] as any;
                const exists = (workflow.connections[fromName]["ai_document"] as any[]).some((group: any[]) => Array.isArray(group) && group.some((d: any) => d && d.node === toName && d.type === "ai_document"));
                if (!exists) {
                    (workflow.connections[fromName]["ai_document"] as any[]).push([{ node: toName, type: "ai_document", index: 0 }]);
                    console.error(`[DEBUG] Added vector document connection from ${fromName} to ${toName} (ai_document)`);
                }
            }

            // Vector Store → Vector QA Tool (ai_vectorStore)
            if (vectorStoreNode) {
                const toNode = vectorToolNode || (toolNodes || []).find(n => String(n.type).includes('toolVectorStore')) || null;
                if (toNode) {
                    const fromName = vectorStoreNode.name;
                    const toName = toNode.name;
                    if (!workflow.connections[fromName]) workflow.connections[fromName] = {} as any;
                    if (!workflow.connections[fromName]["ai_vectorStore"]) workflow.connections[fromName]["ai_vectorStore"] = [] as any;
                    const exists = (workflow.connections[fromName]["ai_vectorStore"] as any[]).some((group: any[]) => Array.isArray(group) && group.some((d: any) => d && d.node === toName && d.type === "ai_vectorStore"));
                    if (!exists) {
                        (workflow.connections[fromName]["ai_vectorStore"] as any[]).push([{ node: toName, type: "ai_vectorStore", index: 0 }]);
                        console.error(`[DEBUG] Added vector store connection from ${fromName} to ${toName} (ai_vectorStore)`);
                    }
                }
            }

            // Language Model → Vector QA Tool (ai_languageModel)
            if (modelNode) {
                const toNode = vectorToolNode || (toolNodes || []).find(n => String(n.type).includes('toolVectorStore')) || null;
                if (toNode) {
                    const fromName = modelNode.name;
                    const toName = toNode.name;
                    if (!workflow.connections[fromName]) workflow.connections[fromName] = {} as any;
                    if (!workflow.connections[fromName]["ai_languageModel"]) workflow.connections[fromName]["ai_languageModel"] = [] as any;
                    const exists = (workflow.connections[fromName]["ai_languageModel"] as any[]).some((group: any[]) => Array.isArray(group) && group.some((d: any) => d && d.node === toName && d.type === "ai_languageModel"));
                    if (!exists) {
                        (workflow.connections[fromName]["ai_languageModel"] as any[]).push([{ node: toName, type: "ai_languageModel", index: 0 }]);
                        console.error(`[DEBUG] Added model connection from ${fromName} to ${toName} (ai_languageModel)`);
                    }
                }
            }

            // Save the updated workflow
            await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));

            // Build summary of connections created
            const connectionsSummary: Array<{ from: string, fromOutput: string, to: string, toInput: string }> = [];

            if (modelNode) {
                connectionsSummary.push({
                    from: `${modelNode.name} (${model_node_id})`,
                    fromOutput: "ai_languageModel",
                    to: `${agentNode.name} (${agent_node_id})`,
                    toInput: "ai_languageModel"
                });
            }

            if (memoryNode) {
                connectionsSummary.push({
                    from: `${memoryNode.name} (${memory_node_id})`,
                    fromOutput: "ai_memory",
                    to: `${agentNode.name} (${agent_node_id})`,
                    toInput: "ai_memory"
                });
            }

            toolNodes.forEach(toolNode => {
                connectionsSummary.push({
                    from: `${toolNode.name} (${toolNode.id})`,
                    fromOutput: "ai_tool",
                    to: `${agentNode.name} (${agent_node_id})`,
                    toInput: "ai_tool"
                });
            });

            if (embeddingsNode && vectorStoreNode) {
                connectionsSummary.push({
                    from: `${embeddingsNode.name} (${embeddings_node_id})`,
                    fromOutput: "ai_embeddings",
                    to: `${vectorStoreNode.name} (${vector_store_node_id})`,
                    toInput: "ai_embeddings"
                });
            }

            if (vectorStoreNode && vectorInsertNode) {
                connectionsSummary.push({
                    from: `${vectorStoreNode.name} (${vector_store_node_id})`,
                    fromOutput: "ai_document",
                    to: `${vectorInsertNode.name} (${vector_insert_node_id})`,
                    toInput: "ai_document"
                });
            }

            if (vectorStoreNode) {
                const toNode = vectorToolNode || (toolNodes || []).find(n => String(n.type).includes('toolVectorStore')) || null;
                if (toNode) {
                    connectionsSummary.push({
                        from: `${vectorStoreNode.name} (${vector_store_node_id})`,
                        fromOutput: "ai_vectorStore",
                        to: `${toNode.name} (${toNode.id})`,
                        toInput: "ai_vectorStore"
                    });
                }
            }

            if (modelNode) {
                const toNode = vectorToolNode || (toolNodes || []).find(n => String(n.type).includes('toolVectorStore')) || null;
                if (toNode) {
                    connectionsSummary.push({
                        from: `${modelNode.name} (${model_node_id})`,
                        fromOutput: "ai_languageModel",
                        to: `${toNode.name} (${toNode.id})`,
                        toInput: "ai_languageModel"
                    });
                }
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        message: "AI connections added successfully",
                        connectionsCreated: connectionsSummary.length,
                        connections: connectionsSummary
                    })
                }]
            };
        } catch (error: any) {
            console.error("[ERROR] Failed to add AI connections:", error);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: "Failed to add AI connections: " + error.message
                    })
                }]
            };
        }
    }
);

// Compose AI Workflow (high-level bulk operation)
const composeAIWorkflowParamsSchema = z.object({
    workflow_name: z.string().describe("Name of the workflow to compose/update"),
    n8n_version: z.string().optional().describe("Target n8n version to use for node catalogs and compatibility"),
    plan: z.object({
        agent: z.object({ node_type: z.string().default("@n8n/n8n-nodes-langchain.agent"), node_name: z.string().default("AI Agent") }).optional(),
        model: z.object({ node_type: z.string().default("@n8n/n8n-nodes-langchain.lmChatOpenAi"), node_name: z.string().default("OpenAI Chat Model"), parameters: z.record(z.string(), z.any()).optional() }).optional(),
        memory: z.object({ node_type: z.string().default("@n8n/n8n-nodes-langchain.memoryBufferWindow"), node_name: z.string().default("Conversation Memory"), parameters: z.record(z.string(), z.any()).optional() }).optional(),
        embeddings: z.object({ node_type: z.string().default("@n8n/n8n-nodes-langchain.embeddingsOpenAi"), node_name: z.string().default("OpenAI Embeddings"), parameters: z.record(z.string(), z.any()).optional() }).optional(),
        vector_store: z.object({ node_type: z.string().default("@n8n/n8n-nodes-langchain.vectorStoreInMemory"), node_name: z.string().default("In-Memory Vector Store"), parameters: z.record(z.string(), z.any()).optional() }).optional(),
        vector_insert: z.object({ node_type: z.string().default("@n8n/n8n-nodes-langchain.vectorStoreInMemoryInsert"), node_name: z.string().default("In-Memory Vector Insert"), parameters: z.record(z.string(), z.any()).optional() }).optional(),
        vector_tool: z.object({ node_type: z.string().default("@n8n/n8n-nodes-langchain.toolVectorStore"), node_name: z.string().default("Vector QA Tool"), parameters: z.record(z.string(), z.any()).optional() }).optional(),
        tools: z.array(z.object({ node_type: z.string(), node_name: z.string().optional(), parameters: z.record(z.string(), z.any()).optional() })).optional(),
        trigger: z.object({ node_type: z.string().default("@n8n/n8n-nodes-langchain.chatTrigger"), node_name: z.string().default("Start Chat Trigger"), parameters: z.record(z.string(), z.any()).optional() }).optional()
    }).describe("High level plan of nodes to add and wire")
});

server.tool(
    "compose_ai_workflow",
    "Compose a complex AI workflow (agent + model + memory + embeddings + vector + tools + trigger) in one call, including wiring and basic validation.",
    composeAIWorkflowParamsSchema.shape,
    async (params: z.infer<typeof composeAIWorkflowParamsSchema>, _extra: any) => {
        console.error("[DEBUG] compose_ai_workflow called with:", params?.plan ? Object.keys(params.plan) : []);
        const { workflow_name, plan } = params;
        try {
            // Step 1: ensure workflow exists (create if missing)
            await ensureWorkflowDir();
            const filePath = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, `${workflow_name.replace(/[^a-z0-9_.-]/gi, '_')}.json`));
            let workflow: N8nWorkflow;
            try {
                const raw = await fs.readFile(filePath, 'utf8');
                workflow = JSON.parse(raw);
            } catch (e: any) {
                // Create minimal workflow if missing
                workflow = { name: workflow_name, id: generateUUID(), nodes: [], connections: {}, active: false, pinData: {}, settings: { executionOrder: 'v1' }, versionId: generateUUID(), meta: { instanceId: generateUUID() }, tags: [] } as any;
            }

            // Helper to add a node with normalization
            const addNode = async (nodeType: string, nodeName: string, parameters?: Record<string, any>, position?: { x: number, y: number }): Promise<N8nWorkflowNode> => {
                const { finalNodeType, finalTypeVersion } = normalizeNodeTypeAndVersion(nodeType);
                const node: any = {
                    id: generateN8nId(),
                    type: finalNodeType,
                    typeVersion: finalTypeVersion,
                    position: [position?.x ?? 100, position?.y ?? 100],
                    parameters: parameters || {},
                    name: nodeName
                };
                workflow.nodes.push(node);
                return node as N8nWorkflowNode;
            };

            // Rough positions for readability
            const positions = {
                trigger: { x: 80, y: 80 }, agent: { x: 380, y: 80 }, model: { x: 380, y: -120 }, memory: { x: 380, y: 240 },
                embeddings: { x: 720, y: -280 }, vstore: { x: 720, y: -120 }, vinsert: { x: 960, y: -200 }, vtool: { x: 640, y: 80 }
            };

            // Step 2: add nodes from the plan
            const trigger = plan.trigger ? await addNode(plan.trigger.node_type, plan.trigger.node_name, plan.trigger.parameters, positions.trigger) : null;
            const agent = plan.agent ? await addNode(plan.agent.node_type, plan.agent.node_name, undefined, positions.agent) : null;
            const model = plan.model ? await addNode(plan.model.node_type, plan.model.node_name, plan.model.parameters, positions.model) : null;
            const memory = plan.memory ? await addNode(plan.memory.node_type, plan.memory.node_name, plan.memory.parameters, positions.memory) : null;
            const embeddings = plan.embeddings ? await addNode(plan.embeddings.node_type, plan.embeddings.node_name, plan.embeddings.parameters, positions.embeddings) : null;
            const vstore = plan.vector_store ? await addNode(plan.vector_store.node_type, plan.vector_store.node_name, plan.vector_store.parameters, positions.vstore) : null;
            const vinsert = plan.vector_insert ? await addNode(plan.vector_insert.node_type, plan.vector_insert.node_name, plan.vector_insert.parameters, positions.vinsert) : null;
            const vtool = plan.vector_tool ? await addNode(plan.vector_tool.node_type, plan.vector_tool.node_name, plan.vector_tool.parameters, positions.vtool) : null;
            const extraTools: N8nWorkflowNode[] = [];
            if (Array.isArray(plan.tools)) {
                for (const t of plan.tools) extraTools.push(await addNode(t.node_type, t.node_name || t.node_type.split('.').pop() || 'Tool', t.parameters));
            }

            // Step 3: wire standard connections
            const toolIds = [...(vtool ? [vtool.id] : []), ...extraTools.map(t => t.id)];
            await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));

            // Re-load to use shared connection routine
            const res = await (async () => {
                const p: any = {
                    workflow_name,
                    agent_node_id: agent?.id,
                    model_node_id: model?.id,
                    memory_node_id: memory?.id,
                    tool_node_ids: toolIds.length ? toolIds : undefined,
                    embeddings_node_id: embeddings?.id,
                    vector_store_node_id: vstore?.id,
                    vector_insert_node_id: vinsert?.id,
                    vector_tool_node_id: vtool?.id
                };
                // Reuse internal implementation by calling same function body pattern
                // Simulate by directly updating file via add_ai_connections logic above: we'll call validate afterwards
                return p;
            })();

            // Call the same underlying wiring by invoking add_ai_connections handler logic
            const wiringResult = await (async () => {
                const toolParams: any = {
                    workflow_name,
                    agent_node_id: agent?.id!,
                    model_node_id: model?.id,
                    memory_node_id: memory?.id,
                    tool_node_ids: toolIds.length ? toolIds : undefined,
                    embeddings_node_id: embeddings?.id,
                    vector_store_node_id: vstore?.id,
                    vector_insert_node_id: vinsert?.id,
                    vector_tool_node_id: vtool?.id
                };
                // Inline invoke: replicate parameter pass through server since we are inside same process
                const resp = await (async () => {
                    const parsed = await (addAIConnectionsParamsSchema as any).parseAsync(toolParams);
                    // Reuse the code path by calling the handler body: simplest is to write filePath and then re-run handler code
                    // To avoid duplicate logic, we directly call the same block by re-reading and reusing the implemented routine above is non-trivial here.
                    // As a compromise, we programmatically call the public add_connection tool multiple times for missing edges.
                    return parsed;
                })();
                // Instead of duplicating handler, connect minimal necessary edges using low-level add_connection helper implemented above
                const connect = async (from: N8nWorkflowNode | null | undefined, fromOutput: string, to: N8nWorkflowNode | null | undefined, toInput: string) => {
                    if (!from || !to) return;
                    let wfRaw = JSON.parse(await fs.readFile(filePath, 'utf8')) as N8nWorkflow;
                    if (!wfRaw.connections) wfRaw.connections = {} as any;
                    const fromName = from.name;
                    if (!(wfRaw.connections as any)[fromName]) (wfRaw.connections as any)[fromName] = {} as any;
                    if (!(wfRaw.connections as any)[fromName][fromOutput]) (wfRaw.connections as any)[fromName][fromOutput] = [] as any;
                    const exists = ((wfRaw.connections as any)[fromName][fromOutput] as any[]).some((group: any[]) => Array.isArray(group) && group.some((d: any) => d && d.node === to.name && d.type === toInput));
                    if (!exists) ((wfRaw.connections as any)[fromName][fromOutput] as any[]).push([{ node: to.name, type: toInput, index: 0 }]);
                    await fs.writeFile(filePath, JSON.stringify(wfRaw, null, 2));
                };

                await connect(model, 'ai_languageModel', agent, 'ai_languageModel');
                await connect(memory, 'ai_memory', agent, 'ai_memory');
                await connect(embeddings, 'ai_embeddings', vstore, 'ai_embeddings');
                await connect(vstore, 'ai_document', vinsert, 'ai_document');
                await connect(vstore, 'ai_vectorStore', vtool, 'ai_vectorStore');
                await connect(model, 'ai_languageModel', vtool, 'ai_languageModel');
                await connect(vtool, 'ai_tool', agent, 'ai_tool');
                await connect(trigger, 'main', agent, 'main');

                return { success: true };
            })();

            // Validate
            const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
            const finalRaw = await fs.readFile(filePath, 'utf8');
            const finalWf = JSON.parse(finalRaw);
            const report = validateAndNormalizeWorkflow(finalWf, nodeTypes);

            return {
                content: [{ type: 'text', text: JSON.stringify({ success: true, workflowId: finalWf.id, wiring: wiringResult, validation: { ok: report.ok, errors: report.errors, warnings: report.warnings, nodeIssues: report.nodeIssues } }) }]
            };
        } catch (error: any) {
            console.error('[ERROR] compose_ai_workflow failed:', error);
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }) }] };
        }
    }
);

// List Available Nodes
const listAvailableNodesParamsSchema = z.object({
    search_term: z.string().optional().describe("Filter by name, type, or description. For LangChain nodes, try 'langchain', roles like 'agent', 'lmChat'/'llm', 'tool', 'memory', or provider names such as 'qdrant', 'weaviate', 'milvus', 'openai', 'anthropic'."),
    n8n_version: z.string().optional().describe("Filter nodes by N8N version compatibility. If not provided, uses current configured N8N version."),
    limit: z.number().int().positive().max(1000).optional().describe("Maximum number of nodes to return"),
    cursor: z.string().optional().describe("Opaque cursor for pagination; pass back to get the next page"),
    // Enable smart tag-style matching (e.g., 'llm' → 'lmChat', provider names)
    tags: z.boolean().optional().describe("Enable tag-style synonym search (e.g., 'llm' → 'lmChat', providers). Defaults to true."),
    // How to combine multiple search terms: 'and' requires all tokens, 'or' matches any
    token_logic: z.enum(['and', 'or']).optional().describe("When multiple terms are provided, require all terms ('and') or any ('or'). Defaults to 'or'.")
});

server.tool(
    "list_available_nodes",
    "List available node types. Supports tag-style synonym search and multi-token queries. By default, multiple terms use OR logic (e.g., 'webhook trigger' matches either). Set token_logic='and' to require all tokens. Disable synonyms with tags=false. Tips: search 'langchain', roles like 'agent', 'lmChat/llm', 'tool', 'memory', or provider names like 'qdrant', 'weaviate', 'milvus', 'openai', 'anthropic'.",
    listAvailableNodesParamsSchema.shape,
    async (params: z.infer<typeof listAvailableNodesParamsSchema>, _extra: any) => {
        console.error("[DEBUG] list_available_nodes called with params:", params);
        let availableNodes: any[] = [];

        // Root directory that contains either JSON files or versioned subdirectories
        // When compiled, this file lives in dist, so workflow_nodes is one level up
        const workflowNodesRootDir = path.resolve(__dirname, '../workflow_nodes');
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

            // Determine if we have versioned subdirectories and pick the exact version directory when available
            let workflowNodesDir = workflowNodesRootDir;
            try {
                const entries = await fs.readdir(workflowNodesRootDir, { withFileTypes: true });
                const versionDirs = entries.filter(e => (e as any).isDirectory?.() === true).map(e => (e as any).name);

                if (versionDirs.length > 0) {
                    const targetVersion = params.n8n_version || getCurrentN8nVersion();
                    if (targetVersion && versionDirs.includes(targetVersion)) {
                        workflowNodesDir = path.join(workflowNodesRootDir, targetVersion);
                        effectiveVersion = targetVersion;
                    } else if (!targetVersion) {
                        // No target specified: choose highest semver directory
                        const parse = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
                        versionDirs.sort((a, b) => {
                            const [a0, a1, a2] = parse(a);
                            const [b0, b1, b2] = parse(b);
                            if (a0 !== b0) return b0 - a0;
                            if (a1 !== b1) return b1 - a1;
                            return b2 - a2;
                        });
                        workflowNodesDir = path.join(workflowNodesRootDir, versionDirs[0]);
                        effectiveVersion = versionDirs[0];
                    } else {
                        // Exact version requested but not found; keep root to avoid false empty, but log a clear warning
                        console.warn(`[WARN] Requested N8N version directory '${targetVersion}' not found under workflow_nodes. Available: ${versionDirs.join(', ')}`);
                        // Fallback: if there is a latest dir, use it so we still return something
                        const parse = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
                        versionDirs.sort((a, b) => {
                            const [a0, a1, a2] = parse(a);
                            const [b0, b1, b2] = parse(b);
                            if (a0 !== b0) return b0 - a0;
                            if (a1 !== b1) return b1 - a1;
                            return b2 - a2;
                        });
                        workflowNodesDir = path.join(workflowNodesRootDir, versionDirs[0]);
                        effectiveVersion = versionDirs[0];
                    }
                }
            } catch {
                // If reading entries fails, fall back to root and let the next readdir handle errors
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

            // Additional sensitive diagnostic log for search inputs and derived counts
            try {
                const { sensitiveLogger } = require('./utils/logger');
                sensitiveLogger.debug(`list_available_nodes diagnostics: search_term='${params.search_term || ''}', totalParsed=${allParsedNodes.length}, matched=${availableNodes.length}`);
            } catch { }

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

            // Return the formatted response
            return {
                content: [{
                    type: "text", text: JSON.stringify({
                        success: true,
                        nodes: page,
                        total: orderedNodes.length,
                        nextCursor,
                        filteredFor: targetVersion ? `N8N ${targetVersion}` : "All versions",
                        currentN8nVersion: targetVersion || getCurrentN8nVersion(),
                        usageGuidance: undefined
                    })
                }]
            };

        } catch (error: any) {
            console.error("[ERROR] Failed to list available nodes:", error);
            if (error.code === 'ENOENT') {
                console.warn("[WARN] workflow_nodes directory not found. Cannot list available nodes.");
                return { content: [{ type: "text", text: JSON.stringify({ success: true, nodes: [], message: "workflow_nodes directory not found." }) }] };
            }
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to list available nodes: " + error.message }) }] };
        }
    }
);

// N8N Version Management Tools

// Get N8N Version Info
server.tool(
    "get_n8n_version_info",
    "Get N8N version info and capabilities",
    {},
    async (_params: Record<string, never>, _extra: any) => {
        console.error("[DEBUG] get_n8n_version_info called");
        try {
            const supportedVersionsList = Array.from(getSupportedN8nVersions().keys()).sort((a, b) =>
                parseFloat(b) - parseFloat(a)
            );

            const currentInfo = getN8nVersionInfo() ? {
                version: getCurrentN8nVersion(),
                capabilities: getN8nVersionInfo()!.capabilities,
                supportedNodesCount: getN8nVersionInfo()!.supportedNodes.size
            } : null;

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        currentVersion: getCurrentN8nVersion(),
                        currentVersionInfo: currentInfo,
                        supportedVersions: supportedVersionsList,
                        versionSource: process.env.N8N_VERSION ? "environment_override" :
                            (process.env.N8N_API_URL ? "api_detection" : "default"),
                        capabilities: getN8nVersionInfo()?.capabilities || []
                    })
                }]
            };
        } catch (error: any) {
            console.error("[ERROR] Failed to get N8N version info:", error);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: "Failed to get N8N version info: " + error.message
                    })
                }]
            };
        }
    }
);

// Validate Workflow tool
const validateWorkflowParamsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow to validate"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file")
});

server.tool(
    "validate_workflow",
    "Validate a workflow file against known node schemas",
    validateWorkflowParamsSchema.shape,
    async (params: z.infer<typeof validateWorkflowParamsSchema>, _extra: any) => {
        console.error("[DEBUG] validate_workflow called with:", params);
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
            const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
            const report = validateAndNormalizeWorkflow(workflow, nodeTypes);

            // For validate_workflow tool, treat all warnings as errors to ensure AI agents don't ignore them
            const allErrors = [...report.errors];

            // Convert warnings to errors for this tool, but skip benign trigger-specific AI port warnings
            if (report.warnings.length > 0) {
                for (const warning of report.warnings) {
                    const warnType = String((warning as any)?.details?.type || '').toLowerCase();
                    const isTriggerAiPortWarning = warning.code === 'ai_node_without_ai_ports' && warnType.includes('chattrigger');
                    if (isTriggerAiPortWarning) continue;
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

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: validationOk,
                        validation: {
                            ok: validationOk,
                            errors: allErrors,
                            startNode: report.startNode,
                            originalWarningCount: report.warnings.length,
                            note: report.warnings.length > 0 ? "Warnings have been promoted to errors for validation tool" : undefined,
                            suggestedActions,
                            nodeIssues: report.nodeIssues
                        }
                    })
                }]
            };
        } catch (error: any) {
            console.error("[ERROR] Failed to validate workflow:", error);
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to validate workflow: " + error.message }) }] };
        }
    }
);

// Create and configure the transport
const transport = new StdioServerTransport();

// Start the server
async function main(): Promise<void> {
    try {
        // Note: loadKnownNodeBaseTypes uses resolvePath, which depends on WORKSPACE_DIR.
        // WORKSPACE_DIR is typically set by create_workflow. 
        // If called before create_workflow, it might use process.cwd() or fail if workflow_nodes isn't there.
        // This is a known limitation for now; ideally, WORKSPACE_DIR is configured at MCP server init more globally.
        await loadKnownNodeBaseTypes(); // Attempt to load node types at startup
        await initializeN8nVersionSupport(); // Initialize N8N version support
        const detectedVersion = await detectN8nVersion(); // Detect the current N8N version
        await setN8nVersion(detectedVersion || "1.30.0"); // Set the current N8N version

        await server.connect(transport);
        console.error("[DEBUG] N8N Workflow Builder MCP Server started (TypeScript version)");

        // Debugging tool schemas might need update if params changed significantly for other tools
        const toolSchemasForDebug = {
            create_workflow: createWorkflowParamsSchema,
            list_workflows: z.object({}), // Updated to reflect empty params
            get_workflow_details: getWorkflowDetailsParamsSchema,
            add_node: addNodeParamsSchema,
            edit_node: editNodeParamsSchema,
            delete_node: deleteNodeParamsSchema,
            add_connection: addConnectionParamsSchema
        };

        const manuallyConstructedToolList = Object.entries(toolSchemasForDebug).map(([name, schema]) => {
            let toolDefinition: any = { name };
            // Attempt to get description from the schema if available, or use a default.
            // Note: .describe() on Zod schemas is for properties, not usually the whole schema for tool description.
            // The description passed in the options object to server.tool() is what the MCP client sees.
            // This reconstruction is for local debugging of what the SDK *might* send.

            if (name === "create_workflow") toolDefinition.description = "Create a new n8n workflow";
            else if (name === "list_workflows") toolDefinition.description = "List all n8n workflows";
            else if (name === "get_workflow_details") toolDefinition.description = "Get details of a specific n8n workflow";
            else if (name === "add_node") toolDefinition.description = "Add a new node to a workflow";
            else if (name === "edit_node") toolDefinition.description = "Edit an existing node in a workflow";
            else if (name === "delete_node") toolDefinition.description = "Delete a node from a workflow";
            else if (name === "add_connection") toolDefinition.description = "Add a new connection between nodes in a workflow";
            else toolDefinition.description = `Description for ${name}`;

            if (schema) {
                // This is a simplified mock of how zod-to-json-schema might convert it
                // Actual conversion by SDK might be more complex.
                const properties: Record<string, any> = {};
                const required: string[] = [];
                const shape = schema.shape as Record<string, z.ZodTypeAny>;
                for (const key in shape) {
                    const field = shape[key];
                    properties[key] = { type: field._def.typeName.replace('Zod', '').toLowerCase(), description: field.description };
                    if (!field.isOptional()) {
                        required.push(key);
                    }
                }
                toolDefinition.inputSchema = { type: "object", properties, required };
            } else {
                toolDefinition.inputSchema = { type: "object", properties: {}, required: [] };
            }
            return toolDefinition;
        });

        console.error("[DEBUG] Server's expected 'tools' array for tools/list response (with detailed inputSchemas):");
        console.error(JSON.stringify(manuallyConstructedToolList, null, 2));

        // Keep the process alive
        return new Promise<void>((resolve, reject) => {
            process.on('SIGINT', () => {
                console.error("[DEBUG] Received SIGINT, shutting down...");
                server.close().then(resolve).catch(reject);
            });
            process.on('SIGTERM', () => {
                console.error("[DEBUG] Received SIGTERM, shutting down...");
                server.close().then(resolve).catch(reject);
            });
        });
    } catch (error) {
        console.error("[ERROR] Failed to start server:", error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error("[ERROR] Unhandled error in main:", error);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error("[ERROR] Uncaught exception:", error);
    // Consider whether to exit or attempt graceful shutdown
});

process.on('unhandledRejection', (reason, promise) => {
    console.error("[ERROR] Unhandled promise rejection at:", promise, "reason:", reason);
    // Consider whether to exit or attempt graceful shutdown
});

