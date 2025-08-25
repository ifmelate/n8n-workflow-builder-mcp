const { describe, it, expect } = require('@jest/globals');
const path = require('path');
const fs = require('fs').promises;

const { validateAndNormalizeWorkflow } = require('../../dist/validation/workflowValidator.js');
const { loadNodeTypesFromDir } = require('../../dist/validation/nodeTypesLoader.js');

async function readJson(p) {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
}

describe('Validator warnings against real workflow JSONs', () => {
    const version = '1.103.0';
    const nodesDir = path.resolve(__dirname, `../../workflow_nodes/${version}`);

    it('flags unconnected nodes (VALIDATOR_UNCONNECTED.json)', async () => {
        const wfPath = path.resolve(__dirname, '../../workflow_data/VALIDATOR_UNCONNECTED.json');
        const wf = await readJson(wfPath);
        const nodeTypes = await loadNodeTypesFromDir(nodesDir);
        const report = validateAndNormalizeWorkflow(wf, nodeTypes);
        const unconnected = report.warnings.filter(w => w.code === 'unconnected_node');
        expect(unconnected.length).toBeGreaterThanOrEqual(2);
        const names = new Set(unconnected.map(w => w.nodeName));
        expect(names.has('A')).toBe(true);
        expect(names.has('B')).toBe(true);
    });

    it('flags AI node not wired via ai_* ports (VALIDATOR_AI_WIRING.json)', async () => {
        const wfPath = path.resolve(__dirname, '../../workflow_data/VALIDATOR_AI_WIRING.json');
        const wf = await readJson(wfPath);
        const nodeTypes = await loadNodeTypesFromDir(nodesDir);
        const report = validateAndNormalizeWorkflow(wf, nodeTypes);
        const aiIssues = report.warnings.filter(w => w.code === 'ai_node_without_ai_ports');
        expect(aiIssues.length).toBeGreaterThanOrEqual(1);
        expect(aiIssues.map(w => w.nodeName)).toContain('Agent');
    });
});


