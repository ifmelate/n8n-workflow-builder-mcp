import { z } from 'zod';
import fs from 'fs/promises';
import { N8nWorkflow, N8nConnectionDetail } from '../../types/n8n';
import { resolveWorkflowPath, tryDetectWorkspaceForName } from '../../utils/workspace';
import { ToolNames } from '../../utils/constants';
import { validateAndNormalizeWorkflow } from '../../validation/workflowValidator';
import { loadNodeTypesForCurrentVersion } from '../../validation/nodeTypesLoader';
import { getCurrentN8nVersion } from '../../nodes/versioning';
import path from 'path';

export const toolName = ToolNames.add_connection;
export const description = "Create a connection between two nodes";

export const paramsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow to add the connection to"),
    source_node_id: z.string().describe("The ID of the source node for the connection"),
    source_node_output_name: z.string().describe("The name of the output handle on the source node (e.g., 'main')"),
    target_node_id: z.string().describe("The ID of the target node for the connection"),
    target_node_input_name: z.string().describe("The name of the input handle on the target node (e.g., 'main')"),
    target_node_input_index: z.number().optional().default(0).describe("The index for the target node's input handle (default: 0)"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});

export type Params = z.infer<typeof paramsSchema>;
export type Result = {
    content: Array<{
        type: "text";
        text: string;
    }>;
};

export async function handler(params: Params, _extra: any): Promise<Result> {
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
            const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../../../workflow_nodes'), getCurrentN8nVersion());
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
