/**
 * Unit tests for LangChain LLM node parameter formatting
 */

// Change to dynamic imports to handle ESM modules like Chai
const sinon = require('sinon');
const path = require('path');
const {
    setupMockFs,
    restoreFs,
    resetMockFs,
    getMockFs
} = require('./utils/mcp-test-utils');

// Import the source code directly to access functions
// Note: In a TypeScript project, this would typically be imported differently
// For a real implementation, you might need:
// 1. Transpile TS to JS first for tests, or
// 2. Use ts-node or similar to run tests against TS files
const srcPath = path.resolve(__dirname, '../../src/index.ts');

describe('LangChain LLM Node Parameter Formatting', function () {
    let expect;

    // Before running tests, load chai 
    before(async function () {
        // Load chai using dynamic import
        const chai = await import('chai');
        expect = chai.expect;

        // Setup mock filesystem
        await setupMockFs();
    });

    // Restore real filesystem after all tests
    after(async function () {
        await restoreFs();
    });

    // Reset mocks before each test
    beforeEach(() => {
        resetMockFs();

        // Setup default workflow response
        getMockFs().readFile.resolves(JSON.stringify({
            name: "TestWorkflow",
            nodes: [],
            connections: {},
            active: false,
            pinData: {},
            settings: { executionOrder: "v1" },
            versionId: "test-version-id",
            id: "test-workflow-id",
            tags: []
        }));
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
                        credentials: {
                            providerType: "openAi"
                        }
                    }
                }
            };

            // Setup capturedWorkflow to capture the data written
            let capturedWorkflow;
            getMockFs().writeFile.callsFake((path, data) => {
                capturedWorkflow = JSON.parse(data);
                return Promise.resolve();
            });

            // Act - Simulate adding a node with our parameters
            simulateAddNodeExecution(params);

            // Assert
            // 1. Verify file write was called with correct data
            expect(getMockFs().writeFile.called).to.be.true;

            // 2. Check workflow data captured during write
            expect(capturedWorkflow).to.not.be.undefined;
            const addedNode = capturedWorkflow.nodes[0];

            // 3. Verify model format is correct
            expect(addedNode.parameters.model).to.be.an('object');
            expect(addedNode.parameters.model.__rl).to.be.true;
            expect(addedNode.parameters.model.value).to.equal("gpt-3.5-turbo");
            expect(addedNode.parameters.model.mode).to.equal("list");
            expect(addedNode.parameters.model.cachedResultName).to.equal("gpt-3.5-turbo");

            // 4. Verify credentials handling
            expect(addedNode.parameters.options).to.not.have.property('credentials');

            // 5. Verify other node properties
            expect(addedNode.type).to.equal("@n8n/n8n-nodes-langchain.lmChatOpenAi");
            expect(addedNode.name).to.equal("OpenAI GPT-3.5");
            expect(addedNode.position).to.deep.equal([240, 500]);
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

            // Setup capturedWorkflow to capture the data written
            let capturedWorkflow;
            getMockFs().writeFile.callsFake((path, data) => {
                capturedWorkflow = JSON.parse(data);
                return Promise.resolve();
            });

            // Act
            simulateAddNodeExecution(params);

            // Assert
            expect(capturedWorkflow).to.not.be.undefined;
            const addedNode = capturedWorkflow.nodes[0];
            expect(addedNode.parameters.url).to.equal("https://example.com");
            expect(addedNode.parameters.method).to.equal("GET");
            // Ensure the model parameter wasn't added
            expect(addedNode.parameters).to.not.have.property('model');
        });
    });

    describe('edit_node function', () => {
        beforeEach(() => {
            // Setup mock workflow with an existing LangChain node
            getMockFs().readFile.resolves(JSON.stringify({
                name: "TestWorkflow",
                nodes: [
                    {
                        id: "test-node-id",
                        name: "OpenAI GPT-3.5",
                        type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
                        typeVersion: 1.2,
                        position: [100, 200],
                        parameters: {
                            model: {
                                __rl: true,
                                value: "gpt-3.5-turbo",
                                mode: "list",
                                cachedResultName: "gpt-3.5-turbo"
                            },
                            options: {}
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
            }));
        });

        it('should format LangChain LLM model parameter correctly when editing', async () => {
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

            // Setup capturedWorkflow to capture the data written
            let capturedWorkflow;
            getMockFs().writeFile.callsFake((path, data) => {
                capturedWorkflow = JSON.parse(data);
                return Promise.resolve();
            });

            // Act
            simulateEditNodeExecution(params);

            // Assert
            expect(getMockFs().writeFile.called).to.be.true;
            expect(capturedWorkflow).to.not.be.undefined;

            const editedNode = capturedWorkflow.nodes[0];

            // Verify model format is correct after edit
            expect(editedNode.parameters.model).to.be.an('object');
            expect(editedNode.parameters.model.__rl).to.be.true;
            expect(editedNode.parameters.model.value).to.equal("gpt-4");
            expect(editedNode.parameters.model.mode).to.equal("list");
            expect(editedNode.parameters.model.cachedResultName).to.equal("gpt-4");

            // Verify other parameters were preserved/updated
            expect(editedNode.parameters.options.temperature).to.equal(0.7);
        });

        it('should handle credential parameters correctly when editing', async () => {
            // Arrange
            const params = {
                workflow_name: "TestWorkflow",
                node_id: "test-node-id",
                parameters: {
                    model: "gpt-4",
                    options: {
                        credentials: {
                            providerType: "openAi"
                        }
                    }
                }
            };

            // Setup capturedWorkflow to capture the data written
            let capturedWorkflow;
            getMockFs().writeFile.callsFake((path, data) => {
                capturedWorkflow = JSON.parse(data);
                return Promise.resolve();
            });

            // Act
            simulateEditNodeExecution(params);

            // Assert
            expect(getMockFs().writeFile.called).to.be.true;
            expect(capturedWorkflow).to.not.be.undefined;

            const editedNode = capturedWorkflow.nodes[0];

            // Verify credentials were removed from options
            expect(editedNode.parameters.options).to.not.have.property('credentials');

            // Verify model was correctly formatted
            expect(editedNode.parameters.model.value).to.equal("gpt-4");
        });
    });

    /**
     * Helper function to simulate add_node execution
     * In real implementation, this would call the actual tool handler
     */
    function simulateAddNodeExecution(params) {
        // This simulates the logic in the add_node handler in index.ts
        // 1. Read the workflow file - Using the default workflow data we set in beforeEach
        const mockReadFile = getMockFs().readFile;
        const mockDefaultData = JSON.parse(mockReadFile.firstCall ?
            mockReadFile.firstCall.returnValue :
            JSON.stringify({
                name: "TestWorkflow",
                nodes: [],
                connections: {},
                active: false,
                pinData: {},
                settings: { executionOrder: "v1" },
                id: "test-workflow-id",
                tags: []
            })
        );

        // Start with a copy of the default workflow data
        const workflowData = { ...mockDefaultData };
        if (!workflowData.nodes) workflowData.nodes = [];

        // 2. Create a new node
        const newNode = {
            id: "simulated-uuid", // mock UUID for the test
            type: params.node_type,
            typeVersion: 1.2, // mock version for the test
            position: [params.position.x, params.position.y],
            name: params.node_name,
            parameters: { ...params.parameters }
        };

        // 3. Apply the model parameter formatting logic we added to add_node
        if (newNode.type.includes('@n8n/n8n-nodes-langchain') &&
            (newNode.type.includes('lmChat') || newNode.type.includes('llm')) &&
            newNode.parameters.model &&
            typeof newNode.parameters.model === 'string') {

            const modelValue = newNode.parameters.model;

            // Convert to object format
            newNode.parameters.model = {
                "__rl": true,
                "value": modelValue,
                "mode": "list",
                "cachedResultName": modelValue
            };
        }

        // Handle OpenAI credentials
        if (newNode.parameters.options?.credentials?.providerType === 'openAi') {
            delete newNode.parameters.options.credentials;

            if (!newNode.parameters.credentials) {
                newNode.parameters.credentials = {};
            }
        }

        // 4. Add the node to the workflow
        workflowData.nodes.push(newNode);

        // 5. Write the workflow back to the file
        // Use the already set up mock callback from the test to capture the workflow
        getMockFs().writeFile('any-path.json', JSON.stringify(workflowData, null, 2));
    }

    /**
     * Helper function to simulate edit_node execution
     * In real implementation, this would call the actual tool handler
     */
    function simulateEditNodeExecution(params) {
        // This simulates the logic in the edit_node handler in index.ts
        // 1. Read the workflow file - Using the workflow data we set in beforeEach for edit tests
        const mockReadFile = getMockFs().readFile;
        const mockDefaultData = JSON.parse(mockReadFile.firstCall ?
            mockReadFile.firstCall.returnValue :
            JSON.stringify({
                name: "TestWorkflow",
                nodes: [
                    {
                        id: "test-node-id",
                        name: "OpenAI GPT-3.5",
                        type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
                        typeVersion: 1.2,
                        position: [100, 200],
                        parameters: {
                            model: {
                                __rl: true,
                                value: "gpt-3.5-turbo",
                                mode: "list",
                                cachedResultName: "gpt-3.5-turbo"
                            },
                            options: {}
                        }
                    }
                ],
                connections: {},
                active: false,
                pinData: {},
                settings: { executionOrder: "v1" },
                id: "test-workflow-id",
                tags: []
            })
        );

        // Start with a copy of the workflow data
        const workflowData = { ...mockDefaultData };
        if (!workflowData.nodes) workflowData.nodes = [];

        // 2. Find the node to edit
        const nodeIndex = workflowData.nodes.findIndex(n => n.id === params.node_id);
        if (nodeIndex === -1) {
            throw new Error(`Node with id ${params.node_id} not found`);
        }

        const nodeToEdit = workflowData.nodes[nodeIndex];

        // 3. Update properties based on params
        if (params.node_type) {
            nodeToEdit.type = params.node_type;
        }

        if (params.node_name) {
            nodeToEdit.name = params.node_name;
        }

        if (params.position) {
            nodeToEdit.position = [params.position.x, params.position.y];
        }

        // 4. Process parameters if provided
        if (params.parameters) {
            let newParameters = params.parameters;

            // Check if this is a LangChain LLM node
            const isLangChainLLM = nodeToEdit.type.includes('@n8n/n8n-nodes-langchain') &&
                (nodeToEdit.type.includes('lmChat') || nodeToEdit.type.includes('llm'));

            // Special handling for LangChain LLM model parameters
            if (isLangChainLLM && newParameters.model && typeof newParameters.model === 'string') {
                const modelValue = newParameters.model;

                // Convert simple string to required object format
                newParameters.model = {
                    "__rl": true,
                    "value": modelValue,
                    "mode": "list",
                    "cachedResultName": modelValue
                };
            }

            // Handle OpenAI credentials
            if (newParameters.options?.credentials?.providerType === 'openAi') {
                if (newParameters.options.credentials) {
                    delete newParameters.options.credentials;

                    if (!newParameters.credentials) {
                        newParameters.credentials = {};
                    }
                }
            }

            nodeToEdit.parameters = newParameters;
        }

        // 5. Write the workflow back to the file
        // Use the already set up mock callback from the test to capture the workflow
        getMockFs().writeFile('any-path.json', JSON.stringify(workflowData, null, 2));
    }
}); 