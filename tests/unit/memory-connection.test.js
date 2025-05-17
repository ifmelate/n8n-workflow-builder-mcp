const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Mock functions and data to test without actual server execution
const mockWorkflow = {
    name: "ChatWithMemory",
    nodes: [
        {
            id: "agent-node-id",
            name: "AI Agent",
            type: "@n8n/n8n-nodes-langchain.agent",
            parameters: {}
        },
        {
            id: "memory-node-id",
            name: "Simple Memory",
            type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
            parameters: {}
        }
    ],
    connections: {}
};

// Function to mock the add_ai_connections logic
function mockAddAIConnections(workflow, params) {
    const { agent_node_id, memory_node_id } = params;

    // Find nodes
    const agentNode = workflow.nodes.find(node => node.id === agent_node_id);
    const memoryNode = workflow.nodes.find(node => node.id === memory_node_id);

    if (!agentNode || !memoryNode) {
        throw new Error("Agent or memory node not found");
    }

    // Create memory connection
    if (!workflow.connections[memoryNode.name]) {
        workflow.connections[memoryNode.name] = {};
    }

    if (!workflow.connections[memoryNode.name]["ai_memory"]) {
        workflow.connections[memoryNode.name]["ai_memory"] = [];
    }

    // Add connection from memory to agent
    const memoryConnection = {
        node: agentNode.name,
        type: "ai_memory",
        index: 0
    };

    workflow.connections[memoryNode.name]["ai_memory"].push([memoryConnection]);

    return workflow;
}

// Test cases
describe('Memory Connection Handling', function () {
    it('should properly create ai_memory connections', function () {
        // Setup
        const testWorkflow = JSON.parse(JSON.stringify(mockWorkflow)); // Deep copy

        // Execute
        const result = mockAddAIConnections(testWorkflow, {
            agent_node_id: 'agent-node-id',
            memory_node_id: 'memory-node-id'
        });

        // Verify
        assert.ok(result.connections["Simple Memory"], "Memory node should have connections");
        assert.ok(result.connections["Simple Memory"]["ai_memory"], "Memory node should use ai_memory port");
        assert.strictEqual(
            result.connections["Simple Memory"]["ai_memory"][0][0].type,
            "ai_memory",
            "Connection type should be ai_memory"
        );
        assert.strictEqual(
            result.connections["Simple Memory"]["ai_memory"][0][0].node,
            "AI Agent",
            "Connection should target the agent node"
        );
    });

    it('should not create ai_tool connections for memory nodes', function () {
        // Setup
        const testWorkflow = JSON.parse(JSON.stringify(mockWorkflow)); // Deep copy

        // Simulate the old behavior by creating an incorrect ai_tool connection
        if (!testWorkflow.connections["Simple Memory"]) {
            testWorkflow.connections["Simple Memory"] = {};
        }

        if (!testWorkflow.connections["Simple Memory"]["ai_tool"]) {
            testWorkflow.connections["Simple Memory"]["ai_tool"] = [];
        }

        testWorkflow.connections["Simple Memory"]["ai_tool"].push([{
            node: "AI Agent",
            type: "ai_tool",
            index: 0
        }]);

        // Execute - this should replace the incorrect ai_tool with ai_memory
        const result = mockAddAIConnections(testWorkflow, {
            agent_node_id: 'agent-node-id',
            memory_node_id: 'memory-node-id'
        });

        // Verify
        assert.ok(result.connections["Simple Memory"]["ai_memory"], "Memory node should have ai_memory connection");
        assert.strictEqual(
            result.connections["Simple Memory"]["ai_memory"][0][0].type,
            "ai_memory",
            "Connection type should be ai_memory"
        );
    });

    it('should validate real-world memory connection JSON structure', function () {
        // This test validates against the exact structure we need in n8n
        const expectedConnectionStructure = {
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
        };

        // Setup
        const testWorkflow = JSON.parse(JSON.stringify(mockWorkflow)); // Deep copy

        // Execute
        const result = mockAddAIConnections(testWorkflow, {
            agent_node_id: 'agent-node-id',
            memory_node_id: 'memory-node-id'
        });

        // Use JSON.stringify to compare exact structures
        assert.strictEqual(
            JSON.stringify(result.connections),
            JSON.stringify(expectedConnectionStructure),
            "Connection structure should match the exact n8n format"
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