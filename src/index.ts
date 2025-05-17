#!/usr/bin/env node

// N8N Workflow Builder MCP Server
// Using the official MCP SDK as required

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

// Define types for workflow and node structures
// Old Workflow interface (kept for reference or other tools not yet updated)
interface WorkflowNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    parameters: Record<string, any>;
}

interface WorkflowConnection {
    sourceNodeId: string;
    targetNodeId: string;
}

interface Workflow {
    id: string;
    name: string;
    description: string;
    created: string;
    nodes: WorkflowNode[];
    connections: WorkflowConnection[];
}

// New N8N specific interfaces
interface N8nWorkflowNode {
    parameters: Record<string, any>;
    type: string;
    typeVersion: number;
    position: [number, number]; // [x, y]
    id: string; // UUID
    name: string;
    webhookId?: string; // Added for nodes like ChatTrigger
}

interface N8nConnectionDetail {
    node: string; // Name of the target node
    type: string; // e.g., "main"
    index: number;
}

interface N8nConnections {
    [sourceNodeName: string]: {
        [outputType: string]: N8nConnectionDetail[][];
    };
}

interface N8nWorkflowSettings {
    executionOrder: "v1";
    // Future settings can be added here
}

interface N8nWorkflowMeta {
    instanceId: string;
    // Future meta fields can be added here
}

interface N8nWorkflow {
    name: string;
    nodes: N8nWorkflowNode[];
    pinData: Record<string, any>;
    connections: N8nConnections;
    active: boolean;
    settings: N8nWorkflowSettings;
    versionId: string; // UUID
    meta?: N8nWorkflowMeta;
    id: string; // Short, unique ID (e.g., "Y6sBMxxyJQtgCCBQ")
    tags: string[];
}

// Global workspace configuration
let WORKSPACE_DIR: string = process.cwd();
console.error(`[DEBUG] Default workspace directory: ${WORKSPACE_DIR}`);

// Store for known node type casings (lowercase -> CorrectCase)
// let knownNodeBaseCasings: Map<string, string> = new Map(); // OLD MAP

interface CachedNodeInfo {
    officialType: string; // The correctly cased, full type string (e.g., "n8n-nodes-base.HttpRequest" or "@n8n/n8n-nodes-langchain.allowFileUploads")
    version: number | number[]; // The version information from the node's definition file
}
let nodeInfoCache: Map<string, CachedNodeInfo> = new Map();

// Helper function to normalize LLM parameters from various possible inputs
function normalizeLLMParameters(params: Record<string, any>): Record<string, any> {
    const normalized = { ...params };

    // Handle model/modelName variation
    if (normalized.modelName && !normalized.model) {
        console.error(`[DEBUG] Normalizing 'modelName' to 'model'`);
        normalized.model = normalized.modelName;
        delete normalized.modelName;
    }

    // Convert model string to required format
    if (normalized.model && typeof normalized.model === 'string') {
        console.error(`[DEBUG] Converting model string to required format: ${normalized.model}`);
        const modelValue = normalized.model;
        normalized.model = {
            "__rl": true,
            "value": modelValue,
            "mode": "list",
            "cachedResultName": modelValue
        };
    }

    // Handle credentials formatting
    // Handle at options level
    if (normalized.options?.credentials?.providerType) {
        const credType = normalized.options.credentials.providerType;
        console.error(`[DEBUG] Found credentials in options with type: ${credType}`);
        delete normalized.options.credentials;

        // Set credentials properly based on provider type
        if (credType === 'openAi' || credType === 'openAiApi') {
            normalized.credentials = {
                "openAiApi": {
                    "id": generateN8nId(),
                    "name": "OpenAi account"
                }
            };
        }
    }

    // Handle at root level
    if (normalized.credentialsType && !normalized.credentials) {
        const credType = normalized.credentialsType;
        console.error(`[DEBUG] Found credentialsType at root level: ${credType}`);

        // Set credentials properly based on provider type
        if (credType === 'openAi' || credType === 'openAiApi') {
            normalized.credentials = {
                "openAiApi": {
                    "id": generateN8nId(),
                    "name": "OpenAi account"
                }
            };
        }

        // Remove root level parameter
        delete normalized.credentialsType;
    }

    return normalized;
}

