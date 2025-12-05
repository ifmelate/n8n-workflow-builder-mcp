import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { N8nWorkflow } from '../../types/n8n';
import { ensureWorkflowDir, resolvePath, WORKFLOW_DATA_DIR_NAME, WORKFLOWS_FILE_NAME } from '../../utils/workspace';
import { ToolNames } from '../../utils/constants';

// Schema definition
export const paramsSchema = z.object({
    limit: z.number().int().positive().max(1000).optional().describe("Maximum number of workflows to return"),
    cursor: z.string().optional().describe("Opaque cursor for pagination; pass back to get the next page")
});

export type Params = z.infer<typeof paramsSchema>;

export interface Result {
    success: boolean;
    workflows?: N8nWorkflow[];
    nextCursor?: string | null;
    total?: number;
    error?: string;
}

// Tool metadata
export const toolName = ToolNames.list_workflows;
export const description = "List workflows in the workspace";

// Handler implementation
export async function handler(params: Params, _extra: any) {
    console.error("[DEBUG] list_workflows called with params:", params);

    try {
        // Ensure workflow directory exists
        await ensureWorkflowDir();
        const workflowDataDir = resolvePath(WORKFLOW_DATA_DIR_NAME);

        // Read all JSON files except the old workflows.json file
        const files = await fs.readdir(workflowDataDir);
        const workflowFiles = files.filter(file => file.endsWith('.json') && file !== WORKFLOWS_FILE_NAME);

        const workflows: N8nWorkflow[] = [];
        for (const file of workflowFiles) {
            try {
                const filePath = path.join(workflowDataDir, file);
                const data = await fs.readFile(filePath, 'utf8');
                const workflow = JSON.parse(data) as N8nWorkflow;
                workflows.push(workflow);
            } catch (err) {
                console.error(`[ERROR] Failed to read or parse workflow file ${file}:`, err);
                // Skip corrupted files and continue
            }
        }

        console.error(`[DEBUG] Retrieved ${workflows.length} workflows from individual files.`);

        // Apply simple offset cursor pagination
        const startIndex = params?.cursor ? Number(params.cursor) || 0 : 0;
        const limit = params?.limit ?? workflows.length;
        const page = workflows.slice(startIndex, startIndex + limit);
        const nextIndex = startIndex + limit;
        const nextCursor = nextIndex < workflows.length ? String(nextIndex) : null;

        const result: Result = {
            success: true,
            workflows: page,
            nextCursor,
            total: workflows.length
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };

    } catch (error: any) {
        console.error("[ERROR] Failed to list workflows:", error);
        const result: Result = {
            success: false,
            error: "Failed to list workflows: " + error.message
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
}
