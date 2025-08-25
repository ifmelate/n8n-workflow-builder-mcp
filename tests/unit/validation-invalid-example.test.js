const path = require('path');
const fs = require('fs').promises;
const { describe, it, expect } = require('@jest/globals');

const { validateAndNormalizeWorkflow } = require('../../dist/validation/workflowValidator.js');
const { loadNodeTypesForCurrentVersion } = require('../../dist/validation/nodeTypesLoader.js');

async function readWorkflow(p) {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
}

describe('INVALID_EXAMPLE.json validation', () => {
    const nodesRoot = path.resolve(__dirname, '../../workflow_nodes');
    // Pick an existing version folder if present, else load from root
    const assumedVersion = '1.103.0';

    it('detects missing credentials and required inputs/options', async () => {
        const nodeTypes = await loadNodeTypesForCurrentVersion(nodesRoot, assumedVersion);
        const wf = await readWorkflow(path.resolve(__dirname, '../../workflow_data/INVALID_EXAMPLE.json'));
        const report = validateAndNormalizeWorkflow(wf, nodeTypes);

        // We expect errors OR nodeIssues to flag problems
        const errors = report.errors || [];
        const nodeIssues = report.nodeIssues || {};

        // 1) OpenRouter chat model should require credentials
        const openrouterIssues = nodeIssues['OpenRouter Chat Model'] || [];
        const hasOpenrouterCred = openrouterIssues.some(i => i.code === 'missing_credentials');

        // 2) Qdrant vector store should require collection parameter and credentials
        const qdrantIssues = nodeIssues['Qdrant Vector Store'] || [];
        const hasQdrantCollection = qdrantIssues.some(i => i.property === 'collection' || /collection/i.test(i.message));
        const hasQdrantCred = qdrantIssues.some(i => i.code === 'missing_credentials');

        // 3) Qdrant vector store should require embedding input (AiEmbedding) when in search mode
        // This appears as a warning (promoted to error) or a specific missing_required_input warning in our validator
        const missingInput = report.warnings.some(w => w.code === 'missing_required_input' && w.nodeName === 'Qdrant Vector Store');

        expect(hasOpenrouterCred || errors.some(e => /credentials/i.test(e.message))).toBe(true);
        expect(hasQdrantCollection).toBe(true);
        expect(hasQdrantCred || errors.some(e => e.nodeName === 'Qdrant Vector Store' && /credentials/i.test(e.message))).toBe(true);
        expect(missingInput).toBe(true);
    });
});
