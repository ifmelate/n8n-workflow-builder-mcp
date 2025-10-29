const { describe, it, expect } = require('@jest/globals');

const { validateAndNormalizeWorkflow, SimpleNodeTypes } = require('../../dist/validation/workflowValidator.js');

function makeRegistry() {
    const reg = new SimpleNodeTypes();
    reg.register('n8n-nodes-base.webhook', 2.1, { name: 'Webhook', properties: [] });
    reg.register('@n8n/n8n-nodes-langchain.toolVectorStore', 1, { name: 'Vector QA Tool', properties: [] });
    reg.register('n8n-nodes-base.set', 3.4, { name: 'Set', properties: [] });
    return reg;
}

describe('Start node inference prefers webhook over AI-only tool', () => {
    it('chooses webhook as start even if tool appears first in nodes array', () => {
        const nodeTypes = makeRegistry();

        const wf = {
            name: 'DUMMY_START_WEBHOOK',
            nodes: [
                {
                    id: 'tool-1',
                    name: 'Vector QA',
                    type: '@n8n/n8n-nodes-langchain.toolVectorStore',
                    typeVersion: 1,
                    parameters: {}
                },
                {
                    id: 'webhook-1',
                    name: 'Webhook (input)',
                    type: 'n8n-nodes-base.webhook',
                    typeVersion: 2.1,
                    parameters: {}
                },
                {
                    id: 'set-1',
                    name: 'Prepare',
                    type: 'n8n-nodes-base.set',
                    typeVersion: 3.4,
                    parameters: {}
                }
            ],
            connections: {
                'Webhook (input)': {
                    main: [
                        [{ node: 'Prepare', type: 'main', index: 0 }]
                    ]
                }
            }
        };

        const report = validateAndNormalizeWorkflow(wf, nodeTypes);
        expect(report.startNode).toBe('Webhook (input)');
    });

    it('fallback prefers head nodes that have outgoing main when no trigger present', () => {
        const reg = new SimpleNodeTypes();
        reg.register('dummy.node', 1, { name: 'Dummy', properties: [] });

        const wf = {
            name: 'DUMMY_FALLBACK',
            nodes: [
                { id: 'a', name: 'A', type: 'dummy.node', typeVersion: 1, parameters: {} },
                { id: 'b', name: 'B', type: 'dummy.node', typeVersion: 1, parameters: {} },
                { id: 'c', name: 'C', type: 'dummy.node', typeVersion: 1, parameters: {} }
            ],
            connections: {
                A: { main: [[{ node: 'B', type: 'main', index: 0 }]] }
            }
        };

        const report = validateAndNormalizeWorkflow(wf, reg);
        expect(report.startNode).toBe('A');
    });
});


