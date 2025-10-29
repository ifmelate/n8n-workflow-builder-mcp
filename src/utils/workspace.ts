import path from 'path';
import fs from 'fs/promises';

// Workspace-scoped paths and helpers extracted from index.ts

export const WORKFLOW_DATA_DIR_NAME = 'workflow_data';
export const WORKFLOWS_FILE_NAME = 'workflows.json';

let WORKSPACE_DIR: string = process.cwd();

/**
 * Security error thrown when path operations violate security constraints
 */
export class PathSecurityError extends Error {
    constructor(message: string, public readonly attemptedPath: string) {
        super(message);
        this.name = 'PathSecurityError';
    }
}

export function getWorkspaceDir(): string {
    return WORKSPACE_DIR;
}

export function setWorkspaceDir(dir: string): void {
    // Prevent setting workspace to root directory for security
    const resolvedDir = path.resolve(dir);
    if (resolvedDir === '/' || resolvedDir.match(/^[A-Z]:\\?$/)) {
        throw new PathSecurityError(
            'Cannot set workspace directory to root directory for security reasons',
            resolvedDir
        );
    }
    WORKSPACE_DIR = resolvedDir;
}

/**
 * Sanitize a filename to prevent directory traversal and other security issues
 */
function sanitizeFilename(filename: string): string {
    return filename
        // Remove any path separators
        .replace(/[/\\]/g, '_')
        // Remove null bytes and control characters
        .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
        // Remove dangerous characters
        .replace(/[<>:"|?*]/g, '_')
        // Trim whitespace and dots
        .trim()
        .replace(/^\.+|\.+$/g, '')
        // Ensure it's not empty after sanitization
        || 'unnamed';
}

/**
 * Validate that a resolved path is secure and within allowed boundaries
 */
function validateSecurePath(resolvedPath: string, basePath: string): void {
    const normalizedResolved = path.normalize(resolvedPath);
    const normalizedBase = path.normalize(basePath);

    // Check if path is within the base directory
    if (!normalizedResolved.startsWith(normalizedBase + path.sep) && normalizedResolved !== normalizedBase) {
        throw new PathSecurityError(
            `Path traversal attempt detected: resolved path must be within ${normalizedBase}`,
            resolvedPath
        );
    }

    // Prevent access to root directory
    if (normalizedResolved === '/' || normalizedResolved.match(/^[A-Z]:\\?$/)) {
        throw new PathSecurityError(
            'Cannot access root directory for security reasons',
            resolvedPath
        );
    }

    // Check for dangerous path components
    const pathComponents = normalizedResolved.split(path.sep);
    for (const component of pathComponents) {
        if (component === '..' || component === '.' || component === '') continue;
        if (component.includes('\x00') || component.match(/[\x00-\x1f\x7f-\x9f]/)) {
            throw new PathSecurityError(
                'Invalid characters detected in path component',
                resolvedPath
            );
        }
    }
}

export function resolvePath(filepath: string): string {
    // Sanitize the input path
    const sanitizedPath = filepath
        .replace(/^[\\/]+/, '') // Remove leading slashes
        .split(path.sep)
        .map(component => {
            // Allow relative navigation components but sanitize filenames
            if (component === '.' || component === '..') return component;
            return sanitizeFilename(component);
        })
        .join(path.sep);

    const resolvedPath = path.resolve(WORKSPACE_DIR, sanitizedPath);

    // Validate the resolved path is secure
    validateSecurePath(resolvedPath, WORKSPACE_DIR);

    return resolvedPath;
}

export function resolveWorkflowPath(workflowName: string, workflowPath?: string): string {
    if (workflowPath) {
        if (path.isAbsolute(workflowPath)) {
            // For absolute paths, ensure they're within a reasonable boundary
            const resolvedPath = path.resolve(workflowPath);

            // Check if it's trying to access root or system directories
            if (resolvedPath === '/' || resolvedPath.match(/^[A-Z]:\\?$/) ||
                resolvedPath.startsWith('/etc') || resolvedPath.startsWith('/root') ||
                resolvedPath.startsWith('/sys') || resolvedPath.startsWith('/proc')) {
                throw new PathSecurityError(
                    'Access to system directories is not allowed',
                    resolvedPath
                );
            }

            return resolvedPath;
        }
        // For relative paths, resolve against current working directory with security checks
        const resolvedPath = path.resolve(process.cwd(), workflowPath);

        // Ensure the path doesn't escape to dangerous locations
        const cwd = process.cwd();
        validateSecurePath(resolvedPath, cwd);

        return resolvedPath;
    }

    // For workflow names, sanitize and use standard location
    const sanitizedName = sanitizeFilename(workflowName);
    if (!sanitizedName || sanitizedName === 'unnamed') {
        throw new PathSecurityError(
            'Workflow name cannot be empty or contain only invalid characters',
            workflowName
        );
    }

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


// Best-effort workspace autodetection when a tool receives only workflow_name
// Tries common environment-provided working directories and, if a matching
// workflow file is found, updates the global WORKSPACE_DIR accordingly.
export async function tryDetectWorkspaceForName(workflowName: string): Promise<string | null> {
    const sanitizedName = workflowName.replace(/[^a-z0-9_.-]/gi, '_');
    const candidates: Array<string | undefined> = [
        process.env.INIT_CWD,
        process.env.PWD,
    ];

    for (const dir of candidates) {
        if (!dir) continue;
        try {
            const absDir = path.resolve(dir);
            const candidateFile = path.join(absDir, WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`);
            const stat = await fs.stat(candidateFile).catch(() => null);
            if (stat && stat.isFile()) {
                setWorkspaceDir(absDir);
                return candidateFile;
            }
        } catch {
            // ignore and continue
        }
    }
    return null;
}


