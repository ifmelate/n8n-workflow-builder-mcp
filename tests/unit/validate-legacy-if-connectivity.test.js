const { describe, it, expect } = require('@jest/globals');
const { validateAndNormalizeWorkflow, SimpleNodeTypes } = require('../../dist/validation/workflowValidator.js');

function makeRegistry() {
    const reg = new SimpleNodeTypes();
    // Register minimal dummy node types used in the test
    reg.register('dummy.trigger', 1, { name: 'dummy.trigger', properties: [] });
    reg.register('dummy.switch', 1, { name: 'dummy.switch', properties: [] });
    reg.register('dummy.http', 1, { name: 'dummy.http', properties: [] });
    reg.register('dummy.merge', 1, { name: 'dummy.merge', properties: [] });
    return reg;
}

// Simulate core parts of validate_workflow tool for connectivity + legacy if detection
function simulateValidateWorkflowTool(workflow, nodeTypes) {
    const report = validateAndNormalizeWorkflow(workflow, nodeTypes);
    const allErrors = [...report.errors];

    const normalized = report.normalized || { nodes: {}, connectionsBySource: {}, connectionsByDestination: {} };
    const nodesByName = normalized.nodes || {};
    const connectionsBySource = normalized.connectionsBySource || {};
    const startNode = report.startNode;

    if (startNode) {
        const mainNeighbors = {};
        const getMainLikeGroups = (byType) => {
            const groupsMain = (byType || {}).main || [];
            if (Array.isArray(groupsMain) && groupsMain.length > 0) return groupsMain;
            const tfTrue = Array.isArray((byType || {}).true) ? (byType || {}).true : [];
            const tfFalse = Array.isArray((byType || {}).false) ? (byType || {}).false : [];
            if (tfTrue.length > 0 || tfFalse.length > 0) return [...tfTrue, ...tfFalse];
            const numericKeys = Object.keys(byType || {}).filter(k => /^\d+$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b));
            if (numericKeys.length > 0) {
                const out = [];
                for (const k of numericKeys) {
                    const arr = (byType || {})[k];
                    if (Array.isArray(arr)) out.push(...arr);
                }
                return out;
            }
            return [];
        };

        for (const [src, byType] of Object.entries(connectionsBySource)) {
            const groups = getMainLikeGroups(byType);
            for (const group of groups || []) {
                for (const conn of group || []) {
                    if (!conn) continue;
                    if (!mainNeighbors[src]) mainNeighbors[src] = new Set();
                    mainNeighbors[src].add(conn.node);
                }
            }
        }

        // BFS via main-like edges
        const reachableMain = new Set();
        const queue = [];
        reachableMain.add(startNode);
        queue.push(startNode);
        while (queue.length) {
            const cur = queue.shift();
            const neigh = Array.from(mainNeighbors[cur] || []);
            for (const n of neigh) {
                if (!reachableMain.has(n)) {
                    reachableMain.add(n);
                    queue.push(n);
                }
            }
        }

        // Enforce strict main-chain only
        for (const [name, node] of Object.entries(nodesByName)) {
            if (node && node.disabled === true) continue;
            if (!reachableMain.has(name)) {
                allErrors.push({
                    code: 'node_not_in_main_chain',
                    message: `Node "${name}" (ID: ${node?.id || 'unknown'}) is not connected to the main workflow chain starting at "${startNode}"`,
                    nodeName: name,
                    details: { nodeId: node?.id, type: node?.type }
                });
            }
        }

        // Add targeted legacy IF/Switch errors when true/false or numeric keys are present
        for (const [src, byType] of Object.entries(connectionsBySource)) {
            const keys = Object.keys(byType || {});
            if (keys.includes('true') || keys.includes('false')) {
                const node = nodesByName[src] || {};
                allErrors.push({
                    code: 'legacy_if_branch_shape',
                    message: `Node "${src}" encodes IF branches under 'true'/'false'. Use 'main' with two outputs (index 0 → true, index 1 → false). Ensure Merge nodes consume these via input indexes 0 and 1.`,
                    nodeName: src,
                    details: { nodeId: node.id, type: node.type, keys }
                });
            }
            const numeric = keys.filter(k => /^\d+$/.test(k));
            if (numeric.length > 0) {
                const node = nodesByName[src] || {};
                allErrors.push({
                    code: 'legacy_switch_branch_shape',
                    message: `Node "${src}" encodes Switch branches under numeric keys (${numeric.join(', ')}). Use 'main' with outputs where index corresponds to the case: main[0], main[1], ...`,
                    nodeName: src,
                    details: { nodeId: node.id, type: node.type, keys: numeric }
                });
            }
        }
    }

    return {
        errors: allErrors,
        startNode,
    };
}

