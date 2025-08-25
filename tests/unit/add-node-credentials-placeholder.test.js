const path = require('path');
const { validateAndNormalizeWorkflow } = require('../../dist/validation/workflowValidator.js');
const { loadNodeTypesForCurrentVersion } = require('../../dist/validation/nodeTypesLoader.js');

describe('add_node credentials placeholder injection', () => {
    const n8nVersion = '1.103.0';

    it('injects placeholders for httpRequest required credentials and clears missing_credentials', async () => {
        const nodeTypes = await loadNodeTypesForCurrentVersion(path.resolve(__dirname, '../../workflow_nodes'), n8nVersion);

        // Build a minimal workflow with httpRequest missing credentials
        const workflow = {
            name: 'TMP',
            nodes: [
                { id: 'h1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0], parameters: { url: 'https://example.com' } }
            ],
            connections: {}
        };

        const pre = validateAndNormalizeWorkflow(workflow, nodeTypes);
        const preIssues = (pre.nodeIssues || {})['HTTP'] || [];
        const hadMissingCreds = preIssues.some(i => i.code === 'missing_credentials');
        expect(hadMissingCreds).toBe(true);

        // Simulate add_node placeholder injection by reading credentialsConfig and adding dummy credentials
        const def = nodeTypes.getByNameAndVersion('n8n-nodes-base.httpRequest', 4.2);
        const cfg = (def?.description?.credentialsConfig || []).filter(c => c.required).map(c => String(c.name));
        workflow.nodes[0].credentials = {};
        for (const name of cfg) {
            workflow.nodes[0].credentials[name] = { id: 'dummy', name: `${name}-placeholder` };
        }

        const post = validateAndNormalizeWorkflow(workflow, nodeTypes);
        const postIssues = (post.nodeIssues || {})['HTTP'] || [];
        const stillMissing = postIssues.some(i => i.code === 'missing_credentials');
        expect(stillMissing).toBe(false);
    });
});


