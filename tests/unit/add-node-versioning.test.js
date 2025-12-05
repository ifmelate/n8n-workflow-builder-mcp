const { describe, it, expect, beforeAll } = require('@jest/globals');
const fs = require('fs').promises;
const path = require('path');

// Helper to read a node JSON definition for a specific version directory
async function readNodeDef(version, file) {
    const filePath = path.resolve(__dirname, `../../workflow_nodes/${version}/${file}`);
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}

// Minimal replica of the server's version normalization logic used for decisions
function toNumericVersion(v) {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v));
    return Number.isNaN(n) ? 1 : n;
}

function chooseHighestSupported(nodeSupportedSet) {
    const arr = Array.from(nodeSupportedSet || []).map(toNumericVersion).filter(n => !Number.isNaN(n));
    arr.sort((a, b) => b - a);
    return arr[0];
}

describe('Add Node Versioning (dataset verification and selection)', () => {
    let version;

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
            version = dirs[0];
        } catch {
            version = '1.108.1';
        }
    });

    it('should have correct version for If node (2.3)', async () => {
        const def = await readNodeDef(version, 'if.json');
        expect(def.nodeType).toBe('n8n-nodes-base.if');
        expect(toNumericVersion(def.version)).toBeCloseTo(2.3, 5);
    });

    it('should have correct version for HttpRequest (4.3)', async () => {
        const def = await readNodeDef(version, 'httpRequest.json');
        expect(def.nodeType).toBe('n8n-nodes-base.httpRequest');
        expect(toNumericVersion(def.version)).toBeCloseTo(4.3, 5);
    });

    it('should have correct version for Switch (3.4)', async () => {
        const def = await readNodeDef(version, 'switch.json');
        expect(def.nodeType).toBe('n8n-nodes-base.switch');
        expect(toNumericVersion(def.version)).toBeCloseTo(3.4, 5);
    });

    it('should have correct version for Merge (3.2)', async () => {
        const def = await readNodeDef(version, 'merge.json');
        expect(def.nodeType).toBe('n8n-nodes-base.merge');
        expect(toNumericVersion(def.version)).toBeCloseTo(3.2, 5);
    });

    it('should have correct version for Postgres (2.6)', async () => {
        const def = await readNodeDef(version, 'postgres.json');
        expect(def.nodeType).toBe('n8n-nodes-base.postgres');
        expect(toNumericVersion(def.version)).toBeCloseTo(2.6, 5);
    });
});


