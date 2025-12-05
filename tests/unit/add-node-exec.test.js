const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const fs = require('fs').promises;
const path = require('path');

// This test simulates add_node behavior in src/index.ts without spinning the MCP server.
// It validates version normalization + fallback for several canonical nodes.

// Lightweight helpers mirroring src/nodes/cache.ts behavior
function normalizeNodeType(inputType) {
    const lower = inputType.toLowerCase();
    return lower.startsWith('n8n-nodes-base.') ? inputType : `n8n-nodes-base.${inputType}`;
}

function toNumeric(v) {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v));
    return Number.isNaN(n) ? 1 : n;
}

async function getNodeVersionFromDefs(version, type) {
    const simple = type.includes('.') ? type.split('.').pop() : type;
    const file = `${simple}.json`;
    const p = path.resolve(__dirname, `../../workflow_nodes/${version}/${file}`);
    const raw = await fs.readFile(p, 'utf8');
    const json = JSON.parse(raw);
    return toNumeric(json.version);
}

describe('add_node version normalization (simulated)', () => {
    let n8nVersion;

    beforeAll(async () => {
        const root = path.resolve(__dirname, '../../workflow_nodes');
        try {
            const entries = await fs.readdir(root, { withFileTypes: true });
            const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
            const parse = (v) => v.split('.').map(n => parseInt(n, 10) || 0);
            dirs.sort((a, b) => {
                const [a0, a1, a2] = parse(a);
                const [b0, b1, b2] = parse(b);
                if (a0 !== b0) return b0 - a0;
                if (a1 !== b1) return b1 - a1;
                return b2 - a2;
            });
            n8nVersion = dirs[0];
        } catch {
            n8nVersion = '1.108.1';
        }
    });

    it('httpRequest should resolve to 4.3', async () => {
        const finalType = normalizeNodeType('httpRequest');
        const ver = await getNodeVersionFromDefs(n8nVersion, finalType);
        expect(finalType).toBe('n8n-nodes-base.httpRequest');
        expect(ver).toBeCloseTo(4.3, 5);
    });

    it('if should resolve to 2.3', async () => {
        const finalType = normalizeNodeType('if');
        const ver = await getNodeVersionFromDefs(n8nVersion, finalType);
        expect(finalType).toBe('n8n-nodes-base.if');
        expect(ver).toBeCloseTo(2.3, 5);
    });

    it('switch should resolve to 3.4', async () => {
        const finalType = normalizeNodeType('switch');
        const ver = await getNodeVersionFromDefs(n8nVersion, finalType);
        expect(finalType).toBe('n8n-nodes-base.switch');
        expect(ver).toBeCloseTo(3.4, 5);
    });

    it('merge should resolve to 3.2', async () => {
        const finalType = normalizeNodeType('merge');
        const ver = await getNodeVersionFromDefs(n8nVersion, finalType);
        expect(finalType).toBe('n8n-nodes-base.merge');
        expect(ver).toBeCloseTo(3.2, 5);
    });

    it('postgres should resolve to 2.6', async () => {
        const finalType = normalizeNodeType('postgres');
        const ver = await getNodeVersionFromDefs(n8nVersion, finalType);
        expect(finalType).toBe('n8n-nodes-base.postgres');
        expect(ver).toBeCloseTo(2.6, 5);
    });
});