async function loadKnownNodeBaseTypes(): Promise<void> {
    // Corrected path: relative to this script's location, assuming workflow_nodes is at project root
    const workflowNodesDir = path.resolve(__dirname, '../workflow_nodes');
    try {
        console.error(`[DEBUG] Attempting to load known node types from server resource path: ${workflowNodesDir}`);
        const files = await fs.readdir(workflowNodesDir);
        const suffix = ".json";
        // knownNodeBaseCasings.clear(); // Clear any previous entries // OLD MAP
        nodeInfoCache.clear();

        for (const file of files) {
            if (file.endsWith(suffix)) {
                try {
                    // Extract base type from filename like "MyNode.json" -> "MyNode"
                    // const correctCaseBaseType = file.substring(0, file.length - suffix.length); // Not directly used for cache keys anymore

                    // Also read the JSON file to get the nodeType property with correct casing
                    const filePath = path.join(workflowNodesDir, file);
                    const fileContent = await fs.readFile(filePath, 'utf8');
                    const nodeDefinition = JSON.parse(fileContent);

                    if (nodeDefinition.nodeType) {
                        const officialType = nodeDefinition.nodeType;
                        const version = nodeDefinition.version || 1; // Default to 1 if version is missing/falsy

                        // Map by lowercase full official type
                        nodeInfoCache.set(officialType.toLowerCase(), { officialType, version });
                        console.error(`[DEBUG] Cached node info for key '${officialType.toLowerCase()}': { officialType: '${officialType}', version: ${JSON.stringify(version)} }`);

                        // If it's a prefixed type (n8n-nodes-base), also map by its lowercase base name
                        const prefix = "n8n-nodes-base.";
                        if (officialType.startsWith(prefix)) {
                            const baseName = officialType.substring(prefix.length);
                            if (baseName) { // Ensure baseName is not empty
                                nodeInfoCache.set(baseName.toLowerCase(), { officialType, version });
                                console.error(`[DEBUG] Cached node info for base key '${baseName.toLowerCase()}': { officialType: '${officialType}', version: ${JSON.stringify(version)} }`);
                            }
                        }
                    }
                } catch (parseError) {
                    console.warn(`[WARN] Error parsing node definition in ${file}:`, parseError);
                    // Continue with other files if one fails to parse
                }
            }
        }

        console.error(`[DEBUG] Loaded ${nodeInfoCache.size} cache entries for node types.`);
        if (nodeInfoCache.size === 0) {
            console.warn("[WARN] No node type information loaded into cache. Check 'workflow_nodes' directory and naming convention.");
        }
    } catch (error: any) {
        console.warn(`[WARN] Could not load known node types from ${workflowNodesDir}: ${error.message}. Node type normalization might rely on defaults.`);
        nodeInfoCache = new Map(); // Ensure map is empty if loading fails
    }
}

// Helper function to normalize node types (OLD - to be replaced)
// function normalizeNodeType(inputType: string): string { ... } // OLD FUNCTION

