const path = require('path');
const fs = require('fs').promises;

const { validateAndNormalizeWorkflow } = require('../../dist/validation/workflowValidator.js');
const { loadNodeTypesForCurrentVersion } = require('../../dist/validation/nodeTypesLoader.js');

async function readWorkflow(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}

function simulateConnectivityChecks(report, strictMainOnly = true) {
    const allErrors = [...report.errors];

    try {
        const normalized = report.normalized || { nodes: {}, connectionsBySource: {}, connectionsByDestination: {} };
        const nodesByName = normalized.nodes || {};
        const connectionsBySource = normalized.connectionsBySource || {};
        const startNode = report.startNode;

        if (startNode) {
            // Build adjacency for 'main' edges (forward only)
            const mainNeighbors = {};
            for (const [src, byType] of Object.entries(connectionsBySource)) {
                const groups = (byType || {}).main || [];
                for (const group of groups || []) {
                    for (const conn of group || []) {
                        if (!conn) continue;
                        if (!mainNeighbors[src]) mainNeighbors[src] = new Set();
                        mainNeighbors[src].add(conn.node);
                    }
                }
            }

            // BFS from start via 'main' edges
            const reachableMain = new Set();
            const q = [];
            reachableMain.add(startNode);
            q.push(startNode);
            while (q.length > 0) {
                const cur = q.shift();
                const neigh = Array.from(mainNeighbors[cur] || []);
                for (const n of neigh) {
                    if (!reachableMain.has(n)) {
                        reachableMain.add(n);
                        q.push(n);
                    }
                }
            }

            // Build undirected adjacency for all edge types
            const allNeighbors = {};
            const addUndirected = (a, b) => {
                if (!allNeighbors[a]) allNeighbors[a] = new Set();
                if (!allNeighbors[b]) allNeighbors[b] = new Set();
                allNeighbors[a].add(b);
                allNeighbors[b].add(a);
            };
            for (const [src, byType] of Object.entries(connectionsBySource)) {
                for (const groups of Object.values(byType || {})) {
                    for (const group of groups || []) {
                        for (const conn of group || []) {
                            if (!conn) continue;
                            addUndirected(src, conn.node);
                        }
                    }
                }
            }

            // Expand from reachableMain using undirected edges to include attached non-main neighbors
            const reachableExtended = new Set(reachableMain);
            const q2 = Array.from(reachableMain);
            while (q2.length > 0) {
                const cur = q2.shift();
                const neigh = Array.from(allNeighbors[cur] || []);
                for (const n of neigh) {
                    if (!reachableExtended.has(n)) {
                        reachableExtended.add(n);
                        q2.push(n);
                    }
                }
            }

            const target = strictMainOnly ? reachableMain : reachableExtended;
            for (const [name, node] of Object.entries(nodesByName)) {
                if (node && node.disabled === true) continue;
                if (!target.has(name)) {
                    allErrors.push({
                        code: 'node_not_in_main_chain',
                        message: `Node "${name}" (ID: ${node?.id || 'unknown'}) is not connected to the main workflow chain starting at "${startNode}"`,
                        nodeName: name,
                        details: { nodeId: node?.id, type: node?.type }
                    });
                }
            }
        }
    } catch (e) {
        // keep original behavior and ignore connectivity check failures
    }

    return allErrors;
}

describe('complex_ai_demo.json validation', () => {
    const nodesRoot = path.resolve(__dirname, '../../workflow_nodes');
    const assumedVersion = '1.108.1';
    const wfPath = path.resolve(__dirname, '../../workflow_data/complex_ai_demo.json');

    it('suppresses ai_node_without_ai_ports warning for chatTrigger', async () => {
        const nodeTypes = await loadNodeTypesForCurrentVersion(nodesRoot, assumedVersion);
        const wf = await readWorkflow(wfPath);
        const report = validateAndNormalizeWorkflow(wf, nodeTypes);
        const chatTriggerWarn = (report.warnings || []).find(
            (w) => w.code === 'ai_node_without_ai_ports' && w.nodeName === 'Start Chat Trigger'
        );
        expect(chatTriggerWarn).toBeUndefined();
    });

    it('strict (default) flags AI nodes not in main chain', async () => {
        const nodeTypes = await loadNodeTypesForCurrentVersion(nodesRoot, assumedVersion);
        const wf = await readWorkflow(wfPath);
        const report = validateAndNormalizeWorkflow(wf, nodeTypes);
        const errors = simulateConnectivityChecks(report, true);
        // Expect at least one node_not_in_main_chain error in strict mode
        expect(errors.some((e) => e.code === 'node_not_in_main_chain')).toBe(true);
    });

    it('non-strict connectivity (isMultipleChains=true) accepts AI-attached graph', async () => {
        const nodeTypes = await loadNodeTypesForCurrentVersion(nodesRoot, assumedVersion);
        const wf = await readWorkflow(wfPath);
        const report = validateAndNormalizeWorkflow(wf, nodeTypes);
        const errors = simulateConnectivityChecks(report, false);
        // In non-strict mode, there should be no connectivity errors
        expect(errors.filter((e) => e.code === 'node_not_in_main_chain')).toHaveLength(0);
    });
});


