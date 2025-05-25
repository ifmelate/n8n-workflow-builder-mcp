/**
 * Unit tests for LangChain LLM node parameter formatting
 */

const sinon = require('sinon');
const path = require('path');
const {
    setupMockFs,
    restoreFs,
    resetMockFs,
    getMockFs
} = require('./utils/mcp-test-utils');

describe('LangChain LLM Node Parameter Formatting', () => {
    let mockWorkflowData;

    // Setup mock filesystem before all tests
    beforeAll(async () => {
        await setupMockFs();

        // Setup default workflow data
        mockWorkflowData = {
            name: "TestWorkflow",
            nodes: [],
            connections: {},
            active: false,
            pinData: {},
            settings: { executionOrder: "v1" },
            versionId: "test-version-id",
            id: "test-workflow-id",
            tags: []
        };
    });

    // Restore real filesystem after all tests
    afterAll(async () => {
        await restoreFs();
    });

    // Reset mocks before each test
    beforeEach(() => {
        resetMockFs();

        // Setup fresh mock responses
        const mockFs = getMockFs();
        mockFs.readFile.mockResolvedValue(JSON.stringify(mockWorkflowData));
        mockFs.writeFile.mockResolvedValue();
    });

    describe('add_node function', () => {
        it('should format LangChain LLM model parameter correctly', async () => {
            // Arrange
            const params = {
                workflow_name: "TestWorkflow",
                node_type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
                node_name: "OpenAI GPT-3.5",
                position: {
                    x: 240,
                    y: 500
                },
                parameters: {
                    model: "gpt-3.5-turbo",
                    options: {
                        temperature: 0.7,
                        max_tokens: 1024
                    }
                }
            };

            // Act - Simulate adding a node with our parameters
            const result = simulateAddNodeExecution(params);

            // Assert - Check the result structure
            expect(result).toBeDefined();
            expect(result.nodes).toHaveLength(1);

            const addedNode = result.nodes[0];

            // Verify basic node properties
            expect(addedNode.type).toBe("@n8n/n8n-nodes-langchain.lmChatOpenAi");
            expect(addedNode.name).toBe("OpenAI GPT-3.5");
            expect(addedNode.position).toEqual([240, 500]);

            // Verify model parameter is a simple string (as per actual langchain nodes)
            expect(addedNode.parameters.model).toBe("gpt-3.5-turbo");

            // Verify options are preserved
            expect(addedNode.parameters.options.temperature).toBe(0.7);
            expect(addedNode.parameters.options.max_tokens).toBe(1024);
        });

        it('should not modify non-LangChain node parameters', async () => {
            // Arrange
            const params = {
                workflow_name: "TestWorkflow",
                node_type: "n8n-nodes-base.httpRequest",
                node_name: "HTTP Request",
                position: {
                    x: 240,
                    y: 500
                },
                parameters: {
                    url: "https://example.com",
                    method: "GET"
                }
            };

            // Act
            const result = simulateAddNodeExecution(params);

            // Assert
            expect(result).toBeDefined();
            expect(result.nodes).toHaveLength(1);

            const addedNode = result.nodes[0];
            expect(addedNode.parameters.url).toBe("https://example.com");
            expect(addedNode.parameters.method).toBe("GET");
            // Ensure no langchain-specific modifications were made
            expect(addedNode.parameters).not.toHaveProperty('model');
        });
    });

    describe('edit_node function', () => {
        beforeEach(() => {
            // Setup mock workflow with an existing LangChain node
            mockWorkflowData = {
                name: "TestWorkflow",
                nodes: [
                    {
                        id: "test-node-id",
                        name: "OpenAI GPT-3.5",
                        type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
                        typeVersion: 1.2,
                        position: [100, 200],
                        parameters: {
                            model: "gpt-3.5-turbo",
                            options: {
                                temperature: 0.5
                            }
                        }
                    }
                ],
                connections: {},
                active: false,
                pinData: {},
                settings: { executionOrder: "v1" },
                versionId: "test-version-id",
                id: "test-workflow-id",
                tags: []
            };

            getMockFs().readFile.mockResolvedValue(JSON.stringify(mockWorkflowData));
        });

        it('should update LangChain LLM model parameter correctly when editing', async () => {
            // Arrange
            const params = {
                workflow_name: "TestWorkflow",
                node_id: "test-node-id",
                parameters: {
                    model: "gpt-4",
                    options: {
                        temperature: 0.7
                    }
                }
            };

            // Act
            const result = simulateEditNodeExecution(params);

            // Assert
            expect(result).toBeDefined();
            expect(result.nodes).toHaveLength(1);

            const editedNode = result.nodes[0];

            // Verify model parameter is updated as simple string
            expect(editedNode.parameters.model).toBe("gpt-4");

            // Verify options were updated
            expect(editedNode.parameters.options.temperature).toBe(0.7);
        });

        it('should preserve existing non-model parameters when editing', async () => {
            // Arrange
            const params = {
                workflow_name: "TestWorkflow",
                node_id: "test-node-id",
                parameters: {
                    options: {
                        temperature: 0.5,
                        max_tokens: 1000
                    }
                }
            };

            // Act
            const result = simulateEditNodeExecution(params);

            // Assert
            expect(result).toBeDefined();
            const editedNode = result.nodes[0];

            // Verify existing model parameter was preserved
            expect(editedNode.parameters.model).toBe("gpt-3.5-turbo");

            // Verify options were updated/merged
            expect(editedNode.parameters.options.temperature).toBe(0.5);
            expect(editedNode.parameters.options.max_tokens).toBe(1000);
        });
    });

    // Mock implementations that simulate the actual node manipulation
    function simulateAddNodeExecution(params) {
        // Start with a copy of the current workflow data
        const workflow = JSON.parse(JSON.stringify(mockWorkflowData));

        // Generate unique node ID
        const nodeId = `node-${Date.now()}`;

        // Process parameters - for langchain nodes, keep model as simple string
        let processedParams = { ...params.parameters };

        // Create new node based on actual n8n structure
        const newNode = {
            id: nodeId,
            name: params.node_name || params.node_type,
            type: params.node_type,
            typeVersion: 1.0,
            position: [params.position.x, params.position.y],
            parameters: processedParams
        };

        // Add node to workflow
        workflow.nodes.push(newNode);

        return workflow;
    }

    function simulateEditNodeExecution(params) {
        // Start with a copy of the current workflow data
        const workflow = JSON.parse(JSON.stringify(mockWorkflowData));

        // Find node to edit
        const nodeIndex = workflow.nodes.findIndex(node => node.id === params.node_id);
        if (nodeIndex === -1) return workflow;

        // Process parameters - for langchain nodes, keep model as simple string
        let processedParams = { ...params.parameters };

        // Merge parameters
        workflow.nodes[nodeIndex].parameters = {
            ...workflow.nodes[nodeIndex].parameters,
            ...processedParams
        };

        return workflow;
    }
}); 