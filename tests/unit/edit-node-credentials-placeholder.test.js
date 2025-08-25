const path = require('path');
const { validateAndNormalizeWorkflow } = require('../../dist/validation/workflowValidator.js');
const { loadNodeTypesForCurrentVersion } = require('../../dist/validation/nodeTypesLoader.js');

describe('edit_node credentials placeholder injection', () => {
    const n8nVersion = '1.103.0';

    it('injects placeholders for postgres required credentials and clears missing_credentials', async () => {
        const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../../workflow_nodes'), n8nVersion);

        // Build a minimal workflow with postgres missing credentials
        const workflow = {
            name: 'TMP',
            nodes: [
                { id: 'p1', name: 'PG', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [0, 0], parameters: { operation: 'select' } }
            ],
            connections: {}
        };

        const pre = validateAndNormalizeWorkflow(workflow, nodeTypes);
        const preIssues = (pre.nodeIssues || {})['PG'] || [];
        const hadMissingCreds = preIssues.some(i => i.code === 'missing_credentials');
        expect(hadMissingCreds).toBe(true);

        // Simulate edit_node placeholder injection using credentialsConfig
        const def = nodeTypes.getByNameAndVersion('n8n-nodes-base.postgres', 2.6);
        const cfg = (def?.description?.credentialsConfig || []).filter(c => c.required).map(c => String(c.name));
        workflow.nodes[0].credentials = {};
        for (const name of cfg) {
            workflow.nodes[0].credentials[name] = { id: 'dummy', name: `${name}-placeholder` };
        }

        const post = validateAndNormalizeWorkflow(workflow, nodeTypes);
        const postIssues = (post.nodeIssues || {})['PG'] || [];
        const stillMissing = postIssues.some(i => i.code === 'missing_credentials');
        expect(stillMissing).toBe(false);
    });
});


