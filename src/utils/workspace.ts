import path from 'path';
import fs from 'fs/promises';

// Workspace-scoped paths and helpers extracted from index.ts

export const WORKFLOW_DATA_DIR_NAME = 'workflow_data';
export const WORKFLOWS_FILE_NAME = 'workflows.json';

let WORKSPACE_DIR: string = process.cwd();

export function getWorkspaceDir(): string {
    return WORKSPACE_DIR;
}

export function setWorkspaceDir(dir: string): void {
    WORKSPACE_DIR = dir;
}

export function resolvePath(filepath: string): string {
    const relativePath = filepath.replace(/^[\\/]+/, '');
    return path.join(WORKSPACE_DIR, relativePath);
}

export function resolveWorkflowPath(workflowName: string, workflowPath?: string): string {
    if (workflowPath) {
        if (path.isAbsolute(workflowPath)) {
            return workflowPath;
        }
        return path.resolve(process.cwd(), workflowPath);
    }
    const sanitizedName = workflowName.replace(/[^a-z0-9_.-]/gi, '_');
    return resolvePath(path.join(WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`));
}

export async function ensureWorkflowParentDir(filePath: string): Promise<void> {
    const parentDir = path.dirname(filePath);
    await fs.mkdir(parentDir, { recursive: true });
}

export async function ensureWorkflowDir(): Promise<void> {
    const resolvedDir = resolvePath(WORKFLOW_DATA_DIR_NAME);
    await fs.mkdir(resolvedDir, { recursive: true });
}


