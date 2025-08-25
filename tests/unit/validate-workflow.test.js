const { describe, it, expect } = require('@jest/globals');
const path = require('path');
const fs = require('fs').promises;

const { validateAndNormalizeWorkflow, SimpleNodeTypes } = require('../../dist/validation/workflowValidator.js');
const { loadNodeTypesFromDir } = require('../../dist/validation/nodeTypesLoader.js');

async function readWorkflow(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}

describe('Workflow validation with scraped node definitions', () => {
    const version = '1.103.0';
    const nodesDir = path.resolve(__dirname, `../../workflow_nodes/${version}`);
    const workflowPath = path.resolve(__dirname, `../../workflow_data/UNIT_VERSION_MATRIX.json`);

    it('validates UNIT_VERSION_MATRIX workflow against node definitions (structure only)', async () => {
        const nodeTypes = await loadNodeTypesFromDir(nodesDir);
        const wf = await readWorkflow(workflowPath);
        const report = validateAndNormalizeWorkflow(wf, nodeTypes);
        expect(report).toBeDefined();
        expect(Array.isArray(report.errors)).toBe(true);
        expect(Array.isArray(report.warnings)).toBe(true);
    });
});

describe('validate_workflow tool behavior', () => {
    function makeRegistry(pairs) {
        const reg = new SimpleNodeTypes();
        for (const [name, version] of pairs) {
            reg.register(name, version, { name, properties: [] });
        }
        return reg;
    }

    function simulateValidateWorkflowTool(workflow, nodeTypes) {
        // Simulate the validate_workflow tool logic
        const report = validateAndNormalizeWorkflow(workflow, nodeTypes);

        // Apply the same logic as the modified validate_workflow tool
        const allErrors = [...report.errors];

        // Convert warnings to errors for this tool
        if (report.warnings.length > 0) {
            for (const warning of report.warnings) {
                allErrors.push({
                    code: warning.code,
                    message: warning.message,
                    nodeName: warning.nodeName,
                    details: warning.details
                });
            }
        }

        // Workflow is only OK if there are no errors AND no warnings
        const validationOk = report.ok && report.warnings.length === 0;

        return {
            success: true,
            validation: {
                ok: validationOk,
                errors: allErrors,
                startNode: report.startNode,
                originalWarningCount: report.warnings.length,
                note: report.warnings.length > 0 ? "Warnings have been promoted to errors for validation tool" : undefined
            }
        };
    }

    it('treats warnings as errors and sets validation ok to false', () => {
        const nodeTypes = makeRegistry([
            ['dummy.type1', 1],
            ['dummy.type2', 1],
        ]);

        const workflow = {
            name: 'DUMMY_UNCONNECTED',
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

        const result = simulateValidateWorkflowTool(workflow, nodeTypes);

        // Should be successful but validation not ok due to warnings converted to errors
        expect(result.success).toBe(true);
        expect(result.validation.ok).toBe(false);

        // Should have 2 errors (converted from warnings)
        expect(result.validation.errors.length).toBe(2);

        // Should track original warning count
        expect(result.validation.originalWarningCount).toBe(2);

        // Should have note about promotion
        expect(result.validation.note).toBe("Warnings have been promoted to errors for validation tool");

        // Errors should contain the unconnected node warnings with node IDs
        const errorCodes = result.validation.errors.map(e => e.code);
        expect(errorCodes).toEqual(['unconnected_node', 'unconnected_node']);

        // Check that node IDs are included in the error details
        expect(result.validation.errors[0].details.nodeId).toBe('node-abc-123');
        expect(result.validation.errors[1].details.nodeId).toBe('node-def-456');

        // Check that messages include node IDs
        expect(result.validation.errors[0].message).toContain('node-abc-123');
        expect(result.validation.errors[1].message).toContain('node-def-456');
    });

    it('handles workflows with no warnings correctly', () => {
        const nodeTypes = makeRegistry([
            ['dummy.source', 1],
            ['dummy.target', 1],
        ]);

        const workflow = {
            name: 'DUMMY_CONNECTED',
            nodes: [
                {
                    id: 'source-123',
                    name: 'Source',
                    type: 'dummy.source',
                    typeVersion: 1,
                    parameters: {}
                },
                {
                    id: 'target-456',
                    name: 'Target',
                    type: 'dummy.target',
                    typeVersion: 1,
                    parameters: {}
                },
            ],
            connections: {
                Source: {
                    main: [
                        [{ node: 'Target', type: 'main', index: 0 }]
                    ]
                }
            },
        };

        const result = simulateValidateWorkflowTool(workflow, nodeTypes);

        // Should be successful and validation ok
        expect(result.success).toBe(true);
        expect(result.validation.ok).toBe(true);

        // Should have no errors
        expect(result.validation.errors.length).toBe(0);

        // Should have zero original warnings
        expect(result.validation.originalWarningCount).toBe(0);

        // Should have no note
        expect(result.validation.note).toBeUndefined();
    });

    it('combines real errors with promoted warnings', () => {
        const nodeTypes = makeRegistry([
            ['dummy.type1', 1],
            // Don't register dummy.type2 to create a real error
        ]);

        const workflow = {
            name: 'DUMMY_MIXED_ISSUES',
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
                    type: 'dummy.type2', // This will cause a real error
                    typeVersion: 1,
                    parameters: {}
                },
            ],
            connections: {},
        };

        const result = simulateValidateWorkflowTool(workflow, nodeTypes);

        // Should be successful but validation not ok
        expect(result.success).toBe(true);
        expect(result.validation.ok).toBe(false);

        // Should have multiple errors (both real errors and promoted warnings)
        expect(result.validation.errors.length).toBeGreaterThan(0);

        // Should have note about promotion since there are warnings
        expect(result.validation.originalWarningCount).toBeGreaterThan(0);
        expect(result.validation.note).toBe("Warnings have been promoted to errors for validation tool");
    });

    it('removes warnings field from response', () => {
        const nodeTypes = makeRegistry([
            ['dummy.type1', 1],
        ]);

        const workflow = {
            name: 'DUMMY_UNCONNECTED',
            nodes: [
                {
                    id: 'node-abc-123',
                    name: 'A',
                    type: 'dummy.type1',
                    typeVersion: 1,
                    parameters: {}
                },
            ],
            connections: {},
        };

        const result = simulateValidateWorkflowTool(workflow, nodeTypes);

        // Should not have warnings field at all
        expect(result.validation.hasOwnProperty('warnings')).toBe(false);

        // But should have errors field
        expect(result.validation.hasOwnProperty('errors')).toBe(true);
    });
});
