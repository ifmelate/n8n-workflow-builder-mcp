import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { N8nWorkflow } from '../../types/n8n';
import { ensureWorkflowDir, resolvePath, setWorkspaceDir, WORKFLOW_DATA_DIR_NAME } from '../../utils/workspace';
import { generateInstanceId, generateN8nId, generateUUID } from '../../utils/id';
import { ToolNames } from '../../utils/constants';

// Schema definition
export const paramsSchema = z.object({
    workflow_name: z.string().describe("The name for the new workflow"),
    workspace_dir: z.string().describe("Absolute path to the project root directory where workflow_data will be stored")
});

export type Params = z.infer<typeof paramsSchema>;

export interface Result {
    success: boolean;
    workflow?: N8nWorkflow;
    error?: string;
    recommended_next_step?: string;
}

// Tool metadata
export const toolName = ToolNames.create_workflow;
export const description = "Create a new n8n workflow";

// Handler implementation
export async function handler(params: Params, _extra: any) {
    console.error("[DEBUG] create_workflow called with params:", params);
    const workflowName = params.workflow_name;
    const workspaceDir = params.workspace_dir;

    if (!workflowName || workflowName.trim() === "") {
        const result: Result = { success: false, error: "Parameter 'workflow_name' is required." };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
    if (!workspaceDir || workspaceDir.trim() === "") {
        const result: Result = { success: false, error: "Parameter 'workspace_dir' is required." };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }

    try {
        const stat = await fs.stat(workspaceDir);
        if (!stat.isDirectory()) {
            const result: Result = { success: false, error: "Provided 'workspace_dir' is not a directory." };
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        }

        // Check if the workspaceDir is the root directory
        if (path.resolve(workspaceDir) === path.resolve('/')) {
            console.error("[ERROR] 'workspace_dir' cannot be the root directory ('/'). Please specify a valid project subdirectory.");
            const result: Result = { success: false, error: "'workspace_dir' cannot be the root directory. Please specify a project subdirectory." };
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        }

        setWorkspaceDir(workspaceDir);
        await ensureWorkflowDir(); // Ensures WORKFLOW_DATA_DIR_NAME exists

        const newN8nWorkflow: N8nWorkflow = {
            name: workflowName,
            id: generateN8nId(), // e.g., "Y6sBMxxyJQtgCCBQ"
            nodes: [], // Initialize with empty nodes array
            connections: {}, // Initialize with empty connections object
            active: false,
            pinData: {},
            settings: {
                executionOrder: "v1"
            },
            versionId: generateUUID(),
            meta: {
                instanceId: generateInstanceId()
            },
            tags: []
        };

        // Sanitize workflowName for filename or ensure it's safe.
        // For now, using directly. Consider a sanitization function for production.
        const filename = `${workflowName.replace(/[^a-z0-9_.-]/gi, '_')}.json`;
        const filePath = resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, filename));

        await fs.writeFile(filePath, JSON.stringify(newN8nWorkflow, null, 2));
        console.error("[DEBUG] Workflow created and saved to:", filePath);

        const result: Result = {
            success: true,
            workflow: newN8nWorkflow,
            recommended_next_step: "Call 'list_available_nodes' before adding nodes. Use 'search_term' (e.g., 'langchain') to find AI nodes."
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };

    } catch (error: any) {
        console.error("[ERROR] Failed to create workflow:", error);
        const result: Result = { success: false, error: "Failed to create workflow: " + error.message };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
}