// New function to get normalized type and version
function normalizeNodeTypeAndVersion(inputType: string, inputVersion?: number): { finalNodeType: string; finalTypeVersion: number } {
    if (nodeInfoCache.size === 0 && WORKSPACE_DIR !== process.cwd()) { // Check if cache is empty and workspace might have changed
        console.warn("[WARN] nodeInfoCache is empty in normalizeNodeTypeAndVersion. Attempting to reload based on current WORKSPACE_DIR.");
        // This reload should be awaited if called from an async context.
        // For now, assuming loadKnownNodeBaseTypes was called at startup or by a previous async tool.
        // Synchronous reload attempt (not ideal but matches previous knownNodeBaseCasings logic):
        // await loadKnownNodeBaseTypes(); // Making this async would require normalizeNodeTypeAndVersion to be async too.
        // For now, we proceed, and if cache is empty, warnings will be issued.
    }

    const lowerInputType = inputType.toLowerCase();
    const prefix = "n8n-nodes-base.";
    const cacheEntry = nodeInfoCache.get(lowerInputType);

    let finalNodeType: string;
    let versionSource: number | number[] = 1; // Default version if not found in cache

    if (cacheEntry) {
        finalNodeType = cacheEntry.officialType; // This is the correctly cased, full type name
        versionSource = cacheEntry.version;
    } else {
        // Not in cache. Determine type based on structure.
        if (inputType.includes('/') && !lowerInputType.startsWith(prefix)) {
            // Likely a namespaced type not in cache (e.g. user typed it, or it's new)
            finalNodeType = inputType; // Use user's casing
            console.warn(`[WARN] Namespaced node type ${inputType} not in cache. Using as-is with default version.`);
        } else {
            // Assumed to be a base type needing a prefix, or a prefixed type not in cache.
            // Use inputType for casing if it already seems prefixed, otherwise prefix the original inputType
            finalNodeType = lowerInputType.startsWith(prefix) ? inputType : `${prefix}${inputType}`;
            console.warn(`[WARN] Node type ${inputType} (assumed base/prefixed) not in cache. Result: ${finalNodeType} with default version.`);
        }
        // versionSource remains 1 (default)
    }

    let finalTypeVersion: number;
    if (inputVersion !== undefined && !isNaN(Number(inputVersion))) {
        finalTypeVersion = Number(inputVersion);
    } else { // inputVersion was not provided or was NaN, use versionSource
        if (inputVersion !== undefined && isNaN(Number(inputVersion))) {
            console.warn(`[WARN] Provided inputVersion '${inputVersion}' is NaN for node ${finalNodeType}. Determining from cache/default.`);
        }
        if (Array.isArray(versionSource)) {
            if (versionSource.length > 0) {
                const numericVersions = versionSource.map(v => Number(v)).filter(v => !isNaN(v));
                finalTypeVersion = numericVersions.length > 0 ? Math.max(...numericVersions) : 1;
            } else {
                finalTypeVersion = 1; // Empty array in cache
            }
        } else { // It's a number or was defaulted to 1
            finalTypeVersion = Number(versionSource);
        }
        if (isNaN(finalTypeVersion)) finalTypeVersion = 1; // Fallback for bad data from cache
    }
    if (isNaN(finalTypeVersion)) finalTypeVersion = 1; // Final check, e.g. if inputVersion was NaN and versionSource also led to NaN.

    console.error(`[DEBUG] normalizeNodeTypeAndVersion: input='${inputType}', inputVersion=${inputVersion} -> finalNodeType='${finalNodeType}', finalTypeVersion=${finalTypeVersion}`);
    return { finalNodeType, finalTypeVersion };
}

// Helper function to resolve paths against workspace
// Always treat paths as relative to WORKSPACE_DIR by stripping leading slashes
function resolvePath(filepath: string): string {
    // Remove any leading path separators to prevent absolute path resolution
    const relativePath = filepath.replace(/^[\\/]+/, '');
    return path.join(WORKSPACE_DIR, relativePath);
}

// ID Generation Helpers
function generateN8nId(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function generateInstanceId(length: number = 64): string {
    const chars = 'abcdef0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Constants
const WORKFLOW_DATA_DIR_NAME = 'workflow_data';
const WORKFLOWS_FILE_NAME = 'workflows.json'; // Kept for now, but create_workflow won't use it.

// Helper functions
async function ensureWorkflowDir(): Promise<void> {
    try {
        const resolvedDir = resolvePath(WORKFLOW_DATA_DIR_NAME);
        console.error("[DEBUG] Ensuring workflow directory at:", resolvedDir);
        await fs.mkdir(resolvedDir, { recursive: true });
        // Removed creation of workflows.json as each workflow is a separate file now.
    } catch (error) {
        console.error('[ERROR] Failed to ensure workflow directory:', error);
        throw error;
    }
}

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
    createWorkflowParamsSchema.shape,
    async (params: z.infer<typeof createWorkflowParamsSchema>, _extra) => {
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

            WORKSPACE_DIR = workspaceDir; // Set current workspace for resolvePath
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
            return { content: [{ type: "text", text: JSON.stringify({ success: true, workflow: newN8nWorkflow, recommended_next_step: "YOU NEED TO CALL 'list_available_nodes' TOOL BEFORE starting adding nodes. SEARCH BY SPECIFIC TOPIC USING 'search_term' parameter'." }) }] };

        } catch (error: any) {
            console.error("[ERROR] Failed to create workflow:", error);
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to create workflow: " + error.message }) }] };
        }
    }
);

