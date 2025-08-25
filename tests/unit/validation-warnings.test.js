const { describe, it, expect } = require('@jest/globals');

const {
    validateAndNormalizeWorkflow,
    SimpleNodeTypes,
} = require('../../dist/validation/workflowValidator.js');

function makeRegistry(pairs) {
    const reg = new SimpleNodeTypes();
    for (const [name, version] of pairs) {
        reg.register(name, version, { name, properties: [] });
    }
    return reg;
}

describe('Validator warnings: unconnected nodes and AI wiring', () => {
    it('warns about nodes with no incoming or outgoing connections', () => {
        const nodeTypes = makeRegistry([
            ['dummy.type1', 1],
            ['dummy.type2', 1],
        ]);

        const workflow = {
            name: 'DUMMY_UNCONNECTED',
            nodes: [
                { name: 'A', type: 'dummy.type1', typeVersion: 1, parameters: {} },
                { name: 'B', type: 'dummy.type2', typeVersion: 1, parameters: {} },
            ],
            connections: {},
        };

        const report = validateAndNormalizeWorkflow(workflow, nodeTypes);
        expect(report.ok).toBe(true);
        const unconnected = report.warnings.filter((w) => w.code === 'unconnected_node');
        expect(unconnected.length).toBeGreaterThanOrEqual(2);
        const names = new Set(unconnected.map((w) => w.nodeName));
        expect(names.has('A')).toBe(true);
        expect(names.has('B')).toBe(true);
    });

    it('warns when an AI-like node is not wired via ai_* ports', () => {
        const nodeTypes = makeRegistry([
            ['dummy.source', 1],
            ['custom.agent', 1],
        ]);

        const workflow = {
            name: 'DUMMY_AI_WIRING',
            nodes: [
                { name: 'Source', type: 'dummy.source', typeVersion: 1, parameters: {} },
                // "agent" in the type string triggers AI heuristic in validator
                { name: 'Agent', type: 'custom.agent', typeVersion: 1, parameters: {} },
            ],
            // Connect Source -> Agent using a non-ai_* output name to trigger warning
            connections: {
                Source: {
                    main: [
                        [
                            { node: 'Agent', type: 'main', index: 0 },
                        ],
                    ],
                },
            },
        };

        const report = validateAndNormalizeWorkflow(workflow, nodeTypes);
        expect(report.ok).toBe(true);
        const aiWiringIssues = report.warnings.filter((w) => w.code === 'ai_node_without_ai_ports');
        expect(aiWiringIssues.length).toBeGreaterThanOrEqual(1);
        expect(aiWiringIssues.map((w) => w.nodeName)).toContain('Agent');
    });
});


