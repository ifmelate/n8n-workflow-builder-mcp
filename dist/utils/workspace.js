"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathSecurityError = exports.WORKFLOWS_FILE_NAME = exports.WORKFLOW_DATA_DIR_NAME = void 0;
exports.getWorkspaceDir = getWorkspaceDir;
exports.setWorkspaceDir = setWorkspaceDir;
exports.resolvePath = resolvePath;
exports.resolveWorkflowPath = resolveWorkflowPath;
exports.ensureWorkflowParentDir = ensureWorkflowParentDir;
exports.ensureWorkflowDir = ensureWorkflowDir;
exports.tryDetectWorkspaceForName = tryDetectWorkspaceForName;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
// Workspace-scoped paths and helpers extracted from index.ts
exports.WORKFLOW_DATA_DIR_NAME = 'workflow_data';
exports.WORKFLOWS_FILE_NAME = 'workflows.json';
let WORKSPACE_DIR = process.cwd();
/**
 * Security error thrown when path operations violate security constraints
 */
class PathSecurityError extends Error {
    constructor(message, attemptedPath) {
        super(message);
        this.attemptedPath = attemptedPath;
        this.name = 'PathSecurityError';
    }
}
exports.PathSecurityError = PathSecurityError;
function getWorkspaceDir() {
    return WORKSPACE_DIR;
}
function setWorkspaceDir(dir) {
    // Prevent setting workspace to root directory for security
    const resolvedDir = path_1.default.resolve(dir);
    if (resolvedDir === '/' || resolvedDir.match(/^[A-Z]:\\?$/)) {
        throw new PathSecurityError('Cannot set workspace directory to root directory for security reasons', resolvedDir);
    }
    WORKSPACE_DIR = resolvedDir;
}
/**
 * Sanitize a filename to prevent directory traversal and other security issues
 */
function sanitizeFilename(filename) {
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
function validateSecurePath(resolvedPath, basePath) {
    const normalizedResolved = path_1.default.normalize(resolvedPath);
    const normalizedBase = path_1.default.normalize(basePath);
    // Check if path is within the base directory
    if (!normalizedResolved.startsWith(normalizedBase + path_1.default.sep) && normalizedResolved !== normalizedBase) {
        throw new PathSecurityError(`Path traversal attempt detected: resolved path must be within ${normalizedBase}`, resolvedPath);
    }
    // Prevent access to root directory
    if (normalizedResolved === '/' || normalizedResolved.match(/^[A-Z]:\\?$/)) {
        throw new PathSecurityError('Cannot access root directory for security reasons', resolvedPath);
    }
    // Check for dangerous path components
    const pathComponents = normalizedResolved.split(path_1.default.sep);
    for (const component of pathComponents) {
        if (component === '..' || component === '.' || component === '')
            continue;
        if (component.includes('\x00') || component.match(/[\x00-\x1f\x7f-\x9f]/)) {
            throw new PathSecurityError('Invalid characters detected in path component', resolvedPath);
        }
    }
}
function resolvePath(filepath) {
    // Sanitize the input path
    const sanitizedPath = filepath
        .replace(/^[\\/]+/, '') // Remove leading slashes
        .split(path_1.default.sep)
        .map(component => {
        // Allow relative navigation components but sanitize filenames
        if (component === '.' || component === '..')
            return component;
        return sanitizeFilename(component);
    })
        .join(path_1.default.sep);
    const resolvedPath = path_1.default.resolve(WORKSPACE_DIR, sanitizedPath);
    // Validate the resolved path is secure
    validateSecurePath(resolvedPath, WORKSPACE_DIR);
    return resolvedPath;
}
function resolveWorkflowPath(workflowName, workflowPath) {
    if (workflowPath) {
        if (path_1.default.isAbsolute(workflowPath)) {
            // For absolute paths, ensure they're within a reasonable boundary
            const resolvedPath = path_1.default.resolve(workflowPath);
            // Check if it's trying to access root or system directories
            if (resolvedPath === '/' || resolvedPath.match(/^[A-Z]:\\?$/) ||
                resolvedPath.startsWith('/etc') || resolvedPath.startsWith('/root') ||
                resolvedPath.startsWith('/sys') || resolvedPath.startsWith('/proc')) {
                throw new PathSecurityError('Access to system directories is not allowed', resolvedPath);
            }
            return resolvedPath;
        }
        // For relative paths, resolve against current working directory with security checks
        const resolvedPath = path_1.default.resolve(process.cwd(), workflowPath);
        // Ensure the path doesn't escape to dangerous locations
        const cwd = process.cwd();
        validateSecurePath(resolvedPath, cwd);
        return resolvedPath;
    }
    // For workflow names, sanitize and use standard location
    const sanitizedName = sanitizeFilename(workflowName);
    if (!sanitizedName || sanitizedName === 'unnamed') {
        throw new PathSecurityError('Workflow name cannot be empty or contain only invalid characters', workflowName);
    }
    return resolvePath(path_1.default.join(exports.WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`));
}
async function ensureWorkflowParentDir(filePath) {
    const parentDir = path_1.default.dirname(filePath);
    await promises_1.default.mkdir(parentDir, { recursive: true });
}
async function ensureWorkflowDir() {
    const resolvedDir = resolvePath(exports.WORKFLOW_DATA_DIR_NAME);
    await promises_1.default.mkdir(resolvedDir, { recursive: true });
}
// Best-effort workspace autodetection when a tool receives only workflow_name
// Tries common environment-provided working directories and, if a matching
// workflow file is found, updates the global WORKSPACE_DIR accordingly.
async function tryDetectWorkspaceForName(workflowName) {
    const sanitizedName = workflowName.replace(/[^a-z0-9_.-]/gi, '_');
    const candidates = [
        process.env.INIT_CWD,
        process.env.PWD,
    ];
    for (const dir of candidates) {
        if (!dir)
            continue;
        try {
            const absDir = path_1.default.resolve(dir);
            const candidateFile = path_1.default.join(absDir, exports.WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`);
            const stat = await promises_1.default.stat(candidateFile).catch(() => null);
            if (stat && stat.isFile()) {
                setWorkspaceDir(absDir);
                return candidateFile;
            }
        }
        catch {
            // ignore and continue
        }
    }
    return null;
}
