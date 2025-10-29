import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as createWorkflow from './tools/createWorkflow';
import * as listWorkflows from './tools/listWorkflows';
import * as getWorkflowDetails from './tools/getWorkflowDetails';
import * as addNode from './tools/addNode';
import * as editNode from './tools/editNode';
import * as deleteNode from './tools/deleteNode';
import * as addConnection from './tools/addConnection';
import * as addAiConnections from './tools/addAiConnections';
import * as composeAiWorkflow from './tools/composeAiWorkflow';
import * as getN8nVersionInfo from './tools/getN8nVersionInfo';
import * as listAvailableNodes from './tools/listAvailableNodes';
import * as validateWorkflow from './tools/validateWorkflow';
import * as connectMainChain from './tools/connectMainChain';
import * as listTemplateExamples from './tools/listTemplateExamples';

/**
 * Register all core MCP tools with the server
 */
export function registerCoreTools(server: McpServer): void {
    // Register create_workflow tool
    server.tool(
        createWorkflow.toolName,
        createWorkflow.description,
        createWorkflow.paramsSchema.shape,
        createWorkflow.handler
    );

    // Register list_workflows tool
    server.tool(
        listWorkflows.toolName,
        listWorkflows.description,
        listWorkflows.paramsSchema.shape,
        listWorkflows.handler
    );

    // Register get_workflow_details tool
    server.tool(
        getWorkflowDetails.toolName,
        getWorkflowDetails.description,
        getWorkflowDetails.paramsSchema.shape,
        getWorkflowDetails.handler
    );

    // Register add_node tool
    server.tool(
        addNode.toolName,
        addNode.description,
        addNode.paramsSchema.shape,
        addNode.handler
    );

    // Register edit_node tool
    server.tool(
        editNode.toolName,
        editNode.description,
        editNode.paramsSchema.shape,
        editNode.handler
    );

    // Register delete_node tool
    server.tool(
        deleteNode.toolName,
        deleteNode.description,
        deleteNode.paramsSchema.shape,
        deleteNode.handler
    );

    // Register add_connection tool
    server.tool(
        addConnection.toolName,
        addConnection.description,
        addConnection.paramsSchema.shape,
        addConnection.handler
    );

    // Register add_ai_connections tool
    server.tool(
        addAiConnections.toolName,
        addAiConnections.description,
        addAiConnections.paramsSchema.shape,
        addAiConnections.handler
    );

    // Register compose_ai_workflow tool
    server.tool(
        composeAiWorkflow.toolName,
        composeAiWorkflow.description,
        composeAiWorkflow.paramsSchema.shape,
        composeAiWorkflow.handler
    );

    // Register get_n8n_version_info tool
    server.tool(
        getN8nVersionInfo.toolName,
        getN8nVersionInfo.description,
        getN8nVersionInfo.paramsSchema.shape,
        getN8nVersionInfo.handler
    );

    // Register list_available_nodes tool
    server.tool(
        listAvailableNodes.toolName,
        "List available node types. Supports tag-style synonym search and multi-token queries. By default, multiple terms use OR logic (e.g., 'webhook trigger' matches either). Set token_logic='and' to require all tokens. Disable synonyms with tags=false. Tips: search 'langchain', roles like 'agent', 'lmChat/llm', 'tool', 'memory', or provider names like 'qdrant', 'weaviate', 'milvus', 'openai', 'anthropic'.",
        listAvailableNodes.paramsSchema.shape,
        listAvailableNodes.handler
    );

    // Register validate_workflow tool
    server.tool(
        validateWorkflow.toolName,
        "Validate a workflow file against known node schemas. Enhanced with strict_main_chain option and structured error responses.",
        validateWorkflow.paramsSchema.shape,
        validateWorkflow.handler
    );

    // Register connect_main_chain tool
    server.tool(
        connectMainChain.toolName,
        connectMainChain.description,
        connectMainChain.paramsSchema.shape,
        connectMainChain.handler
    );

    // Register list_template_examples tool
    server.tool(
        listTemplateExamples.toolName,
        listTemplateExamples.description,
        listTemplateExamples.paramsSchema.shape,
        listTemplateExamples.handler
    );

    console.error("[DEBUG] Registered tools:", createWorkflow.toolName, listWorkflows.toolName, getWorkflowDetails.toolName, addNode.toolName, editNode.toolName, deleteNode.toolName, addConnection.toolName, addAiConnections.toolName, composeAiWorkflow.toolName, getN8nVersionInfo.toolName, listAvailableNodes.toolName, validateWorkflow.toolName, connectMainChain.toolName, listTemplateExamples.toolName);
}
