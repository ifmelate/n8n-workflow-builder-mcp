import { z } from 'zod';
import fs from 'fs/promises';
import { N8nWorkflow } from '../../types/n8n';
import { resolveWorkflowPath, ensureWorkflowParentDir, tryDetectWorkspaceForName } from '../../utils/workspace';
import { ToolNames, ErrorCodes } from '../../utils/constants';
import { createSuccessResponse, createErrorResponse } from '../../utils/responses';
import { v4 as uuidv4 } from 'uuid';

// Schema definition
export const paramsSchema = z.object({
    workflow_name: z.string().describe("The Name of the workflow to get details for"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file (absolute or relative to current working directory). If not provided, uses standard workflow_data directory approach.")
});

export type Params = z.infer<typeof paramsSchema>;

export interface Result {
    success: boolean;
    workflow?: N8nWorkflow;
    error?: string;
}

// Tool metadata
export const toolName = ToolNames.get_workflow_details;
export const description = "Get workflow details by name or path";

// Handler implementation
export async function handler(params: Params, _extra: any) {
    const correlationId = uuidv4();
    const workflowName = params.workflow_name;
    console.error(`[${correlationId}] get_workflow_details called with name:`, workflowName);

    try {
        let filePath = resolveWorkflowPath(workflowName, params.workflow_path);

        // Auto-detect workspace when only workflow_name is provided and default path doesn't exist
        try {
            if (!params.workflow_path) {
                await fs.access(filePath).catch(async () => {
                    const detected = await tryDetectWorkspaceForName(workflowName);
                    if (detected) filePath = detected;
                });
            }
        } catch { }

        // Ensure parent directory only when explicit path provided
        if (params.workflow_path) {
            await ensureWorkflowParentDir(filePath);
        }

        try {
            const data = await fs.readFile(filePath, 'utf8');
            const workflow = JSON.parse(data) as N8nWorkflow;
            console.error("[DEBUG] Found workflow by name in file:", filePath);

            return createSuccessResponse({ workflow, workflowPath: filePath }, { correlationId });
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.warn(`[DEBUG] Workflow file ${filePath} not found using name: ${workflowName}.`);
                return createErrorResponse(`Workflow with name ${workflowName} not found`, { correlationId, code: ErrorCodes.VALIDATION_ERROR, retryable: false, remediation: 'Verify workflow_name or provide workflow_path' });
            } else {
                throw error; // Re-throw other read errors
            }
        }
    } catch (error: any) {
        console.error(`[${correlationId}] Failed to get workflow details:`, error);
        return createErrorResponse('Failed to get workflow details: ' + error.message, { correlationId });
    }
}