// List Workflows
// NOTE: This tool will need to be updated to read individual .json files
// from the workflow_data directory and parse them into N8nWorkflow[]
server.tool(
    "list_workflows",
    {},
    async (_params: Record<string, never>, _extra) => {
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
            return { content: [{ type: "text", text: JSON.stringify({ success: true, workflows }) }] };
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
    workflow_name: z.string().describe("The Name of the workflow to get details for")
});
server.tool(
    "get_workflow_details",
    getWorkflowDetailsParamsSchema.shape,
    async (params: z.infer<typeof getWorkflowDetailsParamsSchema>, _extra) => {
        const workflowName = params.workflow_name;
        console.error("[DEBUG] get_workflow_details called with name:", workflowName);
        try {
            await ensureWorkflowDir();
            const sanitizedName = workflowName.replace(/[^a-z0-9_.-]/gi, '_');
            const filePath = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`));

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
    webhookId: z.string().optional().describe("Optional webhook ID for certain node types like triggers.")
});
server.tool(
    "add_node",
    addNodeParamsSchema.shape,
    async (params: z.infer<typeof addNodeParamsSchema>, _extra) => {
        console.error("[DEBUG] add_node called with:", params);
        const workflowName = params.workflow_name;
        try {
            // Attempt to reload node types if cache is empty and WORKSPACE_DIR is set by a previous call (e.g. create_workflow)
            // This helps if server started with default WORKSPACE_DIR and cache was empty.
            if (nodeInfoCache.size === 0 && WORKSPACE_DIR !== process.cwd()) {
                console.warn("[WARN] nodeInfoCache is empty in add_node. Attempting to reload based on current WORKSPACE_DIR.");
                await loadKnownNodeBaseTypes();
            }

            await ensureWorkflowDir();
            const sanitizedName = workflowName.replace(/[^a-z0-9_.-]/gi, '_');
            const filePath = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`));

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

            const { finalNodeType, finalTypeVersion } = normalizeNodeTypeAndVersion(params.node_type, params.typeVersion);
            // console.error(`[DEBUG] Node type normalized: "${params.node_type}" -> "${finalNodeType}"`); // Covered by normalizeNodeTypeAndVersion's own log

            // Process parameters for LangChain LLM nodes
            let nodeParameters = params.parameters || {};

            // Check if this is a LangChain LLM node
            const isLangChainLLM = finalNodeType.includes('@n8n/n8n-nodes-langchain') &&
                (finalNodeType.includes('lmChat') || finalNodeType.includes('llm'));

            // Apply normalization for LangChain LLM nodes
            if (isLangChainLLM) {
                console.error(`[DEBUG] Applying parameter normalization for LangChain LLM node`);
                nodeParameters = normalizeLLMParameters(nodeParameters);
            } else {
                // Handle OpenAI credentials specifically for non-LangChain nodes
                if (params.parameters?.options?.credentials?.providerType === 'openAi') {
                    console.error(`[DEBUG] Setting up proper OpenAI credentials format for standard node`);

                    // Remove credentials from options and set at node level
                    if (nodeParameters.options?.credentials) {
                        const credentialsType = nodeParameters.options.credentials.providerType;
                        delete nodeParameters.options.credentials;

                        // Set a placeholder for credentials that would be filled in the n8n UI
                        if (!nodeParameters.credentials) {
                            nodeParameters.credentials = {};
                        }

                        // Add credentials in the proper format for OpenAI
                        nodeParameters.credentials = {
                            "openAiApi": {
                                "id": generateN8nId(),
                                "name": "OpenAi account"
                            }
                        };
                    }
                }
            }

            const newNode: N8nWorkflowNode = {
                id: generateUUID(),
                type: finalNodeType,
                typeVersion: finalTypeVersion, // Use version from normalizeNodeTypeAndVersion
                position: [defaultPos.x, defaultPos.y],
                parameters: nodeParameters,
                name: params.node_name || `${finalNodeType} Node`, // Use finalNodeType for default name
                ...(params.webhookId && { webhookId: params.webhookId }) // Add webhookId if provided
            };
            workflow.nodes.push(newNode);
            await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
            console.error(`[DEBUG] Added node ${newNode.id} to workflow ${workflowName} in file ${filePath}`);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, node: newNode, workflowId: workflow.id }) }] };
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
    webhookId: z.string().optional().describe("Optional new webhook ID for the node.")
});
server.tool(
    "edit_node",
    editNodeParamsSchema.shape,
    async (params: z.infer<typeof editNodeParamsSchema>, _extra) => {
        console.error("[DEBUG] edit_node called with:", params);
        const workflowName = params.workflow_name;
        try {
            // Similar cache reload logic as in add_node
            if (nodeInfoCache.size === 0 && WORKSPACE_DIR !== process.cwd()) {
                console.warn("[WARN] nodeInfoCache is empty in edit_node. Attempting to reload based on current WORKSPACE_DIR.");
                await loadKnownNodeBaseTypes();
            }

            await ensureWorkflowDir();
            const sanitizedName = workflowName.replace(/[^a-z0-9_.-]/gi, '_');
            const filePath = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`));

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

            workflow.nodes[nodeIndex] = nodeToEdit;

            await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
            console.error(`[DEBUG] Edited node ${params.node_id} in workflow ${workflowName} in file ${filePath}`);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, node: nodeToEdit }) }] };
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
    node_id: z.string().describe("The ID of the node to delete")
});
server.tool(
    "delete_node",
    deleteNodeParamsSchema.shape,
    async (params: z.infer<typeof deleteNodeParamsSchema>, _extra) => {
        console.error("[DEBUG] delete_node called with:", params);
        const workflowName = params.workflow_name;
        try {
            await ensureWorkflowDir();
            const sanitizedName = workflowName.replace(/[^a-z0-9_.-]/gi, '_');
            const filePath = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`));

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
    target_node_input_index: z.number().optional().default(0).describe("The index for the target node's input handle (default: 0)")
});

