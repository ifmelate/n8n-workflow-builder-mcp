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

describe('Validator warnings: node ID inclusion', () => {
    it('includes node IDs in unconnected node warnings', () => {
        const nodeTypes = makeRegistry([
            ['dummy.type1', 1],
            ['dummy.type2', 1],
        ]);

        const workflow = {
            name: 'DUMMY_UNCONNECTED_WITH_IDS',
            nodes: [
                {
                    id: 'node-abc-123',
                    name: 'A',
                    type: 'dummy.type1',
                    typeVersion: 1,
                    parameters: {}
                },
                {
                    id: 'node-def-456',
                    name: 'B',
                    type: 'dummy.type2',
                    typeVersion: 1,
                    parameters: {}
                },
            ],
            connections: {},
        };

        const report = validateAndNormalizeWorkflow(workflow, nodeTypes);
        expect(report.ok).toBe(true);

        const unconnected = report.warnings.filter((w) => w.code === 'unconnected_node');
        expect(unconnected.length).toBeGreaterThanOrEqual(2);

        // Check that warnings include node IDs in the message
        const nodeAWarning = unconnected.find(w => w.nodeName === 'A');
        const nodeBWarning = unconnected.find(w => w.nodeName === 'B');

        expect(nodeAWarning).toBeDefined();
        expect(nodeBWarning).toBeDefined();

        // Verify the message includes the node ID
        expect(nodeAWarning.message).toContain('node-abc-123');
        expect(nodeAWarning.message).toMatch(/Node "A" \(ID: node-abc-123\)/);

        expect(nodeBWarning.message).toContain('node-def-456');
        expect(nodeBWarning.message).toMatch(/Node "B" \(ID: node-def-456\)/);

        // Verify the details include nodeId
        expect(nodeAWarning.details.nodeId).toBe('node-abc-123');
        expect(nodeBWarning.details.nodeId).toBe('node-def-456');
    });

    it('includes node IDs in AI wiring warnings', () => {
        const nodeTypes = makeRegistry([
            ['dummy.source', 1],
            ['custom.agent', 1],
        ]);

        const workflow = {
            name: 'DUMMY_AI_WIRING_WITH_IDS',
            nodes: [
                {
                    id: 'source-xyz-789',
                    name: 'Source',
                    type: 'dummy.source',
                    typeVersion: 1,
                    parameters: {}
                },
                {
                    id: 'agent-abc-999',
                    name: 'Agent',
                    type: 'custom.agent',
                    typeVersion: 1,
                    parameters: {}
                },
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

        const agentWarning = aiWiringIssues.find(w => w.nodeName === 'Agent');
        expect(agentWarning).toBeDefined();

        // Verify the message includes the node ID
        expect(agentWarning.message).toContain('agent-abc-999');
        expect(agentWarning.message).toMatch(/AI-related node "Agent" \(ID: agent-abc-999\)/);

        // Verify the details include nodeId
        expect(agentWarning.details.nodeId).toBe('agent-abc-999');
    });

    it('handles nodes without IDs gracefully', () => {
        const nodeTypes = makeRegistry([
            ['dummy.type1', 1],
        ]);

        const workflow = {
            name: 'DUMMY_NO_IDS',
            nodes: [
                {
                    // No id field
                    name: 'NoIdNode',
                    type: 'dummy.type1',
                    typeVersion: 1,
                    parameters: {}
                },
            ],
            connections: {},
        };

        const report = validateAndNormalizeWorkflow(workflow, nodeTypes);
        expect(report.ok).toBe(true);

        const unconnected = report.warnings.filter((w) => w.code === 'unconnected_node');
        expect(unconnected.length).toBeGreaterThanOrEqual(1);

        const warning = unconnected.find(w => w.nodeName === 'NoIdNode');
        expect(warning).toBeDefined();

        // Should fall back to 'unknown' when no ID is present
        expect(warning.message).toContain('unknown');
        expect(warning.message).toMatch(/Node "NoIdNode" \(ID: unknown\)/);

        // Details should have nodeId as undefined
        expect(warning.details.nodeId).toBeUndefined();
    });
});
