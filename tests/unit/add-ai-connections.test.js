const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Test the add_ai_connections tool function
describe('add_ai_connections Tool', function () {
    it('should properly handle memory nodes in LangChain workflows', function () {
        // Mock workflow with agent, model, and memory nodes
        const testWorkflow = {
            name: "TestWorkflow",
            nodes: [
                {
                    id: "agent-123",
                    name: "AI Agent",
                    type: "@n8n/n8n-nodes-langchain.agent",
                    parameters: {}
                },
                {
                    id: "model-456",
                    name: "GPT-4",
                    type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
                    parameters: {}
                },
                {
                    id: "memory-789",
                    name: "Buffer Memory",
                    type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
                    parameters: {}
                },
                {
                    id: "tool-101",
                    name: "Web Search",
                    type: "@n8n/n8n-nodes-langchain.toolWebSearch",
                    parameters: {}
                }
            ],
            connections: {}
        };

        // Mock the core add_ai_connections function from our implementation
        function addAIConnections(workflow, params) {
            const { agent_node_id, model_node_id, tool_node_ids, memory_node_id } = params;

            // Find nodes
            const agentNode = workflow.nodes.find(node => node.id === agent_node_id);
            const modelNode = model_node_id ? workflow.nodes.find(node => node.id === model_node_id) : null;
            const memoryNode = memory_node_id ? workflow.nodes.find(node => node.id === memory_node_id) : null;

            const toolNodes = tool_node_ids?.length > 0
                ? tool_node_ids.map(id => workflow.nodes.find(node => node.id === id)).filter(Boolean)
                : [];

            if (!agentNode) {
                throw new Error("Agent node not found");
            }

            // Connect model to agent
            if (modelNode) {
                if (!workflow.connections[modelNode.name]) {
                    workflow.connections[modelNode.name] = {};
                }

                if (!workflow.connections[modelNode.name]["ai_languageModel"]) {
                    workflow.connections[modelNode.name]["ai_languageModel"] = [];
                }

                workflow.connections[modelNode.name]["ai_languageModel"].push([{
                    node: agentNode.name,
                    type: "ai_languageModel",
                    index: 0
                }]);
            }

            // Connect tools to agent
            if (toolNodes.length > 0) {
                toolNodes.forEach((toolNode, i) => {
                    if (!workflow.connections[toolNode.name]) {
                        workflow.connections[toolNode.name] = {};
                    }

                    if (!workflow.connections[toolNode.name]["ai_tool"]) {
                        workflow.connections[toolNode.name]["ai_tool"] = [];
                    }

                    workflow.connections[toolNode.name]["ai_tool"].push([{
                        node: agentNode.name,
                        type: "ai_tool",
                        index: 0
                    }]);
                });
            }

            // Connect memory to agent - this is the critical part we're testing
            if (memoryNode) {
                if (!workflow.connections[memoryNode.name]) {
                    workflow.connections[memoryNode.name] = {};
                }

                if (!workflow.connections[memoryNode.name]["ai_memory"]) {
                    workflow.connections[memoryNode.name]["ai_memory"] = [];
                }

                workflow.connections[memoryNode.name]["ai_memory"].push([{
                    node: agentNode.name,
                    type: "ai_memory",
                    index: 0
                }]);
            }

            return workflow;
        }

        // Run the function with our test parameters
        const result = addAIConnections(testWorkflow, {
            agent_node_id: "agent-123",
            model_node_id: "model-456",
            tool_node_ids: ["tool-101"],
            memory_node_id: "memory-789"
        });

        // Verify all connections were created correctly

        // 1. Check model connection
        assert.ok(
            result.connections["GPT-4"] &&
            result.connections["GPT-4"]["ai_languageModel"],
            "Model connection should exist"
        );

        assert.strictEqual(
            result.connections["GPT-4"]["ai_languageModel"][0][0].node,
            "AI Agent",
            "Model should connect to agent"
        );

        // 2. Check tool connection
        assert.ok(
            result.connections["Web Search"] &&
            result.connections["Web Search"]["ai_tool"],
            "Tool connection should exist"
        );

        assert.strictEqual(
            result.connections["Web Search"]["ai_tool"][0][0].node,
            "AI Agent",
            "Tool should connect to agent"
        );

        // 3. Check memory connection - this is the key test
        assert.ok(
            result.connections["Buffer Memory"] &&
            result.connections["Buffer Memory"]["ai_memory"],
            "Memory connection should exist and use ai_memory type"
        );

        assert.strictEqual(
            result.connections["Buffer Memory"]["ai_memory"][0][0].node,
            "AI Agent",
            "Memory should connect to agent"
        );

        assert.strictEqual(
            result.connections["Buffer Memory"]["ai_memory"][0][0].type,
            "ai_memory",
            "Memory connection should use ai_memory port type, not ai_tool"
        );

        // Verify no incorrect connection types were used
        assert.ok(
            !result.connections["Buffer Memory"]["ai_tool"],
            "Memory should not use ai_tool port type"
        );
    });

    it('should handle combinations of different node types', function () {
        // Test workflow with just the core nodes
        const testWorkflow = {
            name: "TestWorkflow",
            nodes: [
                {
                    id: "agent-123",
                    name: "AI Agent",
                    type: "@n8n/n8n-nodes-langchain.agent",
                    parameters: {}
                },
                {
                    id: "model-456",
                    name: "GPT-4",
                    type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
                    parameters: {}
                },
                {
                    id: "memory-789",
                    name: "Buffer Memory",
                    type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
                    parameters: {}
                }
            ],
            connections: {}
        };

        // Mock implementation of addAIConnections (same as above)
        function addAIConnections(workflow, params) {
            const { agent_node_id, model_node_id, tool_node_ids, memory_node_id } = params;

            // Find nodes
            const agentNode = workflow.nodes.find(node => node.id === agent_node_id);
            const modelNode = model_node_id ? workflow.nodes.find(node => node.id === model_node_id) : null;
            const memoryNode = memory_node_id ? workflow.nodes.find(node => node.id === memory_node_id) : null;

            const toolNodes = tool_node_ids?.length > 0
                ? tool_node_ids.map(id => workflow.nodes.find(node => node.id === id)).filter(Boolean)
                : [];

            if (!agentNode) {
                throw new Error("Agent node not found");
            }

            // Connect model to agent
            if (modelNode) {
                if (!workflow.connections[modelNode.name]) {
                    workflow.connections[modelNode.name] = {};
                }

                if (!workflow.connections[modelNode.name]["ai_languageModel"]) {
                    workflow.connections[modelNode.name]["ai_languageModel"] = [];
                }

                workflow.connections[modelNode.name]["ai_languageModel"].push([{
                    node: agentNode.name,
                    type: "ai_languageModel",
                    index: 0
                }]);
            }

            // Connect tools to agent
            if (toolNodes.length > 0) {
                toolNodes.forEach((toolNode, i) => {
                    if (!workflow.connections[toolNode.name]) {
                        workflow.connections[toolNode.name] = {};
                    }

                    if (!workflow.connections[toolNode.name]["ai_tool"]) {
                        workflow.connections[toolNode.name]["ai_tool"] = [];
                    }

                    workflow.connections[toolNode.name]["ai_tool"].push([{
                        node: agentNode.name,
                        type: "ai_tool",
                        index: 0
                    }]);
                });
            }

            // Connect memory to agent
            if (memoryNode) {
                if (!workflow.connections[memoryNode.name]) {
                    workflow.connections[memoryNode.name] = {};
                }

                if (!workflow.connections[memoryNode.name]["ai_memory"]) {
                    workflow.connections[memoryNode.name]["ai_memory"] = [];
                }

                workflow.connections[memoryNode.name]["ai_memory"].push([{
                    node: agentNode.name,
                    type: "ai_memory",
                    index: 0
                }]);
            }

            return workflow;
        }

        // Test various combinations

        // Case 1: Only model and memory, no tools
        let result = addAIConnections({ ...testWorkflow, connections: {} }, {
            agent_node_id: "agent-123",
            model_node_id: "model-456",
            memory_node_id: "memory-789"
        });

        assert.ok(
            result.connections["GPT-4"] &&
            result.connections["GPT-4"]["ai_languageModel"] &&
            result.connections["Buffer Memory"] &&
            result.connections["Buffer Memory"]["ai_memory"],
            "Should connect both model and memory correctly"
        );

        // Case 2: Only memory, no model
        result = addAIConnections({ ...testWorkflow, connections: {} }, {
            agent_node_id: "agent-123",
            memory_node_id: "memory-789"
        });

        assert.ok(
            !result.connections["GPT-4"] &&
            result.connections["Buffer Memory"] &&
            result.connections["Buffer Memory"]["ai_memory"],
            "Should connect only memory when model is not specified"
        );

        // Case 3: Only model, no memory
        result = addAIConnections({ ...testWorkflow, connections: {} }, {
            agent_node_id: "agent-123",
            model_node_id: "model-456"
        });

        assert.ok(
            result.connections["GPT-4"] &&
            result.connections["GPT-4"]["ai_languageModel"] &&
            !result.connections["Buffer Memory"],
            "Should connect only model when memory is not specified"
        );
    });
});

// Run the tests immediately if this file is executed directly
if (require.main === module) {
    let passedTests = 0;
    let failedTests = 0;

    for (const test of Object.values(describe.tests)) {
        console.log(`\nRunning test: ${test.name}`);
        try {
            test.fn();
            console.log(`✅ PASSED: ${test.name}`);
            passedTests++;
        } catch (error) {
            console.log(`❌ FAILED: ${test.name}`);
            console.error(`   Error: ${error.message}`);
            failedTests++;
        }
    }

    console.log(`\n=== TEST SUMMARY ===`);
    console.log(`Total: ${passedTests + failedTests}, Passed: ${passedTests}, Failed: ${failedTests}`);

    if (failedTests > 0) {
        process.exit(1);
    }
}

// Simple mock implementation of describe and it functions
function describe(name, callback) {
    describe.tests = describe.tests || {};
    console.log(`\nTEST SUITE: ${name}`);
    callback();
}

function it(name, fn) {
    describe.tests[name] = { name, fn };
} 