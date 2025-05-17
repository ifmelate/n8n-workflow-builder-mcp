/**
 * Unit tests for the Node Management module
 */

const { expect } = require('chai');
const sinon = require('sinon');
const nodeManagement = require('../../src/tools/nodeManagement');
const { workflowStorage } = require('../../src/models/storage');
const nodeDiscovery = require('../../src/tools/nodeDiscovery');

describe('Node Management', () => {

    describe('generateUniqueNodeId', () => {
        it('should generate a unique ID with format node1 for empty workflow', () => {
            const workflow = { nodes: [] };
            const nodeId = nodeManagement.generateUniqueNodeId(workflow);
            expect(nodeId).to.equal('node1');
        });

        it('should increment the highest existing node ID', () => {
            const workflow = {
                nodes: [
                    { id: 'node1' },
                    { id: 'node2' },
                    { id: 'node5' }
                ]
            };
            const nodeId = nodeManagement.generateUniqueNodeId(workflow);
            expect(nodeId).to.equal('node6');
        });

        it('should handle workflows without nodes array', () => {
            const workflow = {};
            const nodeId = nodeManagement.generateUniqueNodeId(workflow);
            expect(nodeId).to.equal('node1');
        });
    });

    describe('validateNodeParameters', () => {
        it('should return true for valid parameters', () => {
            const nodeTypeDef = {
                parameters: [
                    { name: 'url', required: true },
                    { name: 'method', required: false }
                ]
            };
            const parameters = { url: 'http://example.com', method: 'GET' };

            expect(nodeManagement.validateNodeParameters(nodeTypeDef, parameters)).to.be.true;
        });

        it('should throw error for missing required parameters', () => {
            const nodeTypeDef = {
                parameters: [
                    { name: 'url', required: true },
                    { name: 'method', required: true }
                ]
            };
            const parameters = { url: 'http://example.com' };

            expect(() => nodeManagement.validateNodeParameters(nodeTypeDef, parameters)).to.throw(/Missing required parameters/);
        });

        it('should return true if no parameters provided and none required', () => {
            const nodeTypeDef = {
                parameters: [
                    { name: 'url', required: false },
                    { name: 'method', required: false }
                ]
            };

            expect(nodeManagement.validateNodeParameters(nodeTypeDef, null)).to.be.true;
        });
    });

    describe('getNodeTypeDefinition', () => {
        let getNodesFromSourceStub;

        beforeEach(() => {
            getNodesFromSourceStub = sinon.stub(nodeDiscovery, 'getNodesFromSource');
        });

        afterEach(() => {
            getNodesFromSourceStub.restore();
        });

        it('should return node definition when node type exists', async () => {
            const mockNodes = [
                { id: 'http', name: 'HTTP Request' },
                { id: 'email', name: 'Email' }
            ];

            getNodesFromSourceStub.resolves(mockNodes);

            const nodeDef = await nodeManagement.getNodeTypeDefinition('http');
            expect(nodeDef).to.deep.equal({ id: 'http', name: 'HTTP Request' });
        });

        it('should return null when node type does not exist', async () => {
            const mockNodes = [
                { id: 'http', name: 'HTTP Request' }
            ];

            getNodesFromSourceStub.resolves(mockNodes);

            const nodeDef = await nodeManagement.getNodeTypeDefinition('nonexistent');
            expect(nodeDef).to.be.null;
        });
    });

    describe('addNode', () => {
        let loadWorkflowStub;
        let saveWorkflowStub;
        let getNodeTypeDefinitionStub;

        beforeEach(() => {
            loadWorkflowStub = sinon.stub(workflowStorage, 'loadWorkflow');
            saveWorkflowStub = sinon.stub(workflowStorage, 'saveWorkflow');
            getNodeTypeDefinitionStub = sinon.stub(nodeManagement, 'getNodeTypeDefinition');
        });

        afterEach(() => {
            loadWorkflowStub.restore();
            saveWorkflowStub.restore();
            getNodeTypeDefinitionStub.restore();
        });

        it('should add a node to an existing workflow', async () => {
            const workflow = {
                id: 'test-workflow',
                name: 'Test Workflow',
                nodes: []
            };

            const nodeTypeDef = {
                id: 'http',
                name: 'HTTP Request',
                parameters: []
            };

            loadWorkflowStub.resolves(workflow);
            getNodeTypeDefinitionStub.resolves(nodeTypeDef);
            saveWorkflowStub.resolves({ success: true, path: 'test-workflow.json' });

            const result = await nodeManagement.addNode({
                workflowId: 'test-workflow',
                nodeType: 'http',
                position: { x: 200, y: 200 }
            });

            expect(result.success).to.be.true;
            expect(result.nodeId).to.equal('node1');
            expect(result.workflow.nodes.length).to.equal(1);
            expect(result.workflow.nodes[0].type).to.equal('http');
            expect(result.workflow.nodes[0].position).to.deep.equal({ x: 200, y: 200 });
        });

        it('should throw error when workflow not found', async () => {
            loadWorkflowStub.resolves(null);

            try {
                await nodeManagement.addNode({
                    workflowId: 'nonexistent',
                    nodeType: 'http'
                });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('not found');
            }
        });

        it('should throw error when node type not found', async () => {
            const workflow = {
                id: 'test-workflow',
                nodes: []
            };

            loadWorkflowStub.resolves(workflow);
            getNodeTypeDefinitionStub.resolves(null);

            try {
                await nodeManagement.addNode({
                    workflowId: 'test-workflow',
                    nodeType: 'nonexistent'
                });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('not found');
            }
        });
    });

    describe('checkConnectionCompatibility', () => {
        it('should return compatible for similar node types', () => {
            const originalNodeDef = {
                id: 'http',
                name: 'HTTP Request',
                categories: ['HTTP']
            };

            const newNodeDef = {
                id: 'httprequest',
                name: 'HTTP Request (Advanced)',
                categories: ['HTTP']
            };

            const compatibility = nodeManagement.checkConnectionCompatibility(originalNodeDef, newNodeDef);
            expect(compatibility.inputCompatible).to.be.true;
            expect(compatibility.outputCompatible).to.be.true;
            expect(compatibility.warnings).to.be.an('array').that.is.empty;
        });

        it('should detect trigger incompatibility', () => {
            const originalNodeDef = {
                id: 'polling',
                name: 'Polling Trigger',
                categories: ['Trigger']
            };

            const newNodeDef = {
                id: 'http',
                name: 'HTTP Request',
                categories: ['HTTP']
            };

            const compatibility = nodeManagement.checkConnectionCompatibility(originalNodeDef, newNodeDef);
            expect(compatibility.inputCompatible).to.be.false;
            expect(compatibility.warnings).to.include('Original node was a Trigger but new node is not');
        });

        it('should warn on significant parameter differences', () => {
            const originalNodeDef = {
                id: 'database',
                name: 'Database',
                parameters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] // 10 parameters
            };

            const newNodeDef = {
                id: 'simplefile',
                name: 'Simple File',
                parameters: [1, 2] // 2 parameters
            };

            const compatibility = nodeManagement.checkConnectionCompatibility(originalNodeDef, newNodeDef);
            expect(compatibility.inputCompatible).to.be.true;
            expect(compatibility.outputCompatible).to.be.true;
            expect(compatibility.warnings).to.include('New node has significantly fewer parameters than original node');
        });

        it('should handle missing node definitions gracefully', () => {
            const compatibility = nodeManagement.checkConnectionCompatibility(null, null);
            expect(compatibility.inputCompatible).to.be.true;
            expect(compatibility.outputCompatible).to.be.true;
            expect(compatibility.warnings).to.include('Could not determine connection compatibility due to missing node definitions');
        });
    });

    describe('updateConnectionsForReplacedNode', () => {
        let getNodeTypeDefinitionStub;

        beforeEach(() => {
            getNodeTypeDefinitionStub = sinon.stub(nodeManagement, 'getNodeTypeDefinition');
        });

        afterEach(() => {
            getNodeTypeDefinitionStub.restore();
        });

        it('should maintain connections between compatible nodes', async () => {
            // Create mock node definitions
            const httpDef = {
                id: 'http',
                name: 'HTTP Request',
                categories: ['HTTP']
            };

            const httpsDef = {
                id: 'https',
                name: 'HTTPS Request',
                categories: ['HTTP']
            };

            getNodeTypeDefinitionStub.withArgs('http').resolves(httpDef);
            getNodeTypeDefinitionStub.withArgs('https').resolves(httpsDef);

            // Create test workflow with connections
            const workflow = {
                nodes: [
                    { id: 'node1', type: 'http' },
                    { id: 'node2', type: 'set' },
                    { id: 'node3', type: 'function' }
                ],
                connections: [
                    {
                        source: { node: 'node1', output: 'main' },
                        target: { node: 'node2', input: 'main' }
                    },
                    {
                        source: { node: 'node2', output: 'main' },
                        target: { node: 'node3', input: 'main' }
                    }
                ]
            };

            const result = await nodeManagement.updateConnectionsForReplacedNode(
                workflow, 'node1', 'http', 'https'
            );

            // Connections should be maintained
            expect(result.workflow.connections.length).to.equal(2);
            expect(result.compatibility.warnings).to.be.an('array').that.is.empty;
        });

        it('should remove incompatible connections when replacing a trigger node', async () => {
            // Create mock node definitions
            const triggerDef = {
                id: 'trigger',
                name: 'Webhook Trigger',
                categories: ['Trigger']
            };

            const httpDef = {
                id: 'http',
                name: 'HTTP Request',
                categories: ['HTTP']
            };

            getNodeTypeDefinitionStub.withArgs('trigger').resolves(triggerDef);
            getNodeTypeDefinitionStub.withArgs('http').resolves(httpDef);

            // Create test workflow with connections
            const workflow = {
                nodes: [
                    { id: 'node1', type: 'trigger' },
                    { id: 'node2', type: 'set' },
                    { id: 'node3', type: 'function' }
                ],
                connections: [
                    {
                        source: { node: 'node1', output: 'main' },
                        target: { node: 'node2', input: 'main' }
                    },
                    {
                        source: { node: 'node2', output: 'main' },
                        target: { node: 'node3', input: 'main' }
                    }
                ]
            };

            const result = await nodeManagement.updateConnectionsForReplacedNode(
                workflow, 'node1', 'trigger', 'http'
            );

            // The first connection where node1 is source should be removed
            expect(result.workflow.connections.length).to.equal(1);
            expect(result.workflow.connections[0].source.node).to.equal('node2');
            expect(result.compatibility.warnings).to.include('Original node was a Trigger but new node is not');
        });

        it('should handle workflows without connections array', async () => {
            const workflowWithoutConnections = {
                nodes: [
                    { id: 'node1', type: 'http' }
                ]
                // No connections property
            };

            const result = await nodeManagement.updateConnectionsForReplacedNode(
                workflowWithoutConnections, 'node1', 'http', 'https'
            );

            expect(result.workflow).to.deep.equal(workflowWithoutConnections);
        });
    });

    describe('replaceNode', () => {
        let loadWorkflowStub;
        let saveWorkflowStub;
        let getNodeTypeDefinitionStub;
        let updateConnectionsStub;

        beforeEach(() => {
            loadWorkflowStub = sinon.stub(workflowStorage, 'loadWorkflow');
            saveWorkflowStub = sinon.stub(workflowStorage, 'saveWorkflow');
            getNodeTypeDefinitionStub = sinon.stub(nodeManagement, 'getNodeTypeDefinition');
            updateConnectionsStub = sinon.stub(nodeManagement, 'updateConnectionsForReplacedNode');
        });

        afterEach(() => {
            loadWorkflowStub.restore();
            saveWorkflowStub.restore();
            getNodeTypeDefinitionStub.restore();
            updateConnectionsStub.restore();
        });

        it('should replace a node in an existing workflow', async () => {
            // Setup workflow with an existing node
            const workflow = {
                id: 'test-workflow',
                name: 'Test Workflow',
                nodes: [
                    {
                        id: 'node1',
                        name: 'HTTP Request',
                        type: 'http',
                        position: { x: 100, y: 100 },
                        parameters: { url: 'https://example.com' }
                    }
                ]
            };

            // Setup node type definition for the new node
            const nodeTypeDef = {
                id: 'httpbin',
                name: 'HTTPBin',
                parameters: []
            };

            // Setup stubs
            loadWorkflowStub.resolves(workflow);
            getNodeTypeDefinitionStub.resolves(nodeTypeDef);
            updateConnectionsStub.resolves({
                workflow: workflow,
                compatibility: { warnings: [] }
            });
            saveWorkflowStub.resolves({ success: true, path: 'test-workflow.json' });

            // Execute the replace operation
            const result = await nodeManagement.replaceNode({
                workflowId: 'test-workflow',
                targetNodeId: 'node1',
                newNodeType: 'httpbin',
                parameters: { endpoint: '/get' }
            });

            // Verify the result
            expect(result.success).to.be.true;
            expect(result.nodeId).to.equal('node1');

            // Verify the node was replaced
            const replacedNode = result.workflow.nodes[0];
            expect(replacedNode.type).to.equal('httpbin');
            expect(replacedNode.parameters.endpoint).to.equal('/get');

            // Verify position was maintained
            expect(replacedNode.position).to.deep.equal({ x: 100, y: 100 });
        });

        it('should throw error when workflow not found', async () => {
            loadWorkflowStub.resolves(null);

            try {
                await nodeManagement.replaceNode({
                    workflowId: 'nonexistent',
                    targetNodeId: 'node1',
                    newNodeType: 'https'
                });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('not found');
            }
        });

        it('should throw error when target node not found', async () => {
            const workflow = {
                id: 'test-workflow',
                nodes: [
                    { id: 'node1', type: 'http' }
                ]
            };

            loadWorkflowStub.resolves(workflow);

            try {
                await nodeManagement.replaceNode({
                    workflowId: 'test-workflow',
                    targetNodeId: 'nonexistent',
                    newNodeType: 'https'
                });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('not found in workflow');
            }
        });

        it('should throw error when new node type not found', async () => {
            const workflow = {
                id: 'test-workflow',
                nodes: [
                    { id: 'node1', type: 'http' }
                ]
            };

            loadWorkflowStub.resolves(workflow);
            getNodeTypeDefinitionStub.resolves(null);

            try {
                await nodeManagement.replaceNode({
                    workflowId: 'test-workflow',
                    targetNodeId: 'node1',
                    newNodeType: 'nonexistent'
                });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('not found');
            }
        });

        it('should handle connection compatibility warnings', async () => {
            const workflow = {
                id: 'test-workflow',
                nodes: [
                    { id: 'node1', type: 'trigger' }
                ],
                connections: []
            };

            // Setup node type definition for the new node
            const nodeTypeDef = {
                id: 'http',
                name: 'HTTP Request',
                parameters: []
            };

            loadWorkflowStub.resolves(workflow);
            getNodeTypeDefinitionStub.resolves(nodeTypeDef);

            // Set up connection update with a warning
            updateConnectionsStub.resolves({
                workflow: workflow,
                compatibility: {
                    warnings: ['Original node was a Trigger but new node is not']
                }
            });
            saveWorkflowStub.resolves({ success: true, path: 'test-workflow.json' });

            // Execute the replace operation
            const result = await nodeManagement.replaceNode({
                workflowId: 'test-workflow',
                targetNodeId: 'node1',
                newNodeType: 'http'
            });

            // Verify compatibility warnings are included in result
            expect(result.compatibility).to.include('Original node was a Trigger but new node is not');
        });
    });
}); 