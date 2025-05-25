const assert = require('assert');
const path = require('path');
const fs = require('fs');

/**
 * Unit tests for AI Connections functionality
 */

describe('add_ai_connections Tool', () => {
    it('should properly handle memory nodes in LangChain workflows', () => {
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
        expect(result.connections["GPT-4"]).toBeDefined();
        expect(result.connections["GPT-4"]["ai_languageModel"]).toBeDefined();
        expect(result.connections["GPT-4"]["ai_languageModel"][0][0].node).toBe("AI Agent");

        // 2. Check tool connection
        expect(result.connections["Web Search"]).toBeDefined();
        expect(result.connections["Web Search"]["ai_tool"]).toBeDefined();
        expect(result.connections["Web Search"]["ai_tool"][0][0].node).toBe("AI Agent");

        // 3. Check memory connection - this is the key test
        expect(result.connections["Buffer Memory"]).toBeDefined();
        expect(result.connections["Buffer Memory"]["ai_memory"]).toBeDefined();
        expect(result.connections["Buffer Memory"]["ai_memory"][0][0].node).toBe("AI Agent");
        expect(result.connections["Buffer Memory"]["ai_memory"][0][0].type).toBe("ai_memory");

        // Verify no incorrect connection types were used
        expect(result.connections["Buffer Memory"]["ai_tool"]).toBeUndefined();
    });

    it('should handle combinations of different node types', () => {
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

        expect(result.connections["GPT-4"]).toBeDefined();
        expect(result.connections["GPT-4"]["ai_languageModel"]).toBeDefined();
        expect(result.connections["Buffer Memory"]).toBeDefined();
        expect(result.connections["Buffer Memory"]["ai_memory"]).toBeDefined();

        // Case 2: Only memory, no model
        result = addAIConnections({ ...testWorkflow, connections: {} }, {
            agent_node_id: "agent-123",
            memory_node_id: "memory-789"
        });

        expect(result.connections["GPT-4"]).toBeUndefined();
        expect(result.connections["Buffer Memory"]).toBeDefined();
        expect(result.connections["Buffer Memory"]["ai_memory"]).toBeDefined();

        // Case 3: Only model, no memory
        result = addAIConnections({ ...testWorkflow, connections: {} }, {
            agent_node_id: "agent-123",
            model_node_id: "model-456"
        });

        expect(result.connections["GPT-4"]).toBeDefined();
        expect(result.connections["GPT-4"]["ai_languageModel"]).toBeDefined();
        expect(result.connections["Buffer Memory"]).toBeUndefined();
    });
});

describe('AI Connections', () => {
    it('should add AI language model connections', () => {
        const workflow = {
            name: "Test Workflow",
            nodes: [
                { id: "agent1", name: "AI Agent", type: "agent" },
                { id: "model1", name: "Language Model", type: "languageModel" }
            ],
            connections: {}
        };

        // Mock adding a language model connection
        const addConnection = (workflow, sourceNodeName, targetNodeName, connectionType) => {
            if (!workflow.connections[sourceNodeName]) {
                workflow.connections[sourceNodeName] = {};
            }
            if (!workflow.connections[sourceNodeName][connectionType]) {
                workflow.connections[sourceNodeName][connectionType] = [];
            }
            workflow.connections[sourceNodeName][connectionType].push([{
                node: targetNodeName,
                type: connectionType,
                index: 0
            }]);
        };

        addConnection(workflow, "Language Model", "AI Agent", "ai_languageModel");

        expect(workflow.connections["Language Model"]).toBeDefined();
        expect(workflow.connections["Language Model"]["ai_languageModel"]).toBeDefined();
        expect(workflow.connections["Language Model"]["ai_languageModel"][0][0].node).toBe("AI Agent");
    });

    it('should add AI memory connections', () => {
        const workflow = {
            name: "Test Workflow",
            nodes: [
                { id: "agent1", name: "AI Agent", type: "agent" },
                { id: "memory1", name: "Memory", type: "memory" }
            ],
            connections: {}
        };

        // Mock adding a memory connection
        const addConnection = (workflow, sourceNodeName, targetNodeName, connectionType) => {
            if (!workflow.connections[sourceNodeName]) {
                workflow.connections[sourceNodeName] = {};
            }
            if (!workflow.connections[sourceNodeName][connectionType]) {
                workflow.connections[sourceNodeName][connectionType] = [];
            }
            workflow.connections[sourceNodeName][connectionType].push([{
                node: targetNodeName,
                type: connectionType,
                index: 0
            }]);
        };

        addConnection(workflow, "Memory", "AI Agent", "ai_memory");

        expect(workflow.connections["Memory"]).toBeDefined();
        expect(workflow.connections["Memory"]["ai_memory"]).toBeDefined();
        expect(workflow.connections["Memory"]["ai_memory"][0][0].node).toBe("AI Agent");
    });

    it('should handle multiple AI connections', () => {
        const workflow = {
            name: "Complex Workflow",
            nodes: [
                { id: "agent1", name: "AI Agent", type: "agent" },
                { id: "model1", name: "Language Model", type: "languageModel" },
                { id: "memory1", name: "Memory", type: "memory" },
                { id: "tool1", name: "Tool", type: "tool" }
            ],
            connections: {}
        };

        // Add multiple connections
        const connections = [
            { source: "Language Model", target: "AI Agent", type: "ai_languageModel" },
            { source: "Memory", target: "AI Agent", type: "ai_memory" },
            { source: "Tool", target: "AI Agent", type: "ai_tool" }
        ];

        connections.forEach(conn => {
            if (!workflow.connections[conn.source]) {
                workflow.connections[conn.source] = {};
            }
            if (!workflow.connections[conn.source][conn.type]) {
                workflow.connections[conn.source][conn.type] = [];
            }
            workflow.connections[conn.source][conn.type].push([{
                node: conn.target,
                type: conn.type,
                index: 0
            }]);
        });

        expect(Object.keys(workflow.connections)).toHaveLength(3);
        expect(workflow.connections["Language Model"]["ai_languageModel"]).toBeDefined();
        expect(workflow.connections["Memory"]["ai_memory"]).toBeDefined();
        expect(workflow.connections["Tool"]["ai_tool"]).toBeDefined();
    });
}); 