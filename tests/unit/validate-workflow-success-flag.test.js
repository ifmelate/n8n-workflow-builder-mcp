const { describe, it, expect } = require('@jest/globals');
const { validateAndNormalizeWorkflow, SimpleNodeTypes } = require('../../dist/validation/workflowValidator.js');

function simulateValidateWorkflowTool(workflow, nodeTypes) {
    const report = validateAndNormalizeWorkflow(workflow, nodeTypes);
    const allErrors = [...report.errors];
    if (report.warnings.length > 0) {
        for (const w of report.warnings) {
            allErrors.push({ code: w.code, message: w.message, nodeName: w.nodeName, details: w.details });
        }
    }
    const validationOk = allErrors.length === 0;
    return { success: validationOk, validation: { ok: validationOk, errors: allErrors, originalWarningCount: report.warnings.length } };
}

describe('validate_workflow success mirrors validation.ok', () => {
    function reg() {
        const r = new SimpleNodeTypes();
        r.register('dummy.type', 1, { name: 'dummy.type', properties: [] });
        return r;
    }

    it('returns success=false when warnings are promoted to errors', () => {
        const nodeTypes = reg();
        const wf = { name: 'X', nodes: [{ id: 'a', name: 'A', type: 'dummy.type', typeVersion: 1, parameters: {} }], connections: {} };
        const res = simulateValidateWorkflowTool(wf, nodeTypes);
        expect(res.validation.ok).toBe(false);
        expect(res.success).toBe(false);
    });

    it('returns success=true when no errors/warnings', () => {
        const nodeTypes = reg();
        const wf = { name: 'X', nodes: [{ id: 'a', name: 'A', type: 'dummy.type', typeVersion: 1, parameters: {} }, { id: 'b', name: 'B', type: 'dummy.type', typeVersion: 1, parameters: {} }], connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } } };
        const res = simulateValidateWorkflowTool(wf, nodeTypes);
        expect(res.validation.ok).toBe(true);
        expect(res.success).toBe(true);
    });
});




