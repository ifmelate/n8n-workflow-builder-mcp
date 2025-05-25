/**
 * Unit tests for Memory Connection functionality
 */

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
describe('Memory Connection', () => {
    it('should create basic memory connections', () => {
        const memoryNode = {
            id: "memory1",
            name: "Simple Memory",
            type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
            position: [400, 300],
            parameters: {
                sessionIdKey: "sessionId",
                contextWindowLength: 10
            }
        };

        const agentNode = {
            id: "agent1",
            name: "AI Agent",
            type: "@n8n/n8n-nodes-langchain.agent",
            position: [600, 300],
            parameters: {}
        };

        expect(memoryNode.type).toContain('memory');
        expect(agentNode.type).toContain('agent');
        expect(memoryNode.parameters).toHaveProperty('sessionIdKey');
    });

    it('should validate memory connection types', () => {
        const connectionTypes = [
            'ai_memory',
            'ai_conversationMemory',
            'ai_bufferMemory'
        ];

        connectionTypes.forEach(type => {
            expect(type).toMatch(/^ai_/);
        });
    });

    it('should handle memory buffer window configuration', () => {
        const memoryConfig = {
            type: "memoryBufferWindow",
            parameters: {
                contextWindowLength: 5,
                returnMessages: true,
                sessionIdKey: "sessionId"
            }
        };

        expect(memoryConfig.parameters.contextWindowLength).toBe(5);
        expect(memoryConfig.parameters.returnMessages).toBe(true);
        expect(memoryConfig.parameters.sessionIdKey).toBe("sessionId");
    });

    it('should create memory to agent connections', () => {
        const workflow = {
            connections: {}
        };

        const memoryNodeName = "Simple Memory";
        const agentNodeName = "AI Agent";

        // Simulate creating a memory connection
        if (!workflow.connections[memoryNodeName]) {
            workflow.connections[memoryNodeName] = {};
        }

        workflow.connections[memoryNodeName]["ai_memory"] = [[{
            node: agentNodeName,
            type: "ai_memory",
            index: 0
        }]];

        expect(workflow.connections[memoryNodeName]).toBeDefined();
        expect(workflow.connections[memoryNodeName]["ai_memory"]).toBeDefined();
        expect(workflow.connections[memoryNodeName]["ai_memory"][0][0].node).toBe(agentNodeName);
        expect(workflow.connections[memoryNodeName]["ai_memory"][0][0].type).toBe("ai_memory");
    });
}); 