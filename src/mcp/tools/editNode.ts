import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { ToolNames } from '../../utils/constants.js';
import { N8nWorkflow } from '../../types/n8n.js';
import { getCurrentN8nVersion, getN8nVersionInfo } from '../../nodes/versioning.js';
import { getNodeInfoCache, loadKnownNodeBaseTypes, normalizeNodeTypeAndVersion, isNodeTypeSupported } from '../../nodes/cache.js';
import { getWorkspaceDir } from '../../utils/workspace.js';
import { resolveWorkflowPath, ensureWorkflowDir, ensureWorkflowParentDir } from '../../utils/workspace.js';
import { normalizeLLMParameters } from '../../utils/llm.js';
import { generateN8nId } from '../../utils/id.js';
import { loadNodeTypesForCurrentVersion } from '../../validation/nodeTypesLoader.js';
import { validateAndNormalizeWorkflow } from '../../validation/workflowValidator.js';
import { McpResponse } from '../responses';

export const toolName = ToolNames.edit_node;
export const description = "Edit an existing node in a workflow";

export const paramsSchema = z.object({
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

export type Params = z.infer<typeof paramsSchema>;

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

export async function handler(params: Params, _extra: any): Promise<McpResponse> {
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

        // Pre-validate before persisting (node-scoped only; do not fail on unrelated issues)
        try {
            const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
            const tentative = { ...workflow, nodes: workflow.nodes.map((n, i) => i === nodeIndex ? nodeToEdit : n) };
            const preReport = validateAndNormalizeWorkflow(tentative as any, nodeTypes);
            const local = buildLocalValidation(preReport, nodeToEdit.name);
            console.error('[DEBUG] edit_node local pre-validation:', local);
            // Do not block here; full validation is reserved for validate_workflow tool
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

        // Validate after modification (node-scoped only)
        try {
            const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../workflow_nodes'), getCurrentN8nVersion());
            const report = validateAndNormalizeWorkflow(workflow as any, nodeTypes);
            const local = buildLocalValidation(report, nodeToEdit.name);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, node: nodeToEdit, createdConnections, localValidation: local }) }] };
        } catch (e: any) {
            console.warn('[WARN] Validation step errored after edit_node:', e?.message || e);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, node: nodeToEdit, createdConnections }) }] };
        }
    } catch (error: any) {
        console.error("[ERROR] Failed to edit node:", error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to edit node: " + error.message }) }] };
    }
}
