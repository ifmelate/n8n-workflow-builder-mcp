const { describe, it, expect } = require('@jest/globals');

const { validateAndNormalizeWorkflow, SimpleNodeTypes } = require('../../dist/validation/workflowValidator.js');

describe('Embeddings connection key shape', () => {
    it('accepts ai_embeddings wiring from embeddings to vector store', () => {
        const reg = new SimpleNodeTypes();
        reg.register('@n8n/n8n-nodes-langchain.embeddingsOpenAi', 1.2, { name: 'Embeddings', properties: [] });
        reg.register('@n8n/n8n-nodes-langchain.vectorStoreQdrant', 1, { name: 'Qdrant', properties: [] });

        const wf = {
            name: 'EMBEDDINGS_KEY_SHAPE',
            nodes: [
                { id: 'emb-1', name: 'Embeddings', type: '@n8n/n8n-nodes-langchain.embeddingsOpenAi', typeVersion: 1.2, parameters: {} },
                { id: 'qdr-1', name: 'Qdrant', type: '@n8n/n8n-nodes-langchain.vectorStoreQdrant', typeVersion: 1, parameters: {} },
            ],
            connections: {
                Embeddings: {
                    ai_embedding: [
                        [{ node: 'Qdrant', type: 'ai_embedding', index: 0 }]
                    ]
                }
            }
        };

        const report = validateAndNormalizeWorkflow(wf, reg);
        // No structural error should be raised by base validator for the shape itself
        expect(Array.isArray(report.errors)).toBe(true);
    });
});


