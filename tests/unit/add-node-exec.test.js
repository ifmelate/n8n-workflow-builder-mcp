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
    const n8nVersion = '1.103.0';

    it('httpRequest should resolve to 4.2', async () => {
        const finalType = normalizeNodeType('httpRequest');
        const ver = await getNodeVersionFromDefs(n8nVersion, finalType);
        expect(finalType).toBe('n8n-nodes-base.httpRequest');
        expect(ver).toBeCloseTo(4.2, 5);
    });

    it('if should resolve to 2.2', async () => {
        const finalType = normalizeNodeType('if');
        const ver = await getNodeVersionFromDefs(n8nVersion, finalType);
        expect(finalType).toBe('n8n-nodes-base.if');
        expect(ver).toBeCloseTo(2.2, 5);
    });

    it('switch should resolve to 3.2', async () => {
        const finalType = normalizeNodeType('switch');
        const ver = await getNodeVersionFromDefs(n8nVersion, finalType);
        expect(finalType).toBe('n8n-nodes-base.switch');
        expect(ver).toBeCloseTo(3.2, 5);
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


