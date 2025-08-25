const path = require('path');
const { validateAndNormalizeWorkflow } = require('../../dist/validation/workflowValidator.js');
const { loadNodeTypesForCurrentVersion } = require('../../dist/validation/nodeTypesLoader.js');

/**
 * RAG scenario: Webhook → LLM Chain w/ Model; Qdrant retrieve-as-tool used by Agent via ai_tool; Memory wired
 * Ensures validator passes required inputs (AiLanguageModel) and flags real config gaps (qdrantCollection)
 */

describe('RAG retrieved + agent tools + memory validation', () => {
    const nodesRoot = path.resolve(__dirname, '../../workflow_nodes');
    const assumedVersion = '1.103.0';

    it('validates complex wiring and identifies only real configuration gaps', async () => {
        const nodeTypes = await loadNodeTypesForCurrentVersion(nodesRoot, assumedVersion);

        const wf = {
            name: 'VK_FAS_Ad_Detection_like',
            nodes: [
                { id: 'webhook', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, parameters: { httpMethod: 'POST', path: 'cb', responseMode: 'responseNode' } },
                { id: 'model', name: 'Feature Extraction LLM', type: '@n8n/n8n-nodes-langchain.lmChatOpenRouter', typeVersion: 1, parameters: {} },
                { id: 'chain', name: 'Feature Extraction Chain', type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1, parameters: {} },
                { id: 'agent', name: 'Gemini Pro Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 2, parameters: {} },
                { id: 'memory', name: 'Session Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', typeVersion: 1, parameters: {} },
                { id: 'qdrant', name: 'Qdrant Vector Store', type: '@n8n/n8n-nodes-langchain.vectorStoreQdrant', typeVersion: 1, parameters: { qdrantCollection: '' } },
            ],
            connections: {
                'Webhook': { main: [[{ node: 'Feature Extraction Chain', type: 'main', index: 0 }]] },
                'Feature Extraction LLM': { ai_languageModel: [[{ node: 'Feature Extraction Chain', type: 'ai_languageModel', index: 0 }]] },
                'Feature Extraction Chain': { main: [[{ node: 'Gemini Pro Agent', type: 'main', index: 0 }]] },
                'Feature Extraction LLM (Model Alias)': {},
            },
        };

        // Wire AI like the server
        if (!wf.connections['Feature Extraction LLM']) wf.connections['Feature Extraction LLM'] = {};
        if (!wf.connections['Feature Extraction LLM']['ai_languageModel']) wf.connections['Feature Extraction LLM']['ai_languageModel'] = [];
        wf.connections['Feature Extraction LLM']['ai_languageModel'].push([{ node: 'Gemini Pro Agent', type: 'ai_languageModel', index: 0 }]);

        if (!wf.connections['Session Memory']) wf.connections['Session Memory'] = {};
        if (!wf.connections['Session Memory']['ai_memory']) wf.connections['Session Memory']['ai_memory'] = [];
        wf.connections['Session Memory']['ai_memory'].push([{ node: 'Gemini Pro Agent', type: 'ai_memory', index: 0 }]);

        if (!wf.connections['Qdrant Vector Store']) wf.connections['Qdrant Vector Store'] = {};
        if (!wf.connections['Qdrant Vector Store']['ai_tool']) wf.connections['Qdrant Vector Store']['ai_tool'] = [];
        wf.connections['Qdrant Vector Store']['ai_tool'].push([{ node: 'Gemini Pro Agent', type: 'ai_tool', index: 0 }]);

        const report = validateAndNormalizeWorkflow(wf, nodeTypes);

        // Agent should not have missing AiLanguageModel warning
        const agentMissing = (report.warnings || []).find(w => w.code === 'missing_required_input' && w.nodeName === 'Gemini Pro Agent');
        expect(agentMissing).toBeUndefined();

        // Qdrant should still be flagged for missing collection (real config gap)
        const qdrantIssues = (report.nodeIssues || {})['Qdrant Vector Store'] || [];
        const hasCollectionIssue = qdrantIssues.some(i => /collection/i.test(i.message) || i.property === 'qdrantCollection');
        expect(hasCollectionIssue).toBe(true);
    });
});




