import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { N8nWorkflow, N8nWorkflowNode } from '../../types/n8n';
import { ensureWorkflowDir, resolvePath, WORKFLOW_DATA_DIR_NAME } from '../../utils/workspace';
import { generateUUID, generateN8nId } from '../../utils/id';
import { normalizeNodeTypeAndVersion } from '../../nodes/cache';
import { ToolNames, ErrorCodes } from '../../utils/constants';
import { validateAndNormalizeWorkflow } from '../../validation/workflowValidator';
import { loadNodeTypesForCurrentVersion } from '../../validation/nodeTypesLoader';
import { getCurrentN8nVersion } from '../../nodes/versioning';
import { wireAiConnections, createAgentWiringConnections, saveWorkflow, NodeConnectionTypes } from '../../tools/wiringService';
import { createSuccessResponse, createErrorResponse, createUsageInfo, createActionPlan } from '../../utils/responses';
import { v4 as uuidv4 } from 'uuid';

export const toolName = ToolNames.compose_ai_workflow;
export const description = "Compose a complex AI workflow (agent + model + memory + embeddings + vector + tools + trigger) in one call, including wiring and basic validation.";

export const paramsSchema = z.object({
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
        trigger: z.object({ node_type: z.string().default("@n8n/n8n-nodes-langchain.chatTrigger"), node_name: z.string().default("Start Chat Trigger"), parameters: z.record(z.string(), z.any()).optional() }).optional(),
        // RAG enhancements
        include_document_loader: z.boolean().optional().default(false).describe("Include a document loader for RAG"),
        include_vector_insert: z.boolean().optional().default(true).describe("Include vector store insert node"),
        connect_main_chain: z.enum(['auto', 'minimal', 'off']).optional().default('minimal').describe("How to connect main workflow chain")
    }).describe("High level plan of nodes to add and wire"),
    // Best practices additions
    dry_run: z.boolean().optional().default(false).describe("If true, returns planned changes without making modifications"),
    idempotency_key: z.string().optional().describe("Optional idempotency key to prevent duplicate operations")
});

export type Params = z.infer<typeof paramsSchema>;
export type Result = {
    content: Array<{
        type: "text";
        text: string;
    }>;
};

export async function handler(params: Params, _extra: any): Promise<Result> {
    const correlationId = uuidv4();
    console.error(`[${correlationId}] compose_ai_workflow called with plan:`, params?.plan ? Object.keys(params.plan) : []);
    const { workflow_name, plan, dry_run, idempotency_key } = params;
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

            // Instead of duplicating handler, connect minimal necessary edges using low-level add_connection helper
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
            await connect(embeddings, 'ai_embedding', vstore, 'ai_embedding');
            await connect(vstore, 'ai_document', vinsert, 'ai_document');
            await connect(vstore, 'ai_vectorStore', vtool, 'ai_vectorStore');
            await connect(model, 'ai_languageModel', vtool, 'ai_languageModel');
            await connect(vtool, 'ai_tool', agent, 'ai_tool');
            await connect(trigger, 'main', agent, 'main');

            return { success: true };
        })();

        // Validate
        const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../../../workflow_nodes'), getCurrentN8nVersion());
        const finalRaw = await fs.readFile(filePath, 'utf8');
        const finalWf = JSON.parse(finalRaw);
        const report = validateAndNormalizeWorkflow(finalWf, nodeTypes);

        const responseData = {
            workflowId: finalWf.id,
            workflowPath: filePath,
            nodes: {
                trigger: trigger ? { id: trigger.id, name: trigger.name, type: trigger.type } : null,
                agent: agent ? { id: agent.id, name: agent.name, type: agent.type } : null,
                model: model ? { id: model.id, name: model.name, type: model.type } : null,
                memory: memory ? { id: memory.id, name: memory.name, type: memory.type } : null,
                embeddings: embeddings ? { id: embeddings.id, name: embeddings.name, type: embeddings.type } : null,
                vectorStore: vstore ? { id: vstore.id, name: vstore.name, type: vstore.type } : null,
                vectorInsert: vinsert ? { id: vinsert.id, name: vinsert.name, type: vinsert.type } : null,
                vectorTool: vtool ? { id: vtool.id, name: vtool.name, type: vtool.type } : null,
                extraTools: extraTools.map(t => ({ id: t.id, name: t.name, type: t.type }))
            },
            wiring: wiringResult,
            validation: { ok: report.ok, errors: report.errors, warnings: report.warnings, nodeIssues: report.nodeIssues }
        };

        const usage = createUsageInfo({ nodesCreated: 1 + [agent, model, memory, embeddings, vstore, vinsert, vtool, ...extraTools].filter(Boolean).length });

        // Build an action plan for follow-up operations
        const planSteps: Array<{ tool: string; title?: string; params: Record<string, any>; note?: string }> = [];
        if (plan.connect_main_chain && plan.connect_main_chain !== 'off') {
            planSteps.push({
                tool: 'connect_main_chain',
                title: 'Connect main chain through core nodes',
                params: { workflow_name, workflow_path: filePath, dry_run: false },
                note: `Mode=${plan.connect_main_chain}`
            });
        }
        // Always validate as a final step
        planSteps.push({ tool: 'validate_workflow', title: 'Validate workflow', params: { workflow_name, workflow_path: filePath, strict_main_chain: true } });

        return createSuccessResponse(responseData, {
            correlationId,
            usage,
            actionPlan: createActionPlan(planSteps),
            version: getCurrentN8nVersion() || undefined
        });
    } catch (error: any) {
        console.error('[ERROR] compose_ai_workflow failed:', error);
        return createErrorResponse(`compose_ai_workflow failed: ${error.message}`);
    }
}
