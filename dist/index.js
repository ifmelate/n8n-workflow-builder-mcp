#!/usr/bin/env node
"use strict";
// N8N Workflow Builder MCP Server
// Using the official MCP SDK as required
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const workspace_1 = require("./utils/workspace");
const id_1 = require("./utils/id");
const llm_1 = require("./utils/llm");
const versioning_1 = require("./nodes/versioning");
const cache_1 = require("./nodes/cache");
// Log initial workspace
console.error(`[DEBUG] Default workspace directory: ${(0, workspace_1.getWorkspaceDir)()}`);
// Initialize supported N8N versions and their node capabilities
// Remove in-file type/interface/utility definitions in favor of imports
// Find the best matching version for a target N8N version
// Returns exact match if available, otherwise closest lower version
function findBestMatchingVersion(targetVersion, availableVersions) {
    if (availableVersions.length === 0) {
        return null;
    }
    // Check for exact match first
    if (availableVersions.includes(targetVersion)) {
        return targetVersion;
    }
    // Parse version numbers for comparison
    const parseVersion = (version) => {
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
            }
            else if (versionPart > targetPart) {
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
let nodeInfoCache = new Map();
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
async function loadWorkflows() {
    // This function will need to be updated if list_workflows is to work with the new format.
    // For now, it's related to the old format.
    const resolvedFile = (0, workspace_1.resolvePath)(path_1.default.join(workspace_1.WORKFLOW_DATA_DIR_NAME, workspace_1.WORKFLOWS_FILE_NAME));
    try {
        await (0, workspace_1.ensureWorkflowDir)(); // Ensures dir exists, doesn't create workflows.json anymore unless called by old logic
        const data = await promises_1.default.readFile(resolvedFile, 'utf8');
        console.error("[DEBUG] Loaded workflows (old format):", data);
        return JSON.parse(data);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            console.error("[DEBUG] No workflows.json file found (old format), returning empty array");
            // If workflows.json is truly deprecated, this might try to create it.
            // For now, let's assume ensureWorkflowDir handles directory creation.
            // And if the file doesn't exist, it means no workflows (in old format).
            await promises_1.default.writeFile(resolvedFile, JSON.stringify([], null, 2)); // Create if not exists for old logic
            return [];
        }
        console.error('[ERROR] Failed to load workflows (old format):', error);
        throw error;
    }
}
async function saveWorkflows(workflows) {
    // This function is for the old format (saving an array to workflows.json).
    try {
        await (0, workspace_1.ensureWorkflowDir)();
        const resolvedFile = (0, workspace_1.resolvePath)(path_1.default.join(workspace_1.WORKFLOW_DATA_DIR_NAME, workspace_1.WORKFLOWS_FILE_NAME));
        console.error("[DEBUG] Saving workflows (old format):", JSON.stringify(workflows, null, 2));
        await promises_1.default.writeFile(resolvedFile, JSON.stringify(workflows, null, 2));
    }
    catch (error) {
        console.error('[ERROR] Failed to save workflows (old format):', error);
        throw error;
    }
}
// Create the MCP server
const server = new mcp_js_1.McpServer({
    name: "n8n-workflow-builder",
    version: "1.0.0"
});
// Tool definitions
// Create Workflow
const createWorkflowParamsSchema = zod_1.z.object({
    workflow_name: zod_1.z.string().describe("The name for the new workflow"),
    workspace_dir: zod_1.z.string().describe("Absolute path to the project root directory where workflow_data will be stored")
});
server.tool("create_workflow", createWorkflowParamsSchema.shape, async (params, _extra) => {
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
        const stat = await promises_1.default.stat(workspaceDir);
        if (!stat.isDirectory()) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Provided 'workspace_dir' is not a directory." }) }] };
        }
        // Check if the workspaceDir is the root directory
        if (path_1.default.resolve(workspaceDir) === path_1.default.resolve('/')) {
            console.error("[ERROR] 'workspace_dir' cannot be the root directory ('/'). Please specify a valid project subdirectory.");
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "'workspace_dir' cannot be the root directory. Please specify a project subdirectory." }) }] };
        }
        (0, workspace_1.setWorkspaceDir)(workspaceDir);
        await (0, workspace_1.ensureWorkflowDir)(); // Ensures WORKFLOW_DATA_DIR_NAME exists
        const newN8nWorkflow = {
            name: workflowName,
            id: (0, id_1.generateN8nId)(), // e.g., "Y6sBMxxyJQtgCCBQ"
            nodes: [], // Initialize with empty nodes array
            connections: {}, // Initialize with empty connections object
            active: false,
            pinData: {},
            settings: {
                executionOrder: "v1"
            },
            versionId: (0, id_1.generateUUID)(),
            meta: {
                instanceId: (0, id_1.generateInstanceId)()
            },
            tags: []
        };
        // Sanitize workflowName for filename or ensure it's safe.
        // For now, using directly. Consider a sanitization function for production.
        const filename = `${workflowName.replace(/[^a-z0-9_.-]/gi, '_')}.json`;
        const filePath = (0, workspace_1.resolvePath)(path_1.default.join(workspace_1.WORKFLOW_DATA_DIR_NAME, filename));
        await promises_1.default.writeFile(filePath, JSON.stringify(newN8nWorkflow, null, 2));
        console.error("[DEBUG] Workflow created and saved to:", filePath);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, workflow: newN8nWorkflow, recommended_next_step: "Call 'list_available_nodes' before adding nodes. Use 'search_term' (e.g., 'langchain') to find AI nodes." }) }] };
    }
    catch (error) {
        console.error("[ERROR] Failed to create workflow:", error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to create workflow: " + error.message }) }] };
    }
});
// List Workflows
// NOTE: This tool reads individual .json files from the workflow_data directory.
const listWorkflowsParamsSchema = zod_1.z.object({
    limit: zod_1.z.number().int().positive().max(1000).optional().describe("Maximum number of workflows to return"),
    cursor: zod_1.z.string().optional().describe("Opaque cursor for pagination; pass back to get the next page")
});
server.tool("list_workflows", listWorkflowsParamsSchema.shape, async (params, _extra) => {
    console.error("[DEBUG] list_workflows called - (current impl uses old format and might be broken)");
    try {
        // This implementation needs to change to scan directory for .json files
        // and aggregate them. For now, it will likely fail or return empty
        // if workflows.json doesn't exist or is empty.
        await (0, workspace_1.ensureWorkflowDir)(); // Ensures directory exists
        const workflowDataDir = (0, workspace_1.resolvePath)(workspace_1.WORKFLOW_DATA_DIR_NAME);
        const files = await promises_1.default.readdir(workflowDataDir);
        const workflowFiles = files.filter(file => file.endsWith('.json') && file !== workspace_1.WORKFLOWS_FILE_NAME);
        const workflows = [];
        for (const file of workflowFiles) {
            try {
                const data = await promises_1.default.readFile(path_1.default.join(workflowDataDir, file), 'utf8');
                workflows.push(JSON.parse(data));
            }
            catch (err) {
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
    }
    catch (error) {
        console.error("[ERROR] Failed to list workflows:", error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to list workflows: " + error.message }) }] };
    }
});
// Get Workflow Details
// NOTE: This tool will need to be updated. It currently assumes workflow_id is
// an ID found in the old workflows.json structure. It should now probably
// expect workflow_id to be the workflow name (to form the filename) or the new N8n ID.
const getWorkflowDetailsParamsSchema = zod_1.z.object({
    workflow_name: zod_1.z.string().describe("The Name of the workflow to get details for"),
    workflow_path: zod_1.z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});
server.tool("get_workflow_details", getWorkflowDetailsParamsSchema.shape, async (params, _extra) => {
    const workflowName = params.workflow_name;
    console.error("[DEBUG] get_workflow_details called with name:", workflowName);
    try {
        const filePath = (0, workspace_1.resolveWorkflowPath)(workflowName, params.workflow_path);
        // Only ensure the default workflow directory if using standard approach
        if (!params.workflow_path) {
            await (0, workspace_1.ensureWorkflowDir)();
        }
        else {
            // Ensure the parent directory of the custom workflow file exists
            await (0, workspace_1.ensureWorkflowParentDir)(filePath);
        }
        try {
            const data = await promises_1.default.readFile(filePath, 'utf8');
            const workflow = JSON.parse(data);
            console.error("[DEBUG] Found workflow by name in file:", filePath);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, workflow }) }] };
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`[DEBUG] Workflow file ${filePath} not found using name: ${workflowName}.`);
                return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Workflow with name ${workflowName} not found` }) }] };
            }
            else {
                throw error; // Re-throw other read errors
            }
        }
    }
    catch (error) {
        console.error("[ERROR] Failed to get workflow details:", error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to get workflow details: " + error.message }) }] };
    }
});
// Add Node
// NOTE: This tool will need significant updates to load the specific workflow file,
// add the node to its 'nodes' array, and save the file.
const addNodeParamsSchema = zod_1.z.object({
    workflow_name: zod_1.z.string().describe("The Name of the workflow to add the node to"),
    node_type: zod_1.z.string().describe("The type of node to add (e.g., 'gmail', 'slack', 'openAi'). You can specify with or without the 'n8n-nodes-base.' prefix. The system will handle proper casing (e.g., 'openai' will be converted to 'openAi' if that's the correct casing)."),
    position: zod_1.z.object({
        x: zod_1.z.number(),
        y: zod_1.z.number()
    }).optional().describe("The position of the node {x,y} - will be converted to [x,y] for N8nWorkflowNode"),
    parameters: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional().describe("The parameters for the node"),
    node_name: zod_1.z.string().optional().describe("The name for the new node (e.g., 'My Gmail Node')"),
    typeVersion: zod_1.z.number().optional().describe("The type version for the node (e.g., 1, 1.1). Defaults to 1 if not specified."),
    webhookId: zod_1.z.string().optional().describe("Optional webhook ID for certain node types like triggers."),
    workflow_path: zod_1.z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});
server.tool("add_node", addNodeParamsSchema.shape, async (params, _extra) => {
    console.error("[DEBUG] add_node called with:", params);
    const workflowName = params.workflow_name;
    try {
        // Attempt to reload node types if cache is empty and workspace changed
        if ((0, cache_1.getNodeInfoCache)().size === 0 && (0, workspace_1.getWorkspaceDir)() !== process.cwd()) {
            console.warn("[WARN] nodeInfoCache is empty in add_node. Attempting to reload based on current WORKSPACE_DIR.");
            await (0, cache_1.loadKnownNodeBaseTypes)();
        }
        const filePath = (0, workspace_1.resolveWorkflowPath)(workflowName, params.workflow_path);
        // Only ensure the default workflow directory if using standard approach
        if (!params.workflow_path) {
            await (0, workspace_1.ensureWorkflowDir)();
        }
        else {
            // Ensure the parent directory of the custom workflow file exists
            await (0, workspace_1.ensureWorkflowParentDir)(filePath);
        }
        let workflow;
        try {
            const data = await promises_1.default.readFile(filePath, 'utf8');
            workflow = JSON.parse(data);
        }
        catch (readError) {
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
        const { finalNodeType, finalTypeVersion } = (0, cache_1.normalizeNodeTypeAndVersion)(params.node_type, params.typeVersion);
        // Check if node type is supported in current N8N version
        if (!(0, cache_1.isNodeTypeSupported)(finalNodeType, finalTypeVersion)) {
            const supportedVersions = (0, versioning_1.getN8nVersionInfo)()?.supportedNodes.get(finalNodeType);
            const supportedVersionsList = supportedVersions ? Array.from(supportedVersions).join(', ') : 'none';
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: `Node type '${finalNodeType}' version ${finalTypeVersion} is not supported in N8N version ${(0, versioning_1.getCurrentN8nVersion)()}. Supported versions: ${supportedVersionsList}. Check 'list_available_nodes' for compatible alternatives or set N8N_VERSION environment variable.`
                        })
                    }]
            };
        }
        // Process parameters for LangChain LLM nodes
        let nodeParameters = params.parameters || {};
        // Check if this is a LangChain LLM node
        const isLangChainLLM = finalNodeType.includes('@n8n/n8n-nodes-langchain') &&
            (finalNodeType.includes('lmChat') || finalNodeType.includes('llm'));
        // Apply normalization for LangChain LLM nodes
        if (isLangChainLLM) {
            console.error(`[DEBUG] Applying parameter normalization for LangChain LLM node`);
            nodeParameters = (0, llm_1.normalizeLLMParameters)(nodeParameters);
        }
        else {
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
                            "id": (0, id_1.generateN8nId)(),
                            "name": "OpenAi account"
                        }
                    };
                }
            }
        }
        const newNode = {
            id: (0, id_1.generateUUID)(),
            type: finalNodeType,
            typeVersion: finalTypeVersion, // Use version from normalizeNodeTypeAndVersion
            position: [defaultPos.x, defaultPos.y],
            parameters: nodeParameters,
            name: params.node_name || `${finalNodeType} Node`, // Use finalNodeType for default name
            ...(params.webhookId && { webhookId: params.webhookId }) // Add webhookId if provided
        };
        workflow.nodes.push(newNode);
        await promises_1.default.writeFile(filePath, JSON.stringify(workflow, null, 2));
        console.error(`[DEBUG] Added node ${newNode.id} to workflow ${workflowName} in file ${filePath}`);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, node: newNode, workflowId: workflow.id }) }] };
    }
    catch (error) {
        console.error("[ERROR] Failed to add node:", error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to add node: " + error.message }) }] };
    }
});
// Edit Node
// NOTE: This tool also needs updates for single-file workflow management.
const editNodeParamsSchema = zod_1.z.object({
    workflow_name: zod_1.z.string().describe("The Name of the workflow containing the node"),
    node_id: zod_1.z.string().describe("The ID of the node to edit"),
    node_type: zod_1.z.string().optional().describe("The new type for the node (e.g., 'gmail', 'slack', 'openAi'). You can specify with or without the 'n8n-nodes-base.' prefix. The system will handle proper casing (e.g., 'openai' will be converted to 'openAi' if that's the correct casing)."),
    node_name: zod_1.z.string().optional().describe("The new name for the node"),
    position: zod_1.z.object({
        x: zod_1.z.number(),
        y: zod_1.z.number()
    }).optional().describe("The new position {x,y} - will be converted to [x,y]"),
    parameters: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional().describe("The new parameters"),
    typeVersion: zod_1.z.number().optional().describe("The new type version for the node"),
    webhookId: zod_1.z.string().optional().describe("Optional new webhook ID for the node."),
    workflow_path: zod_1.z.string().optional().describe("Optional workflow path to the workflow file")
});
server.tool("edit_node", editNodeParamsSchema.shape, async (params, _extra) => {
    console.error("[DEBUG] edit_node called with:", params);
    const workflowName = params.workflow_name;
    try {
        // Similar cache reload logic as in add_node
        if ((0, cache_1.getNodeInfoCache)().size === 0 && (0, workspace_1.getWorkspaceDir)() !== process.cwd()) {
            console.warn("[WARN] nodeInfoCache is empty in edit_node. Attempting to reload based on current WORKSPACE_DIR.");
            await (0, cache_1.loadKnownNodeBaseTypes)();
        }
        const filePath = (0, workspace_1.resolveWorkflowPath)(workflowName, params.workflow_path);
        // Only ensure the default workflow directory if using standard approach
        if (!params.workflow_path) {
            await (0, workspace_1.ensureWorkflowDir)();
        }
        else {
            // Ensure the parent directory of the custom workflow file exists
            await (0, workspace_1.ensureWorkflowParentDir)(filePath);
        }
        let workflow;
        try {
            const data = await promises_1.default.readFile(filePath, 'utf8');
            workflow = JSON.parse(data);
        }
        catch (readError) {
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
            const { finalNodeType, finalTypeVersion: determinedVersionForNewType } = (0, cache_1.normalizeNodeTypeAndVersion)(params.node_type, params.typeVersion);
            newType = finalNodeType;
            newTypeVersion = determinedVersionForNewType; // This uses params.typeVersion if valid, else default for new type.
        }
        else if (params.typeVersion !== undefined && !isNaN(Number(params.typeVersion))) {
            // Only typeVersion is being changed, node_type remains the same.
            newTypeVersion = Number(params.typeVersion);
        }
        else if (params.typeVersion !== undefined && isNaN(Number(params.typeVersion))) {
            console.warn(`[WARN] Provided typeVersion '${params.typeVersion}' for editing node ${nodeToEdit.id} is NaN. typeVersion will not be changed.`);
        }
        nodeToEdit.type = newType;
        nodeToEdit.typeVersion = newTypeVersion;
        if (params.node_name)
            nodeToEdit.name = params.node_name;
        if (params.position)
            nodeToEdit.position = [params.position.x, params.position.y];
        // Process new parameters if provided
        if (params.parameters) {
            let newParameters = params.parameters;
            // Check if this is a LangChain LLM node
            const isLangChainLLM = newType.includes('@n8n/n8n-nodes-langchain') &&
                (newType.includes('lmChat') || newType.includes('llm'));
            // Apply normalization for LangChain LLM nodes
            if (isLangChainLLM) {
                console.error(`[DEBUG] Applying parameter normalization for LangChain LLM node during edit`);
                newParameters = (0, llm_1.normalizeLLMParameters)(newParameters);
            }
            else {
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
                                "id": (0, id_1.generateN8nId)(),
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
            }
            else {
                nodeToEdit.webhookId = params.webhookId;
            }
        }
        workflow.nodes[nodeIndex] = nodeToEdit;
        await promises_1.default.writeFile(filePath, JSON.stringify(workflow, null, 2));
        console.error(`[DEBUG] Edited node ${params.node_id} in workflow ${workflowName} in file ${filePath}`);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, node: nodeToEdit }) }] };
    }
    catch (error) {
        console.error("[ERROR] Failed to edit node:", error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to edit node: " + error.message }) }] };
    }
});
// Delete Node
// NOTE: This tool also needs updates for single-file workflow management.
const deleteNodeParamsSchema = zod_1.z.object({
    workflow_name: zod_1.z.string().describe("The Name of the workflow containing the node"),
    node_id: zod_1.z.string().describe("The ID of the node to delete"),
    workflow_path: zod_1.z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});
server.tool("delete_node", deleteNodeParamsSchema.shape, async (params, _extra) => {
    console.error("[DEBUG] delete_node called with:", params);
    const workflowName = params.workflow_name;
    try {
        const filePath = (0, workspace_1.resolveWorkflowPath)(workflowName, params.workflow_path);
        // Only ensure the default workflow directory if using standard approach
        if (!params.workflow_path) {
            await (0, workspace_1.ensureWorkflowDir)();
        }
        else {
            // Ensure the parent directory of the custom workflow file exists
            await (0, workspace_1.ensureWorkflowParentDir)(filePath);
        }
        let workflow;
        try {
            const data = await promises_1.default.readFile(filePath, 'utf8');
            workflow = JSON.parse(data);
        }
        catch (readError) {
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
        const newConnections = {};
        for (const sourceNodeName in workflow.connections) {
            if (sourceNodeName === deletedNodeName)
                continue; // Skip connections FROM the deleted node
            const outputConnections = workflow.connections[sourceNodeName];
            const newOutputConnectionsForSource = {};
            for (const outputKey in outputConnections) {
                const connectionChains = outputConnections[outputKey];
                const newConnectionChains = [];
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
        await promises_1.default.writeFile(filePath, JSON.stringify(workflow, null, 2));
        console.error(`[DEBUG] Deleted node ${params.node_id} from workflow ${workflowName} in file ${filePath}`);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `Node ${params.node_id} deleted successfully from workflow ${workflowName}` }) }] };
    }
    catch (error) {
        console.error("[ERROR] Failed to delete node:", error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to delete node: " + error.message }) }] };
    }
});
// Add Connection
const addConnectionParamsSchema = zod_1.z.object({
    workflow_name: zod_1.z.string().describe("The Name of the workflow to add the connection to"),
    source_node_id: zod_1.z.string().describe("The ID of the source node for the connection"),
    source_node_output_name: zod_1.z.string().describe("The name of the output handle on the source node (e.g., 'main')"),
    target_node_id: zod_1.z.string().describe("The ID of the target node for the connection"),
    target_node_input_name: zod_1.z.string().describe("The name of the input handle on the target node (e.g., 'main')"),
    target_node_input_index: zod_1.z.number().optional().default(0).describe("The index for the target node's input handle (default: 0)")
});
server.tool("add_connection", addConnectionParamsSchema.shape, async (params, _extra) => {
    console.error("[DEBUG] add_connection called with:", params);
    const { workflow_name, source_node_id, source_node_output_name, target_node_id, target_node_input_name, target_node_input_index } = params;
    try {
        await (0, workspace_1.ensureWorkflowDir)();
        const sanitizedWorkflowName = workflow_name.replace(/[^a-z0-9_.-]/gi, '_');
        const filePath = (0, workspace_1.resolvePath)(path_1.default.join(workspace_1.WORKFLOW_DATA_DIR_NAME, `${sanitizedWorkflowName}.json`));
        let workflow;
        try {
            const data = await promises_1.default.readFile(filePath, 'utf8');
            workflow = JSON.parse(data);
        }
        catch (readError) {
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
                && targetNode.type.includes('agent')) {
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
        const newConnectionObject = {
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
        await promises_1.default.writeFile(filePath, JSON.stringify(workflow, null, 2));
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
    }
    catch (error) {
        console.error("[ERROR] Failed to add connection:", error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to add connection: " + error.message }) }] };
    }
});
// Add AI Connections (special case for LangChain nodes)
const addAIConnectionsParamsSchema = zod_1.z.object({
    workflow_name: zod_1.z.string().describe("The Name of the workflow to add the AI connections to"),
    agent_node_id: zod_1.z.string().describe("The ID of the agent node that will use the model and tools"),
    model_node_id: zod_1.z.string().optional().describe("The ID of the language model node (optional)"),
    tool_node_ids: zod_1.z.array(zod_1.z.string()).optional().describe("Array of tool node IDs to connect to the agent (optional)"),
    memory_node_id: zod_1.z.string().optional().describe("The ID of the memory node (optional)")
});
server.tool("add_ai_connections", addAIConnectionsParamsSchema.shape, async (params, _extra) => {
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
        await (0, workspace_1.ensureWorkflowDir)();
        const sanitizedWorkflowName = workflow_name.replace(/[^a-z0-9_.-]/gi, '_');
        const filePath = (0, workspace_1.resolvePath)(path_1.default.join(workspace_1.WORKFLOW_DATA_DIR_NAME, `${sanitizedWorkflowName}.json`));
        let workflow;
        try {
            const data = await promises_1.default.readFile(filePath, 'utf8');
            workflow = JSON.parse(data);
        }
        catch (readError) {
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
        const toolNodes = [];
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
            const modelConnection = {
                node: agentNode.name,
                type: "ai_languageModel",
                index: 0
            };
            // Check if this connection already exists
            const existingModelConnection = workflow.connections[modelNodeName]["ai_languageModel"].some(conn => conn.some(detail => detail.node === agentNode.name && detail.type === "ai_languageModel"));
            if (!existingModelConnection) {
                workflow.connections[modelNodeName]["ai_languageModel"].push([modelConnection]);
                console.error(`[DEBUG] Added AI language model connection from ${modelNodeName} to ${agentNode.name}`);
            }
            else {
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
            const memoryConnection = {
                node: agentNode.name,
                type: "ai_memory",
                index: 0
            };
            // Check if this connection already exists
            const existingMemoryConnection = workflow.connections[memoryNodeName]["ai_memory"].some(conn => conn.some(detail => detail.node === agentNode.name && detail.type === "ai_memory"));
            if (!existingMemoryConnection) {
                workflow.connections[memoryNodeName]["ai_memory"].push([memoryConnection]);
                console.error(`[DEBUG] Added AI memory connection from ${memoryNodeName} to ${agentNode.name}`);
            }
            else {
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
                const toolConnection = {
                    node: agentNode.name,
                    type: "ai_tool",
                    index: 0
                };
                // Check if this connection already exists
                const existingToolConnection = workflow.connections[toolNodeName]["ai_tool"].some(conn => conn.some(detail => detail.node === agentNode.name && detail.type === "ai_tool"));
                if (!existingToolConnection) {
                    workflow.connections[toolNodeName]["ai_tool"].push([toolConnection]);
                    console.error(`[DEBUG] Added AI tool connection from ${toolNodeName} to ${agentNode.name}`);
                }
                else {
                    console.error(`[DEBUG] AI tool connection from ${toolNodeName} to ${agentNode.name} already exists`);
                }
            }
        }
        // Save the updated workflow
        await promises_1.default.writeFile(filePath, JSON.stringify(workflow, null, 2));
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
    }
    catch (error) {
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
});
// List Available Nodes
const listAvailableNodesParamsSchema = zod_1.z.object({
    search_term: zod_1.z.string().optional().describe("An optional search term to filter nodes by their name, type, or description."),
    n8n_version: zod_1.z.string().optional().describe("Filter nodes by N8N version compatibility. If not provided, uses current configured N8N version."),
    limit: zod_1.z.number().int().positive().max(1000).optional().describe("Maximum number of nodes to return"),
    cursor: zod_1.z.string().optional().describe("Opaque cursor for pagination; pass back to get the next page")
});
server.tool("list_available_nodes", listAvailableNodesParamsSchema.shape, async (params, _extra) => {
    console.error("[DEBUG] list_available_nodes called with params:", params);
    let availableNodes = [];
    // Root directory that contains either JSON files or versioned subdirectories
    // When compiled, this file lives in dist, so workflow_nodes is one level up
    const workflowNodesRootDir = path_1.default.resolve(__dirname, '../workflow_nodes');
    // We'll compute an "effective" version to use both for reading files and filtering
    let effectiveVersion = params.n8n_version || (0, versioning_1.getCurrentN8nVersion)() || undefined;
    const hasExplicitVersion = !!params.n8n_version && params.n8n_version.trim() !== '';
    try {
        // knownNodeBaseCasings should ideally be populated at startup by loadKnownNodeBaseTypes.
        // If it's empty here, it means initial load failed or directory wasn't found then.
        // We might not need to reload it here if startup handles it, but a check doesn't hurt.
        if ((0, cache_1.getNodeInfoCache)().size === 0 && (0, workspace_1.getWorkspaceDir)() !== process.cwd()) {
            console.warn("[WARN] nodeInfoCache is empty in list_available_nodes. Attempting to reload node type information.");
            // For now, if cache is empty, it means startup failed to load them.
            // The function will proceed and likely return an empty list or whatever it finds if workflowNodesDir is accessible now.
        }
        // Determine if we have versioned subdirectories and pick the exact version directory when available
        let workflowNodesDir = workflowNodesRootDir;
        try {
            const entries = await promises_1.default.readdir(workflowNodesRootDir, { withFileTypes: true });
            const versionDirs = entries.filter(e => e.isDirectory?.() === true).map(e => e.name);
            if (versionDirs.length > 0) {
                const targetVersion = params.n8n_version || (0, versioning_1.getCurrentN8nVersion)();
                if (targetVersion && versionDirs.includes(targetVersion)) {
                    workflowNodesDir = path_1.default.join(workflowNodesRootDir, targetVersion);
                    effectiveVersion = targetVersion;
                }
                else if (!targetVersion) {
                    // No target specified: choose highest semver directory
                    const parse = (v) => v.split('.').map(n => parseInt(n, 10) || 0);
                    versionDirs.sort((a, b) => {
                        const [a0, a1, a2] = parse(a);
                        const [b0, b1, b2] = parse(b);
                        if (a0 !== b0)
                            return b0 - a0;
                        if (a1 !== b1)
                            return b1 - a1;
                        return b2 - a2;
                    });
                    workflowNodesDir = path_1.default.join(workflowNodesRootDir, versionDirs[0]);
                    effectiveVersion = versionDirs[0];
                }
                else {
                    // Exact version requested but not found; keep root to avoid false empty, but log a clear warning
                    console.warn(`[WARN] Requested N8N version directory '${targetVersion}' not found under workflow_nodes. Available: ${versionDirs.join(', ')}`);
                    // Fallback: if there is a latest dir, use it so we still return something
                    const parse = (v) => v.split('.').map(n => parseInt(n, 10) || 0);
                    versionDirs.sort((a, b) => {
                        const [a0, a1, a2] = parse(a);
                        const [b0, b1, b2] = parse(b);
                        if (a0 !== b0)
                            return b0 - a0;
                        if (a1 !== b1)
                            return b1 - a1;
                        return b2 - a2;
                    });
                    workflowNodesDir = path_1.default.join(workflowNodesRootDir, versionDirs[0]);
                    effectiveVersion = versionDirs[0];
                }
            }
        }
        catch {
            // If reading entries fails, fall back to root and let the next readdir handle errors
        }
        console.error(`[DEBUG] Reading node definitions from: ${workflowNodesDir}`);
        const files = await promises_1.default.readdir(workflowNodesDir);
        const suffix = ".json";
        const allParsedNodes = []; // Temporary array to hold all nodes before filtering
        for (const file of files) {
            if (file.endsWith(suffix) && file !== workspace_1.WORKFLOWS_FILE_NAME /* ignore old combined file */) {
                const filePath = path_1.default.join(workflowNodesDir, file);
                try {
                    const fileContent = await promises_1.default.readFile(filePath, 'utf8');
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
                    }
                    else {
                        console.warn(`[WARN] File ${file} does not seem to be a valid node definition. Skipping.`);
                    }
                }
                catch (parseError) {
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
        }
        else {
            availableNodes = allParsedNodes; // No search term, return all nodes
        }
        // Additional sensitive diagnostic log for search inputs and derived counts
        try {
            const { sensitiveLogger } = require('./utils/logger');
            sensitiveLogger.debug(`list_available_nodes diagnostics: search_term='${params.search_term || ''}', totalParsed=${allParsedNodes.length}, matched=${availableNodes.length}`);
        }
        catch { }
        if (availableNodes.length === 0 && allParsedNodes.length > 0 && params.search_term) {
            console.warn(`[WARN] No nodes matched the search term: '${params.search_term}'.`);
        }
        else if (allParsedNodes.length === 0) {
            console.warn("[WARN] No node definitions found in workflow_nodes. Ensure the directory is populated with JSON files from the scraper.");
        }
        // Filter by N8N version compatibility if specified
        const targetVersion = effectiveVersion || undefined;
        let versionFilteredNodes = availableNodes;
        if (targetVersion && targetVersion !== 'latest') {
            versionFilteredNodes = availableNodes.filter(node => {
                // Check if node is supported in the target N8N version
                const targetVersionInfo = (0, versioning_1.getSupportedN8nVersions)().get(targetVersion);
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
                const nodeVersions = Array.isArray(node.version) ? node.version : [node.version];
                return nodeVersions.some((v) => supportedVersions.has(v));
            });
            console.error(`[DEBUG] Filtered ${availableNodes.length} nodes to ${versionFilteredNodes.length} compatible with N8N ${targetVersion}`);
        }
        // Format the results to be more user-friendly and informative
        const formattedNodes = versionFilteredNodes.map(node => {
            const targetVersionInfo = (0, versioning_1.getSupportedN8nVersions)().get(targetVersion || (0, versioning_1.getCurrentN8nVersion)() || "1.30.0");
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
        // Apply pagination
        const startIndex = params?.cursor ? Number(params.cursor) || 0 : 0;
        const limit = params?.limit ?? formattedNodes.length;
        const page = formattedNodes.slice(startIndex, startIndex + limit);
        const nextIndex = startIndex + limit;
        const nextCursor = nextIndex < formattedNodes.length ? String(nextIndex) : null;
        // Return the formatted response
        return {
            content: [{
                    type: "text", text: JSON.stringify({
                        success: true,
                        nodes: page,
                        total: formattedNodes.length,
                        nextCursor,
                        filteredFor: targetVersion ? `N8N ${targetVersion}` : "All versions",
                        currentN8nVersion: targetVersion || (0, versioning_1.getCurrentN8nVersion)(),
                        usageGuidance: usageGuidance
                    })
                }]
        };
    }
    catch (error) {
        console.error("[ERROR] Failed to list available nodes:", error);
        if (error.code === 'ENOENT') {
            console.warn("[WARN] workflow_nodes directory not found. Cannot list available nodes.");
            return { content: [{ type: "text", text: JSON.stringify({ success: true, nodes: [], message: "workflow_nodes directory not found." }) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to list available nodes: " + error.message }) }] };
    }
});
// N8N Version Management Tools
// Get N8N Version Info
server.tool("get_n8n_version_info", {}, async (_params, _extra) => {
    console.error("[DEBUG] get_n8n_version_info called");
    try {
        const supportedVersionsList = Array.from((0, versioning_1.getSupportedN8nVersions)().keys()).sort((a, b) => parseFloat(b) - parseFloat(a));
        const currentInfo = (0, versioning_1.getN8nVersionInfo)() ? {
            version: (0, versioning_1.getCurrentN8nVersion)(),
            capabilities: (0, versioning_1.getN8nVersionInfo)().capabilities,
            supportedNodesCount: (0, versioning_1.getN8nVersionInfo)().supportedNodes.size
        } : null;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        currentVersion: (0, versioning_1.getCurrentN8nVersion)(),
                        currentVersionInfo: currentInfo,
                        supportedVersions: supportedVersionsList,
                        versionSource: process.env.N8N_VERSION ? "environment_override" :
                            (process.env.N8N_API_URL ? "api_detection" : "default"),
                        capabilities: (0, versioning_1.getN8nVersionInfo)()?.capabilities || []
                    })
                }]
        };
    }
    catch (error) {
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
});
// Create and configure the transport
const transport = new stdio_js_1.StdioServerTransport();
// Start the server
async function main() {
    try {
        // Note: loadKnownNodeBaseTypes uses resolvePath, which depends on WORKSPACE_DIR.
        // WORKSPACE_DIR is typically set by create_workflow. 
        // If called before create_workflow, it might use process.cwd() or fail if workflow_nodes isn't there.
        // This is a known limitation for now; ideally, WORKSPACE_DIR is configured at MCP server init more globally.
        await (0, cache_1.loadKnownNodeBaseTypes)(); // Attempt to load node types at startup
        await (0, versioning_1.initializeN8nVersionSupport)(); // Initialize N8N version support
        const detectedVersion = await (0, versioning_1.detectN8nVersion)(); // Detect the current N8N version
        await (0, versioning_1.setN8nVersion)(detectedVersion || "1.30.0"); // Set the current N8N version
        await server.connect(transport);
        console.error("[DEBUG] N8N Workflow Builder MCP Server started (TypeScript version)");
        // Debugging tool schemas might need update if params changed significantly for other tools
        const toolSchemasForDebug = {
            create_workflow: createWorkflowParamsSchema,
            list_workflows: zod_1.z.object({}), // Updated to reflect empty params
            get_workflow_details: getWorkflowDetailsParamsSchema,
            add_node: addNodeParamsSchema,
            edit_node: editNodeParamsSchema,
            delete_node: deleteNodeParamsSchema,
            add_connection: addConnectionParamsSchema
        };
        const manuallyConstructedToolList = Object.entries(toolSchemasForDebug).map(([name, schema]) => {
            let toolDefinition = { name };
            // Attempt to get description from the schema if available, or use a default.
            // Note: .describe() on Zod schemas is for properties, not usually the whole schema for tool description.
            // The description passed in the options object to server.tool() is what the MCP client sees.
            // This reconstruction is for local debugging of what the SDK *might* send.
            if (name === "create_workflow")
                toolDefinition.description = "Create a new n8n workflow";
            else if (name === "list_workflows")
                toolDefinition.description = "List all n8n workflows";
            else if (name === "get_workflow_details")
                toolDefinition.description = "Get details of a specific n8n workflow";
            else if (name === "add_node")
                toolDefinition.description = "Add a new node to a workflow";
            else if (name === "edit_node")
                toolDefinition.description = "Edit an existing node in a workflow";
            else if (name === "delete_node")
                toolDefinition.description = "Delete a node from a workflow";
            else if (name === "add_connection")
                toolDefinition.description = "Add a new connection between nodes in a workflow";
            else
                toolDefinition.description = `Description for ${name}`;
            if (schema) {
                // This is a simplified mock of how zod-to-json-schema might convert it
                // Actual conversion by SDK might be more complex.
                const properties = {};
                const required = [];
                const shape = schema.shape;
                for (const key in shape) {
                    const field = shape[key];
                    properties[key] = { type: field._def.typeName.replace('Zod', '').toLowerCase(), description: field.description };
                    if (!field.isOptional()) {
                        required.push(key);
                    }
                }
                toolDefinition.inputSchema = { type: "object", properties, required };
            }
            else {
                toolDefinition.inputSchema = { type: "object", properties: {}, required: [] };
            }
            return toolDefinition;
        });
        console.error("[DEBUG] Server's expected 'tools' array for tools/list response (with detailed inputSchemas):");
        console.error(JSON.stringify(manuallyConstructedToolList, null, 2));
        // Keep the process alive
        return new Promise((resolve, reject) => {
            process.on('SIGINT', () => {
                console.error("[DEBUG] Received SIGINT, shutting down...");
                server.close().then(resolve).catch(reject);
            });
            process.on('SIGTERM', () => {
                console.error("[DEBUG] Received SIGTERM, shutting down...");
                server.close().then(resolve).catch(reject);
            });
        });
    }
    catch (error) {
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
