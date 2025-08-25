const { describe, it, expect } = require('@jest/globals');
const path = require('path');
const fs = require('fs').promises;

// This test performs a minimal end-to-end write of a workflow file and
// verifies that adding nodes yields correct typeVersion in the saved JSON,
// simulating a typical consumer reading the file after tool execution.

async function loadWorkflow(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}

describe('Workflow file integrity after add_node (offline verification)', () => {
    const workflowName = 'UNIT_VERSION_MATRIX';
    const workflowPath = path.resolve(__dirname, `../../workflow_data/${workflowName}.json`);

    it('should contain If@2.2, Switch@3.2, HttpRequest@4.2, Merge@3.2, Postgres@2.6', async () => {
        const wf = await loadWorkflow(workflowPath);
        const nodes = wf.nodes || [];

        const findType = (t) => nodes.find(n => n.type === t);

        expect(findType('n8n-nodes-base.if').typeVersion).toBeCloseTo(2.2, 5);
        expect(findType('n8n-nodes-base.switch').typeVersion).toBeCloseTo(3.2, 5);
        expect(findType('n8n-nodes-base.httpRequest').typeVersion).toBeCloseTo(4.2, 5);
        expect(findType('n8n-nodes-base.merge').typeVersion).toBeCloseTo(3.2, 5);
        expect(findType('n8n-nodes-base.postgres').typeVersion).toBeCloseTo(2.6, 5);
    });
});


