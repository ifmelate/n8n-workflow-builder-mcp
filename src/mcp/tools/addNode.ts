import { z } from 'zod';
import { promises as fs } from 'fs';
import { ToolNames } from '../../utils/constants.js';
import {
    resolveWorkflowPath,
    tryDetectWorkspaceForName,
    ensureWorkflowParentDir,
    getWorkspaceDir
} from '../../utils/workspace.js';
import {
    getNodeInfoCache,
    loadKnownNodeBaseTypes,
    normalizeNodeTypeAndVersion,
    isNodeTypeSupported
} from '../../nodes/cache.js';
import { getCurrentN8nVersion, getN8nVersionInfo } from '../../nodes/versioning.js';
import { normalizeLLMParameters } from '../../utils/llm.js';
import { generateN8nId, generateUUID } from '../../utils/id.js';
import { loadNodeTypesForCurrentVersion } from '../../validation/nodeTypesLoader.js';
import { validateAndNormalizeWorkflow } from '../../validation/workflowValidator.js';
import type { N8nWorkflow, N8nWorkflowNode } from '../../types/n8n.js';
import path from 'path';

export const toolName = ToolNames.add_node;
export const description = "Add a node to an n8n workflow";

export const paramsSchema = z.object({
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

export type Params = z.infer<typeof paramsSchema>;

export type Result = {
    content: Array<{
        type: "text";
        text: string;
    }>;
};

// Build a node-scoped validation summary from a full workflow validation report
function buildLocalValidation(report: any, nodeName: string) {
    const allErrors = Array.isArray(report?.errors) ? report.errors : [];
    const allWarnings = Array.isArray(report?.warnings) ? report.warnings : [];
    const nodeErrors = allErrors.filter((e: any) => e && e.nodeName === nodeName);
    const nodeWarnings = allWarnings.filter((w: any) => w && w.nodeName === nodeName);
    const nodeIssuesArr: any[] | undefined = report?.nodeIssues?.[nodeName];
    const blockingIssues = Array.isArray(nodeIssuesArr)
        ? nodeIssuesArr.filter((iss: any) => iss && iss.code && iss.code !== 'missing_credentials')
        : [];
    const ok = nodeErrors.length === 0 && blockingIssues.length === 0;
    const nodeIssues = nodeIssuesArr ? { [nodeName]: nodeIssuesArr } : undefined;
    return { ok, errors: nodeErrors, warnings: nodeWarnings, nodeIssues };
}

export const handler = async (params: Params, _extra: any): Promise<Result> => {
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
            const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../../../workflow_nodes'), getCurrentN8nVersion());
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
        // Pre-validate before persisting (node-scoped only; do not fail on unrelated issues)
        try {
            const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../../../workflow_nodes'), getCurrentN8nVersion());
            const tentative = { ...workflow, nodes: [...workflow.nodes, newNode] };
            const preReport = validateAndNormalizeWorkflow(tentative as any, nodeTypes);
            const local = buildLocalValidation(preReport, newNode.name);
            console.error('[DEBUG] add_node local pre-validation:', local);
            // Do not block on validation here; only informational. Full validation is in validate_workflow tool.
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
        // Validate after modification (node-scoped only)
        try {
            const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../../../workflow_nodes'), getCurrentN8nVersion());
            const report = validateAndNormalizeWorkflow(workflow as any, nodeTypes);
            const local = buildLocalValidation(report, newNode.name);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, node: newNode, workflowId: workflow.id, createdConnections, localValidation: local }) }] };
        } catch (e: any) {
            console.warn('[WARN] Validation step errored after add_node:', e?.message || e);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, node: newNode, workflowId: workflow.id, createdConnections }) }] };
        }
    } catch (error: any) {
        console.error("[ERROR] Failed to add node:", error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to add node: " + error.message }) }] };
    }
};