server.tool(
    "add_connection",
    addConnectionParamsSchema.shape,
    async (params: z.infer<typeof addConnectionParamsSchema>, _extra) => {
        console.error("[DEBUG] add_connection called with:", params);
        const { workflow_name, source_node_id, source_node_output_name, target_node_id, target_node_input_name, target_node_input_index } = params;

        try {
            await ensureWorkflowDir();
            const sanitizedWorkflowName = workflow_name.replace(/[^a-z0-9_.-]/gi, '_');
            const filePath = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, `${sanitizedWorkflowName}.json`));

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

            return { content: [{ type: "text", text: JSON.stringify({ success: true, message, workflow }) }] };

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
    memory_node_id: z.string().optional().describe("The ID of the memory node (optional)")
});

server.tool(
    "add_ai_connections",
    addAIConnectionsParamsSchema.shape,
    async (params: z.infer<typeof addAIConnectionsParamsSchema>, _extra) => {
        console.error("[DEBUG] add_ai_connections called with:", params);
        const { workflow_name, agent_node_id, model_node_id, tool_node_ids, memory_node_id } = params;

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
            await ensureWorkflowDir();
            const sanitizedWorkflowName = workflow_name.replace(/[^a-z0-9_.-]/gi, '_');
            const filePath = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, `${sanitizedWorkflowName}.json`));

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

                    // Check if this connection already exists
                    const existingToolConnection = workflow.connections[toolNodeName]["ai_tool"].some(
                        conn => conn.some(detail => detail.node === agentNode.name && detail.type === "ai_tool")
                    );

                    if (!existingToolConnection) {
                        workflow.connections[toolNodeName]["ai_tool"].push([toolConnection]);
                        console.error(`[DEBUG] Added AI tool connection from ${toolNodeName} to ${agentNode.name}`);
                    } else {
                        console.error(`[DEBUG] AI tool connection from ${toolNodeName} to ${agentNode.name} already exists`);
                    }
                }
            }

            // Save the updated workflow
            await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        message: "AI connections added successfully",
                        workflow
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

// List Available Nodes
const listAvailableNodesParamsSchema = z.object({
    search_term: z.string().optional().describe("An optional search term to filter nodes by their name, type, or description.")
});

