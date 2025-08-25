const path = require('path');
const { validateAndNormalizeWorkflow } = require('../../dist/validation/workflowValidator.js');
const { loadNodeTypesForCurrentVersion } = require('../../dist/validation/nodeTypesLoader.js');

/**
 * Complex scenarios for add_ai_connections behavior: models, tools, memory
 * These tests intentionally mirror the on-server logic to validate wiring outcomes
 */

function addAIConnectionsLikeServer(workflow, params) {
    const { agent_node_id, model_node_id, tool_node_ids, memory_node_id } = params;

    const agentNode = workflow.nodes.find((n) => n.id === agent_node_id);
    if (!agentNode) throw new Error('Agent node not found');

    const modelNode = model_node_id ? workflow.nodes.find((n) => n.id === model_node_id) : undefined;
    const memoryNode = memory_node_id ? workflow.nodes.find((n) => n.id === memory_node_id) : undefined;
    const toolNodes = (tool_node_ids || []).map((id) => workflow.nodes.find((n) => n.id === id)).filter(Boolean);

    if (!workflow.connections) workflow.connections = {};

    // Model → Agent via ai_languageModel (with simple dedup like server does)
    if (modelNode) {
        const src = modelNode.name;
        if (!workflow.connections[src]) workflow.connections[src] = {};
        if (!workflow.connections[src]['ai_languageModel']) workflow.connections[src]['ai_languageModel'] = [];

        const exists = workflow.connections[src]['ai_languageModel'].some((group) =>
            Array.isArray(group) && group.some((d) => d && d.node === agentNode.name && d.type === 'ai_languageModel')
        );
        if (!exists) {
            workflow.connections[src]['ai_languageModel'].push([
                { node: agentNode.name, type: 'ai_languageModel', index: 0 },
            ]);
        }
    }

    // Tools → Agent via ai_tool (no dedup in server – potential duplication bug)
    for (const toolNode of toolNodes) {
        const src = toolNode.name;
        if (!workflow.connections[src]) workflow.connections[src] = {};
        if (!workflow.connections[src]['ai_tool']) workflow.connections[src]['ai_tool'] = [];
        workflow.connections[src]['ai_tool'].push([
            { node: agentNode.name, type: 'ai_tool', index: 0 },
        ]);
    }

    // Memory → Agent via ai_memory (no dedup in server – potential duplication bug)
    if (memoryNode) {
        const src = memoryNode.name;
        if (!workflow.connections[src]) workflow.connections[src] = {};
        if (!workflow.connections[src]['ai_memory']) workflow.connections[src]['ai_memory'] = [];
        workflow.connections[src]['ai_memory'].push([
            { node: agentNode.name, type: 'ai_memory', index: 0 },
        ]);
    }

    return workflow;
}

describe('add_ai_connections complex scenarios', () => {
    const nodesRoot = path.resolve(__dirname, '../../workflow_nodes');
    const assumedVersion = '1.103.0';

    it('wires model, memory, and a vector-store tool to an agent; validates without missing AiLanguageModel', async () => {
        const nodeTypes = await loadNodeTypesForCurrentVersion(nodesRoot, assumedVersion);

        const wf = {
            name: 'RAG_Workflow',
            nodes: [
                { id: 'agent', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 2, parameters: {} },
                { id: 'model', name: 'OpenRouter Chat Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenRouter', typeVersion: 1, parameters: {} },
                { id: 'memory', name: 'Buffer Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', typeVersion: 1, parameters: {} },
                { id: 'qdrant', name: 'Qdrant Vector Store', type: '@n8n/n8n-nodes-langchain.vectorStoreQdrant', typeVersion: 1, parameters: { qdrantCollection: '' } },
            ],
            connections: {},
        };

        addAIConnectionsLikeServer(wf, {
            agent_node_id: 'agent',
            model_node_id: 'model',
            memory_node_id: 'memory',
            tool_node_ids: ['qdrant'],
        });

        const report = validateAndNormalizeWorkflow(wf, nodeTypes);

        // Ensure the agent received ai_languageModel and is not flagged for missing required input
        const missingReqAgent = (report.warnings || []).find(
            (w) => w.code === 'missing_required_input' && w.nodeName === 'Agent'
        );
        expect(missingReqAgent).toBeUndefined();

        // Ensure AI ports exist (normalize to match validator semantics)
        const dst = report.normalized.connectionsByDestination['Agent'] || {};
        const normalize = (s) => String(s).toLowerCase().replace(/_/g, '');
        const dstKeysNorm = Object.keys(dst).map(normalize);
        expect(dstKeysNorm).toEqual(expect.arrayContaining(['ai_languagemodel', 'ai_memory', 'ai_tool'].map(normalize)));
    });

    it('calling add_ai_connections twice duplicates tool and memory links (bug exposure)', () => {
        const wf = {
            name: 'Dupes',
            nodes: [
                { id: 'agent', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', parameters: {} },
                { id: 'model', name: 'Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', parameters: {} },
                { id: 'memory', name: 'Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', parameters: {} },
                { id: 'toolA', name: 'Tool A', type: '@n8n/n8n-nodes-langchain.toolHttpRequest', parameters: {} },
            ],
            connections: {},
        };

        addAIConnectionsLikeServer(wf, {
            agent_node_id: 'agent',
            model_node_id: 'model',
            tool_node_ids: ['toolA'],
            memory_node_id: 'memory',
        });
        addAIConnectionsLikeServer(wf, {
            agent_node_id: 'agent',
            model_node_id: 'model',
            tool_node_ids: ['toolA'],
            memory_node_id: 'memory',
        });

        // Model is deduped, tool and memory are duplicated — current server behavior (potential bug)
        expect(wf.connections['Model']['ai_languageModel'].length).toBe(1);
        expect(wf.connections['Tool A']['ai_tool'].length).toBeGreaterThan(1);
        expect(wf.connections['Memory']['ai_memory'].length).toBeGreaterThan(1);
    });

    it('does not validate agent type before wiring (bug exposure)', () => {
        const wf = {
            name: 'AgentTypeCheck',
            nodes: [
                { id: 'notAgent', name: 'Some Node', type: '@n8n/n8n-nodes-langchain.chainLlm', parameters: {} },
                { id: 'model', name: 'Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', parameters: {} },
            ],
            connections: {},
        };

        // Should ideally throw, but current behavior wires blindly (since server relies on provided IDs)
        addAIConnectionsLikeServer(wf, {
            agent_node_id: 'notAgent',
            model_node_id: 'model',
            tool_node_ids: [],
        });

        expect(wf.connections['Model']['ai_languageModel'][0][0].node).toBe('Some Node');
    });
});


