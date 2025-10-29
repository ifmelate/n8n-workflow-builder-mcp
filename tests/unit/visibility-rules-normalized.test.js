const { describe, it, expect } = require('@jest/globals');
const fs = require('fs').promises;
const path = require('path');

async function readNodeDef(version, file) {
    const filePath = path.resolve(__dirname, `../../workflow_nodes/${version}/${file}`);
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}

describe('Node visibilityRulesNormalized (dataset validation for 1.103.0)', () => {
    const version = '1.103.0';

    it('Set node: include vs includeOtherFields rules are present', async () => {
        const def = await readNodeDef(version, 'set.json');
        const props = def.properties || [];
        const include = props.find(p => p.name === 'include');
        const includeOtherFields = props.find(p => p.name === 'includeOtherFields');

        expect(include).toBeTruthy();
        expect(Array.isArray(include.visibilityRulesNormalized)).toBe(true);
        expect(include.visibilityRulesNormalized.some(r => r.effect === 'show' && r.key === '@version')).toBe(true);

        expect(includeOtherFields).toBeTruthy();
        expect(Array.isArray(includeOtherFields.visibilityRulesNormalized)).toBe(true);
        expect(includeOtherFields.visibilityRulesNormalized.some(r => r.effect === 'hide' && r.key === '@version')).toBe(true);
    });

    it('Merge node: conditional props depend on mode/combinationMode', async () => {
        const def = await readNodeDef(version, 'merge.json');
        const props = def.properties || [];
        const mergeByFields = props.find(p => p.name === 'mergeByFields');
        const joinMode = props.find(p => p.name === 'joinMode');
        const outputDataFrom = props.find(p => p.name === 'outputDataFrom');

        expect(mergeByFields).toBeTruthy();
        expect(Array.isArray(mergeByFields.visibilityRulesNormalized)).toBe(true);
        expect(mergeByFields.visibilityRulesNormalized.some(r => r.key === 'mode')).toBe(true);
        expect(mergeByFields.visibilityRulesNormalized.some(r => r.key === 'combinationMode')).toBe(true);

        expect(joinMode).toBeTruthy();
        expect(Array.isArray(joinMode.visibilityRulesNormalized)).toBe(true);

        expect(outputDataFrom).toBeTruthy();
        expect(Array.isArray(outputDataFrom.visibilityRulesNormalized)).toBe(true);
        expect(outputDataFrom.visibilityRulesNormalized.some(r => r.key === 'joinMode')).toBe(true);
    });

    it('Switch node: numberOutputs and output visible in expression mode', async () => {
        const def = await readNodeDef(version, 'switch.json');
        const props = def.properties || [];
        const numberOutputs = props.find(p => p.name === 'numberOutputs');
        const output = props.find(p => p.name === 'output');

        expect(numberOutputs).toBeTruthy();
        expect(Array.isArray(numberOutputs.visibilityRulesNormalized)).toBe(true);
        expect(numberOutputs.visibilityRulesNormalized.some(r => r.key === 'mode' && (r.values || []).includes('expression'))).toBe(true);

        expect(output).toBeTruthy();
        expect(Array.isArray(output.visibilityRulesNormalized)).toBe(true);
        expect(output.visibilityRulesNormalized.some(r => r.key === 'mode' && (r.values || []).includes('expression'))).toBe(true);
    });
});