server.tool(
    "list_available_nodes",
    listAvailableNodesParamsSchema.shape,
    async (params: z.infer<typeof listAvailableNodesParamsSchema>, _extra) => {
        console.error("[DEBUG] list_available_nodes called with params:", params);
        let availableNodes: any[] = [];

        // Corrected path: relative to this script's location
        const workflowNodesDir = path.resolve(__dirname, '../workflow_nodes');

        try {
            // knownNodeBaseCasings should ideally be populated at startup by loadKnownNodeBaseTypes.
            // If it's empty here, it means initial load failed or directory wasn't found then.
            // We might not need to reload it here if startup handles it, but a check doesn't hurt.
            if (nodeInfoCache.size === 0 && WORKSPACE_DIR !== process.cwd()) {
                console.warn("[WARN] nodeInfoCache is empty in list_available_nodes. Attempting to reload node type information.");
                // For now, if cache is empty, it means startup failed to load them.
                // The function will proceed and likely return an empty list or whatever it finds if workflowNodesDir is accessible now.
            }

            console.error(`[DEBUG] Reading node definitions from server resource path: ${workflowNodesDir}`);
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
                            allParsedNodes.push({
                                nodeType: nodeDefinition.nodeType,
                                displayName: nodeDefinition.displayName,
                                description: nodeDefinition.description || "",
                                version: nodeDefinition.version || 1,
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
                const searchTermLower = params.search_term.toLowerCase();
                availableNodes = allParsedNodes.filter(node => {
                    let found = false;
                    if (node.displayName && node.displayName.toLowerCase().includes(searchTermLower)) {
                        found = true;
                    }
                    if (!found && node.nodeType && node.nodeType.toLowerCase().includes(searchTermLower)) {
                        found = true;
                    }
                    if (!found && node.description && node.description.toLowerCase().includes(searchTermLower)) {
                        found = true;
                    }
                    if (!found && node.simpleName && node.simpleName.toLowerCase().includes(searchTermLower)) {
                        found = true;
                    }
                    if (!found && node.properties && Array.isArray(node.properties)) {
                        for (const prop of node.properties) {
                            if (prop.name && prop.name.toLowerCase().includes(searchTermLower)) {
                                found = true;
                                break;
                            }
                            if (prop.displayName && prop.displayName.toLowerCase().includes(searchTermLower)) {
                                found = true;
                                break;
                            }
                            // Optionally search prop.description as well
                            // if (prop.description && prop.description.toLowerCase().includes(searchTermLower)) {
                            //     found = true;
                            //     break;
                            // }
                        }
                    }
                    if (!found && node.categories && Array.isArray(node.categories)) {
                        for (const category of node.categories) {
                            if (typeof category === 'string' && category.toLowerCase().includes(searchTermLower)) {
                                found = true;
                                break;
                            }
                        }
                    }
                    return found;
                });
                console.log(`[DEBUG] Filtered nodes by '${params.search_term}'. Found ${availableNodes.length} of ${allParsedNodes.length}.`);
            } else {
                availableNodes = allParsedNodes; // No search term, return all nodes
            }

            if (availableNodes.length === 0 && allParsedNodes.length > 0 && params.search_term) {
                console.warn(`[WARN] No nodes matched the search term: '${params.search_term}'.`);
            } else if (allParsedNodes.length === 0) {
                console.warn("[WARN] No node definitions found in workflow_nodes. Ensure the directory is populated with JSON files from the scraper.");
            }

            // Format the results to be more user-friendly and informative
            const formattedNodes = availableNodes.map(node => {
                return {
                    // Keep only the most relevant information
                    nodeType: node.nodeType, // Full node type with correct casing
                    displayName: node.displayName,
                    description: node.description,
                    simpleName: node.simpleName, // The part after n8n-nodes-base
                    categories: node.categories || [],
                    version: node.version,
                    // Count parameters but don't include details to keep response size manageable
                    parameterCount: node.properties ? node.properties.length : 0
                };
            });

            // Include usage guidance in the response
            const usageGuidance = {
                title: "Node Type Usage Guide",
                description: "When using the add_node or replace_node tools, you can specify the node type in any of these formats:",
                formats: [
                    `Full Type (with correct casing): "${formattedNodes.length > 0 ? formattedNodes[0].nodeType : 'n8n-nodes-base.nodeTypeName'}"`,
                    `Simple Name (with correct casing): "${formattedNodes.length > 0 ? formattedNodes[0].simpleName : 'nodeTypeName'}"`,
                    `Simple Name (lowercase): "${formattedNodes.length > 0 ? formattedNodes[0].simpleName.toLowerCase() : 'nodetypename'}"`
                ],
                note: "The system will automatically handle proper casing and prefixing for you based on the official node definitions."
            };

            // Return the formatted response
            return {
                content: [{
                    type: "text", text: JSON.stringify({
                        success: true,
                        nodes: formattedNodes,
                        total: formattedNodes.length,
                        usageGuidance: usageGuidance
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