describe('validate_workflow connectivity with legacy IF true/false branches', () => {
    it('does not flag downstream nodes as disconnected when a branch continues, but emits legacy_if_branch_shape', () => {
        const nodeTypes = makeRegistry();

        const wf = {
            name: 'DUMMY_IF_MAINLIKE',
            nodes: [
                { id: 's1', name: 'Start', type: 'dummy.trigger', typeVersion: 1, parameters: {} },
                { id: 'sw1', name: 'Decision', type: 'dummy.switch', typeVersion: 1, parameters: {} },
                { id: 'h1', name: 'HttpA', type: 'dummy.http', typeVersion: 1, parameters: {} },
                { id: 'm1', name: 'Merge', type: 'dummy.merge', typeVersion: 1, parameters: {} },
                { id: 'n1', name: 'Next', type: 'dummy.http', typeVersion: 1, parameters: {} },
            ],
            connections: {
                Start: { main: [[{ node: 'Decision', type: 'main', index: 0 }]] },
                Decision: {
                    true: [[{ node: 'HttpA', type: 'main', index: 0 }]], // legacy true branch
                    false: [[{ node: 'Merge', type: 'main', index: 1 }]],   // legacy false branch goes directly to Merge input 1
                },
                HttpA: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
                Merge: { main: [[{ node: 'Next', type: 'main', index: 0 }]] },
            },
        };

        const res = simulateValidateWorkflowTool(wf, nodeTypes);

        const errorCodes = res.errors.map(e => e.code);
        const notInMain = res.errors.filter(e => e.code === 'node_not_in_main_chain').map(e => e.nodeName);
        const legacyIf = res.errors.filter(e => e.code === 'legacy_if_branch_shape').map(e => e.nodeName);

        // Downstream nodes should be reachable via main-like traversal
        expect(notInMain).not.toContain('HttpA');
        expect(notInMain).not.toContain('Merge');
        expect(notInMain).not.toContain('Next');

        // The IF/Switch node should be flagged for legacy shape
        expect(legacyIf).toContain('Decision');

        // Sanity: there should be at least one connectivity error only if any other node is actually disconnected
        // In this graph, all nodes are reachable, so any node_not_in_main_chain findings would be a regression
        expect(res.errors.filter(e => e.code === 'node_not_in_main_chain')).toHaveLength(0);
    });

    it('handles legacy Switch numeric branches as main-like and emits legacy_switch_branch_shape', () => {
        const nodeTypes = makeRegistry();

        const wf = {
            name: 'DUMMY_SWITCH_MAINLIKE',
            nodes: [
                { id: 's1', name: 'Start', type: 'dummy.trigger', typeVersion: 1, parameters: {} },
                { id: 'sw1', name: 'Switch', type: 'dummy.switch', typeVersion: 1, parameters: {} },
                { id: 'h1', name: 'Path0', type: 'dummy.http', typeVersion: 1, parameters: {} },
                { id: 'h2', name: 'Path1', type: 'dummy.http', typeVersion: 1, parameters: {} },
                { id: 'm1', name: 'Merge', type: 'dummy.merge', typeVersion: 1, parameters: {} },
                { id: 'n1', name: 'End', type: 'dummy.http', typeVersion: 1, parameters: {} },
            ],
            connections: {
                Start: { main: [[{ node: 'Switch', type: 'main', index: 0 }]] },
                Switch: {
                    '0': [[{ node: 'Path0', type: 'main', index: 0 }]],
                    '1': [[{ node: 'Path1', type: 'main', index: 0 }]],
                },
                Path0: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
                Path1: { main: [[{ node: 'Merge', type: 'main', index: 1 }]] },
                Merge: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
            },
        };

        const res = simulateValidateWorkflowTool(wf, nodeTypes);

        const notInMain = res.errors.filter(e => e.code === 'node_not_in_main_chain').map(e => e.nodeName);
        expect(notInMain).toHaveLength(0);

        const legacySwitch = res.errors.filter(e => e.code === 'legacy_switch_branch_shape').map(e => e.nodeName);
        expect(legacySwitch).toContain('Switch');
    });
});


