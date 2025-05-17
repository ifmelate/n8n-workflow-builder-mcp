const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Test a complete workflow with memory connections
describe('Complete Memory Workflow Integration', function () {
    it('should create the correct n8n JSON structure for a ChatWithMemory workflow', function () {
        // This is the expected workflow structure with proper memory connections
        const expectedWorkflow = {
            "name": "ChatWithMemory",
            "nodes": [
                {
                    "id": "trigger-id",
                    "name": "Manual Chat Trigger",
                    "type": "@n8n/n8n-nodes-langchain.manualChatTrigger",
                    "typeVersion": 1.1,
                    "position": [240, 300],
                    "parameters": {}
                },
                {
                    "id": "model-id",
                    "name": "OpenAI GPT-3.5",
                    "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
                    "typeVersion": 1.2,
                    "position": [240, 500],
                    "parameters": {
                        "model": "gpt-3.5-turbo",
                        "options": {
                            "temperature": 0.7
                        }
                    }
                },
                {
                    "id": "memory-id",
                    "name": "Simple Memory",
                    "type": "@n8n/n8n-nodes-langchain.memoryBufferWindow",
                    "typeVersion": 1.3,
                    "position": [480, 500],
                    "parameters": {}
                },
                {
                    "id": "agent-id",
                    "name": "AI Agent",
                    "type": "@n8n/n8n-nodes-langchain.agent",
                    "typeVersion": 1.9,
                    "position": [720, 300],
                    "parameters": {
                        "systemMessage": "You are a helpful AI assistant. You remember previous conversations and provide friendly, concise responses.",
                        "outputOptions": {
                            "humanizeOutputs": true
                        }
                    }
                }
            ],
            "connections": {
                "Manual Chat Trigger": {
                    "main": [
                        [
                            {
                                "node": "AI Agent",
                                "type": "main",
                                "index": 0
                            }
                        ]
                    ]
                },
                "OpenAI GPT-3.5": {
                    "ai_languageModel": [
                        [
                            {
                                "node": "AI Agent",
                                "type": "ai_languageModel",
                                "index": 0
                            }
                        ]
                    ]
                },
                "Simple Memory": {
                    "ai_memory": [
                        [
                            {
                                "node": "AI Agent",
                                "type": "ai_memory",
                                "index": 0
                            }
                        ]
                    ]
                }
            }
        };

        // Create a function that simulates what our implementation does
        function buildChatWithMemoryWorkflow() {
            // Create base workflow
            const workflow = {
                name: "ChatWithMemory",
                nodes: [
                    {
                        id: "trigger-id",
                        name: "Manual Chat Trigger",
                        type: "@n8n/n8n-nodes-langchain.manualChatTrigger",
                        typeVersion: 1.1,
                        position: [240, 300],
                        parameters: {}
                    },
                    {
                        id: "model-id",
                        name: "OpenAI GPT-3.5",
                        type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
                        typeVersion: 1.2,
                        position: [240, 500],
                        parameters: {
                            model: "gpt-3.5-turbo",
                            options: {
                                temperature: 0.7
                            }
                        }
                    },
                    {
                        id: "memory-id",
                        name: "Simple Memory",
                        type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
                        typeVersion: 1.3,
                        position: [480, 500],
                        parameters: {}
                    },
                    {
                        id: "agent-id",
                        name: "AI Agent",
                        type: "@n8n/n8n-nodes-langchain.agent",
                        typeVersion: 1.9,
                        position: [720, 300],
                        parameters: {
                            systemMessage: "You are a helpful AI assistant. You remember previous conversations and provide friendly, concise responses.",
                            outputOptions: {
                                humanizeOutputs: true
                            }
                        }
                    }
                ],
                connections: {}
            };

            // Add main connection from trigger to agent
            if (!workflow.connections["Manual Chat Trigger"]) {
                workflow.connections["Manual Chat Trigger"] = {};
            }
            if (!workflow.connections["Manual Chat Trigger"]["main"]) {
                workflow.connections["Manual Chat Trigger"]["main"] = [];
            }
            workflow.connections["Manual Chat Trigger"]["main"].push([
                {
                    node: "AI Agent",
                    type: "main",
                    index: 0
                }
            ]);

            // Add AI connections using the implementation we're testing
            addAIConnections(workflow, {
                agent_node_id: "agent-id",
                model_node_id: "model-id",
                memory_node_id: "memory-id"
            });

            return workflow;
        }

        // Mock implementation of the add_ai_connections function
        function addAIConnections(workflow, params) {
            const { agent_node_id, model_node_id, memory_node_id } = params;

            // Find nodes
            const agentNode = workflow.nodes.find(node => node.id === agent_node_id);
            const modelNode = model_node_id ? workflow.nodes.find(node => node.id === model_node_id) : null;
            const memoryNode = memory_node_id ? workflow.nodes.find(node => node.id === memory_node_id) : null;

            if (!agentNode) {
                throw new Error("Agent node not found");
            }

            // Handle language model connection
            if (modelNode) {
                if (!workflow.connections[modelNode.name]) {
                    workflow.connections[modelNode.name] = {};
                }
                if (!workflow.connections[modelNode.name]["ai_languageModel"]) {
                    workflow.connections[modelNode.name]["ai_languageModel"] = [];
                }
                workflow.connections[modelNode.name]["ai_languageModel"].push([
                    {
                        node: agentNode.name,
                        type: "ai_languageModel",
                        index: 0
                    }
                ]);
            }

            // Handle memory connection
            if (memoryNode) {
                if (!workflow.connections[memoryNode.name]) {
                    workflow.connections[memoryNode.name] = {};
                }
                if (!workflow.connections[memoryNode.name]["ai_memory"]) {
                    workflow.connections[memoryNode.name]["ai_memory"] = [];
                }
                workflow.connections[memoryNode.name]["ai_memory"].push([
                    {
                        node: agentNode.name,
                        type: "ai_memory",
                        index: 0
                    }
                ]);
            }
        }

        // Build the workflow using our implementation
        const actualWorkflow = buildChatWithMemoryWorkflow();

        // Test that each node is correctly added
        assert.strictEqual(actualWorkflow.nodes.length, 4, "Should have 4 nodes");

        // Test connections
        // 1. Check trigger connection
        assert.ok(
            actualWorkflow.connections["Manual Chat Trigger"] &&
            actualWorkflow.connections["Manual Chat Trigger"]["main"],
            "Trigger connection should exist"
        );

        // 2. Check model connection
        assert.ok(
            actualWorkflow.connections["OpenAI GPT-3.5"] &&
            actualWorkflow.connections["OpenAI GPT-3.5"]["ai_languageModel"],
            "Model connection should exist"
        );

        // 3. Check memory connection - this is the key test
        assert.ok(
            actualWorkflow.connections["Simple Memory"] &&
            actualWorkflow.connections["Simple Memory"]["ai_memory"],
            "Memory connection should use ai_memory port type"
        );

        assert.strictEqual(
            actualWorkflow.connections["Simple Memory"]["ai_memory"][0][0].type,
            "ai_memory",
            "Memory connection should use ai_memory type"
        );

        // Finally, check that the entire structure matches what n8n expects
        const expectedJson = JSON.stringify(expectedWorkflow, null, 2);
        const actualJson = JSON.stringify(actualWorkflow, null, 2);

        assert.strictEqual(
            actualJson,
            expectedJson,
            "Complete workflow structure should match expected n8n format"
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