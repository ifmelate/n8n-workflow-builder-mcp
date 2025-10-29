const { describe, it, expect } = require('@jest/globals');

describe('list_available_nodes handler returns new JSON fields (1.103.0)', () => {
    it('includes usageExamplesPreview, ioSummary, and role', async () => {
        let handler;
        try {
            // Prefer source to ensure latest fields are present without requiring a build
            handler = require('../../src/mcp/tools/listAvailableNodes.ts').handler;
        } catch (e) {
            // Fallback to compiled artifact if TS transform is not available
            handler = require('../../dist/mcp/tools/listAvailableNodes.js').handler;
        }

        const result = await handler({}, {});
        const payload = JSON.parse(result.content[0].text);
        expect(payload.success).toBe(true);
        expect(Array.isArray(payload.nodes)).toBe(true);
        if (payload.nodes.length === 0) return; // nothing to assert further if empty dataset

        const sample = payload.nodes[0];
        // Basic shape
        expect(sample).toHaveProperty('nodeType');
        expect(sample).toHaveProperty('displayName');
        expect(sample).toHaveProperty('version');

        // New metadata previews
        expect(sample).toHaveProperty('usageExamplesPreview');
        expect(sample.usageExamplesPreview).toHaveProperty('count');
        expect(sample.usageExamplesPreview).toHaveProperty('names');

        expect(sample).toHaveProperty('ioSummary');
        // ioSummary may be undefined for some nodes; if present, enforce shape
        if (sample.ioSummary) {
            expect(sample.ioSummary).toHaveProperty('inputs');
            expect(sample.ioSummary).toHaveProperty('outputs');
        }

        // Role comes from wiring.role when available
        expect(sample).toHaveProperty('role');
    });
});


